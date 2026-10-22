/**
 * 启动预检（architecture §10.3 / REQ-DEP-001）：全部在写出任何产物之前完成。
 *
 * ① Node 版本 → runtime-unsupported / 4
 * ② 内置配置 + 模板：ZIP 可解析、必需部件齐全、样式 ID 齐全、与 default.yml 双源一致 → template-missing / 4
 * ③ 需要 PDF 时引擎可解析 + capabilities 含 docx→pdf（在 cli 内调度）→ pdf-engine-missing / 4
 * ④ 字体栈探测（不阻断，仅记录）
 *
 * @module cli/precheck
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { arch, homedir, platform as hostPlatform } from "node:os";
import { join } from "node:path";
import { DocconvertError } from "../contracts/errors.js";
import {
  FONT_STACKS,
  MIN_NODE_VERSION,
  RECOMMENDED_NODE_VERSION,
  TEMPLATE_REL_PATH,
  TEMPLATE_REQUIRED_PARTS,
} from "../contracts/index.js";
import { REQUIRED_STYLE_IDS, verifyTemplateConsistency } from "../config/index.js";
import { readZipFile } from "./zip.js";

/**
 * ① Node 版本 >= 22.19.0（REQ-DEP-001）。
 * @param {string} [nodeVersion]
 */
export function assertNodeVersion(nodeVersion = process.versions.node) {
  const parse = (value) => String(value).replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  const [major, minor, patch] = parse(nodeVersion);
  const [needMajor, needMinor, needPatch] = parse(MIN_NODE_VERSION);
  const ok = major > needMajor
    || (major === needMajor && minor > needMinor)
    || (major === needMajor && minor === needMinor && patch >= needPatch);
  if (!ok) {
    throw new DocconvertError("runtime-unsupported", `当前 Node 版本 ${nodeVersion} 低于要求的 v${MIN_NODE_VERSION}`, {
      hint: `升级到 Node ${RECOMMENDED_NODE_VERSION} 后重试`,
      detail: { node: nodeVersion, required: MIN_NODE_VERSION },
    });
  }
}

/**
 * 计算文件 SHA-256（小写十六进制；日志与 --version 统一用小写，TC-LOG-01 要求）。
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * 解析 word/styles.xml，取每个样式的 w:sz 与 eastAsia 字体。
 * @param {string} xml
 * @returns {Map<string, { sz?: number, eastAsia?: string }>}
 */
export function parseStyleSizes(xml) {
  /** @type {Map<string, { sz?: number, eastAsia?: string }>} */
  const styles = new Map();
  const stylePattern = /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g;
  let match;
  while ((match = stylePattern.exec(xml)) !== null) {
    const styleId = match[1];
    const body = match[2];
    const sizeMatch = /<w:sz\b[^>]*w:val="(\d+)"/.exec(body);
    const fontMatch = /<w:rFonts\b[^>]*w:eastAsia="([^"]+)"/.exec(body);
    /** @type {{ sz?: number, eastAsia?: string }} */
    const record = {};
    if (sizeMatch) record.sz = Number(sizeMatch[1]);
    if (fontMatch) record.eastAsia = fontMatch[1];
    styles.set(styleId, record);
  }
  // docDefaults 的 w:sz 是正文基准；Normal 未显式声明时用它参与双源校验。
  if (!styles.get("Normal")?.sz) {
    const defaults = /<w:docDefaults>[\s\S]*?<w:sz\b[^>]*w:val="(\d+)"[\s\S]*?<\/w:docDefaults>/.exec(xml);
    if (defaults) {
      const record = styles.get("Normal") ?? {};
      record.sz = Number(defaults[1]);
      styles.set("Normal", record);
    }
  }
  return styles;
}

/**
 * ② 配置 + 模板：存在、ZIP 可解析、必需部件齐全、样式 ID 齐全、双源一致。
 * @param {{ packageRoot: string, config: Record<string, any> }} options
 * @returns {Promise<{ absolutePath: string, version: string, bytes: number, entries: string[], styles: Map<string, { sz?: number, eastAsia?: string }>, compared: number }>}
 */
export async function inspectTemplate({ packageRoot, config }) {
  const absolutePath = join(packageRoot, ...TEMPLATE_REL_PATH.split("/"));
  const info = await stat(absolutePath).catch(() => null);
  if (!info || !info.isFile() || info.size === 0) {
    throw new DocconvertError("template-missing", `内置模板缺失或为空：${absolutePath}`, {
      detail: { templatePath: absolutePath, reason: "missing" },
    });
  }

  /** @type {{ names: string[], read(name: string): Buffer }} */
  let zip;
  try {
    zip = await readZipFile(absolutePath);
  } catch (error) {
    throw new DocconvertError("template-missing", `内置模板损坏（ZIP 无法解析）：${absolutePath}`, {
      detail: { templatePath: absolutePath, reason: "zip-invalid" },
      cause: error,
    });
  }

  const missingParts = TEMPLATE_REQUIRED_PARTS.filter((part) => !zip.names.includes(part));
  if (missingParts.length > 0) {
    throw new DocconvertError("template-missing", `内置模板缺少必需部件：${missingParts.join("、")}`, {
      detail: { templatePath: absolutePath, reason: "missing-parts", missing: missingParts },
    });
  }

  /** @type {Map<string, { sz?: number, eastAsia?: string }>} */
  let styles;
  try {
    styles = parseStyleSizes(zip.read("word/styles.xml").toString("utf8"));
  } catch (error) {
    throw new DocconvertError("template-missing", `内置模板的 styles.xml 无法解析：${absolutePath}`, {
      detail: { templatePath: absolutePath, reason: "styles-invalid" },
      cause: error,
    });
  }

  const missingStyles = REQUIRED_STYLE_IDS.filter((id) => !styles.has(id));
  if (missingStyles.length > 0) {
    throw new DocconvertError("template-missing", `内置模板缺少必需样式：${missingStyles.join("、")}`, {
      detail: { templatePath: absolutePath, reason: "missing-styles", missing: missingStyles },
    });
  }

  const { mismatches, compared } = verifyTemplateConsistency({ config, styles });
  if (mismatches.length > 0) {
    const first = mismatches[0];
    throw new DocconvertError(
      "template-missing",
      `模板样式值与 config/default.yml 不一致：${first.styleId}.w:sz=${first.actual}，${first.key}=${first.expected / 2}pt（应为 ${first.expected}）`,
      {
        detail: { templatePath: absolutePath, reason: "config-template-mismatch", mismatches },
      },
    );
  }

  const sha256 = await sha256File(absolutePath);
  return {
    absolutePath,
    version: sha256.slice(0, 12),
    bytes: info.size,
    entries: zip.names,
    styles,
    compared,
  };
}

/**
 * ④ 字体栈探测（不阻断）。用字体文件名近似判定首选字体是否可用。
 * @returns {Promise<{ fontStack: {latin: string, cjk: string, mono: string}, fallback: boolean }>}
 */
export async function probeFonts() {
  const files = await collectFontFileNames();
  const resolved = {
    latin: pickFont(FONT_STACKS.latin, files),
    cjk: pickFont(FONT_STACKS.cjk, files),
    mono: pickFont(FONT_STACKS.mono, files),
  };
  const fallback = resolved.latin !== FONT_STACKS.latin[0]
    || resolved.cjk !== FONT_STACKS.cjk[0]
    || resolved.mono !== FONT_STACKS.mono[0];
  return { fontStack: resolved, fallback };
}

/**
 * 安装字体文件名（小写、去扩展名）。
 * @returns {Promise<Set<string>>}
 */
async function collectFontFileNames() {
  const dirs = [];
  const os = hostPlatform();
  if (os === "win32") {
    dirs.push(join(process.env.WINDIR || "C:\\Windows", "Fonts"));
  } else if (os === "darwin") {
    dirs.push("/System/Library/Fonts", "/Library/Fonts", join(homedir(), "Library", "Fonts"));
  } else {
    dirs.push("/usr/share/fonts", "/usr/local/share/fonts", join(homedir(), ".fonts"));
  }
  /** @type {Set<string>} */
  const names = new Set();
  for (const dir of dirs) {
    /** @type {import("node:fs").Dirent[]} */
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      names.add(entry.name.toLowerCase().replace(/\.[^.]+$/, ""));
    }
  }
  return names;
}

/**
 * 字体族名 → 文件名 token（小写、无空格无连字符）。
 * @type {Record<string, string[]>}
 */
const FONT_FILE_TOKENS = {
  "calibri": ["calibri"],
  "carlito": ["carlito"],
  "arial": ["arial"],
  "helvetica": ["helvetica"],
  "微软雅黑": ["msyh"],
  "Microsoft YaHei UI": ["msyhui", "msyh"],
  "PingFang SC": ["pingfang"],
  "Hiragino Sans GB": ["hiragino"],
  "Noto Sans CJK SC": ["notosanscjk", "notosanssc"],
  "Source Han Sans SC": ["sourcehansans"],
  "SimSun": ["simsun"],
  "Consolas": ["consolas"],
  "Menlo": ["menlo"],
  "DejaVu Sans Mono": ["dejavusansmono"],
};

/**
 * @param {readonly string[]} stack
 * @param {Set<string>} files
 * @returns {string}
 */
function pickFont(stack, files) {
  for (const family of stack) {
    const tokens = FONT_FILE_TOKENS[family];
    if (!tokens) continue;
    for (const file of files) {
      if (tokens.some((token) => file.startsWith(token))) return family;
    }
  }
  return stack[0];
}

/**
 * 当前进程的架构信息（日志/版本用）。
 * @returns {{ os: string, arch: string, node: string }}
 */
export function platformInfo() {
  return { os: hostPlatform(), arch: arch(), node: process.versions.node };
}
