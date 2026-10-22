/**
 * input-preprocess（新开发，architecture §3.2 / requirements §2.1）
 *
 * 职责（一次调用做完，不做 Markdown 解析本身、不生成 DOCX、不读配置）：
 * 1 绝对路径校验 → stat/readFile（input-not-found / input-permission）；
 * 2 扩展名分派 .md / .txt（大小写不敏感；.markdown 未实现 → unsupported-extension）；
 * 3 编码：UTF-8 BOM 剥离 → UTF-8 严格 → GB18030 严格 → decode-error；换行 CRLF/CR → LF；
 * 4 空输入（0 字节或去空白后为空）→ empty-input；SHA-256（原始字节，大写十六进制）；
 * 5 .md 交给 markdown parser（卡 2：src/markdown/index.js），.txt 交给 txt-structurer；
 * 6 注入 ParseContext（resolveAsset 只登记相对路径 PNG/JPEG；warn；nextBookmark 单调 _Toc0001…）；
 * 7 meta.title：首个 H1 文本，否则文件名去扩展名（REQ-LAY-002 / REQ-TXT-007）。
 *
 * @module preprocess
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DocconvertError } from "../contracts/errors.js";
import { structureText, WARNING_MESSAGES } from "../txt/index.js";
import { createAssetRegistry } from "./assets.js";
import { decodeSourceBytes, normalizeNewlines } from "./decode.js";

/** 扩展名 → 源格式（REQ-IN-001：大小写不敏感；.markdown 属 P1，未实现即明确拒绝）。 */
const FORMAT_BY_EXTENSION = new Map([
  [".md", "md"],
  [".txt", "txt"],
]);

/** 卡 2 的解析器入口（本模块不实现 Markdown 解析）。 */
const MARKDOWN_MODULE = new URL("../markdown/index.js", import.meta.url);
const MARKDOWN_MODULE_PATH = fileURLToPath(MARKDOWN_MODULE);

/** @type {Promise<Function | null> | null} */
let markdownParserPromise = null;

/**
 * 是否「解析器模块尚未落地」——只吞掉指向本模块路径的缺模块错误，其它错误照抛。
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingMarkdownModule(error) {
  if (!error || typeof error !== "object") return false;
  const code = /** @type {{ code?: string }} */ (error).code;
  if (code !== "ERR_MODULE_NOT_FOUND") return false;
  const message = typeof (/** @type {{ message?: unknown }} */ (error).message) === "string"
    ? /** @type {{ message: string }} */ (error).message
    : "";
  return message.includes("'" + MARKDOWN_MODULE_PATH + "'");
}

/**
 * 惰性加载卡 2 的 markdown parser（每个进程只尝试一次）。
 * 卡 2 落地前返回 null，调用方以 txt-structurer 兜底（内容零丢失；解析器一落地自动生效）。
 * @returns {Promise<Function | null>}
 */
async function loadMarkdownParser() {
  if (markdownParserPromise === null) {
    markdownParserPromise = import(MARKDOWN_MODULE.href)
      .then((module) => {
        if (typeof module.parseMarkdown !== "function") {
          // 模块存在但契约不符 → 明确报错，不得回退到 .txt 规则
          throw new DocconvertError("internal-error", "Markdown 解析器未导出 parseMarkdown（architecture §3.12）");
        }
        return module.parseMarkdown;
      })
      .catch((error) => {
        if (isMissingMarkdownModule(error)) return null;
        if (error instanceof DocconvertError) throw error;
        const detail = error && error.message ? String(error.message) : String(error);
        throw new DocconvertError("internal-error", "加载 Markdown 解析器失败：" + detail, { cause: error });
      });
  }
  return markdownParserPromise;
}

/**
 * 入参文件校验（存在性 / 可读性）。
 * @param {string} absolutePath
 * @returns {Promise<import("node:fs").Stats>}
 */
async function statInput(absolutePath) {
  try {
    return await stat(absolutePath);
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new DocconvertError("input-not-found", "输入文件不存在：" + absolutePath, {
        detail: { path: absolutePath },
        cause: error,
      });
    }
    if (error && (error.code === "EACCES" || error.code === "EPERM")) {
      throw new DocconvertError("input-permission", "无法读取输入文件：" + absolutePath, {
        detail: { path: absolutePath },
        cause: error,
      });
    }
    throw new DocconvertError("input-not-found", "无法访问输入路径：" + absolutePath, {
      detail: { path: absolutePath },
      cause: error,
    });
  }
}

/**
 * 读原始字节（错误分类同 statInput）。
 * @param {string} absolutePath
 * @returns {Promise<Buffer>}
 */
async function readInput(absolutePath) {
  try {
    return await readFile(absolutePath);
  } catch (error) {
    const code = error && (error.code === "EACCES" || error.code === "EPERM") ? "input-permission" : "input-not-found";
    const message = code === "input-permission"
      ? "无法读取输入文件：" + absolutePath
      : "输入文件不存在：" + absolutePath;
    throw new DocconvertError(code, message, { detail: { path: absolutePath }, cause: error });
  }
}

/**
 * 内联节点 → 纯文本（用于封面标题与目录文字，忽略样式）。
 * @param {Array<object>} inlines
 * @returns {string}
 */
function inlineToText(inlines) {
  if (!Array.isArray(inlines)) return "";
  let text = "";
  for (const node of inlines) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "text" || node.kind === "code") {
      text += String(node.text ?? "");
    } else if (node.kind === "image") {
      text += String(node.alt ?? "");
    } else if (node.kind === "br") {
      text += " ";
    } else if (Array.isArray(node.children)) {
      text += inlineToText(node.children);
    }
  }
  return text;
}

/**
 * 读取并结构化一个输入文件。
 * @param {string} absolutePath 绝对路径（相对路径的解析由 cli 完成）
 * @param {{ cwd?: string }} [options] cwd = 资产相对路径基准，缺省为输入文件所在目录
 * @returns {Promise<import("../contracts/index.js").AstDocument>}
 */
export async function preprocess(absolutePath, options = {}) {
  if (!isAbsolute(absolutePath)) {
    // 契约要求绝对路径；相对路径的解析由 cli 完成（architecture §3.2）
    throw new DocconvertError("internal-error", "preprocess 收到了非绝对路径：" + absolutePath);
  }

  const info = await statInput(absolutePath);
  if (!info.isFile()) {
    throw new DocconvertError("unsupported-extension", "输入不是文件：" + absolutePath, {
      hint: "支持：.md .txt（目录请交给 CLI 展开）",
      detail: { path: absolutePath },
    });
  }

  const extension = extname(absolutePath).toLowerCase();
  const format = FORMAT_BY_EXTENSION.get(extension);
  if (!format) {
    throw new DocconvertError(
      "unsupported-extension",
      "不支持的扩展名：" + (extension || "(无扩展名)") + "（" + absolutePath + "）",
      { detail: { path: absolutePath, extension } },
    );
  }

  const bytes = await readInput(absolutePath);
  if (bytes.length === 0) {
    throw new DocconvertError("empty-input", "输入文件为空（0 字节）：" + absolutePath, {
      detail: { path: absolutePath },
    });
  }

  const decoded = decodeSourceBytes(bytes, absolutePath);
  const text = normalizeNewlines(decoded.text);
  if (text.trim() === "") {
    throw new DocconvertError("empty-input", "输入文件只有空白字符：" + absolutePath, {
      detail: { path: absolutePath },
    });
  }

  const baseDir = options && typeof options.cwd === "string" && options.cwd !== ""
    ? resolve(options.cwd)
    : dirname(absolutePath);

  /** @type {Array<object>} */
  const assets = [];
  /** @type {Array<{ code: string, message: string, line?: number }>} */
  const warnings = [];
  const registry = createAssetRegistry(baseDir, assets);
  let bookmarks = 0;

  const ctx = {
    sourcePath: absolutePath,
    resolveAsset: (rawSrc) => registry.resolveAsset(rawSrc),
    warn: (warning) => {
      if (!warning || typeof warning !== "object") return;
      /** @type {{ code: string, message: string, line?: number }} */
      const record = {
        code: String(warning.code ?? ""),
        message: String(warning.message ?? WARNING_MESSAGES[warning.code] ?? ""),
      };
      if (Number.isInteger(warning.line) && warning.line > 0) record.line = warning.line;
      warnings.push(record);
    },
    nextBookmark: () => {
      bookmarks += 1;
      return "_Toc" + String(bookmarks).padStart(4, "0");
    },
  };

  let blocks;
  if (format === "md") {
    const parseMarkdown = await loadMarkdownParser();
    // 卡 2 落地前用 txt-structurer 兜底：只做结构判定，内容零丢失；解析器落地后自动切换
    blocks = parseMarkdown ? parseMarkdown(text, ctx) : structureText(text, ctx);
  } else {
    blocks = structureText(text, ctx);
  }
  if (!Array.isArray(blocks)) blocks = [];

  const firstHeading = blocks.find((block) => block && block.kind === "heading" && block.level === 1);
  const headingTitle = firstHeading ? inlineToText(firstHeading.children).trim() : "";
  const title = headingTitle !== "" ? headingTitle : basename(absolutePath, extension);

  // .txt 的 no-heading-detected 由 txt-structurer 负责；.md 在这里补（解析器不重复发时同一 code 只留一条）
  if (format === "md"
    && !blocks.some((block) => block && block.kind === "heading")
    && !warnings.some((warning) => warning.code === "no-heading-detected")) {
    warnings.push({ code: "no-heading-detected", message: WARNING_MESSAGES["no-heading-detected"] });
  }

  return {
    schemaVersion: 1,
    meta: {
      absolutePath,
      format,
      sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
      bytes: bytes.length,
      mtimeMs: info.mtimeMs,
      encoding: decoded.encoding,
      title,
    },
    blocks,
    assets,
    warnings,
  };
}
