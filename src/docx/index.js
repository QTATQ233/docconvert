/**
 * docx-render：AST -> DOCX（architecture 3.5 / 4 / 8）。
 *
 * 职责边界（冻结）：
 * - 输入只有 AstDocument + 模板路径 + tocNumbers；**不接受**任何字号/颜色/边距/字体参数。
 * - 样式 100% 来自模板（w:pStyle 引用）；本模块只写结构性直接属性。
 * - 长文（H1-H3 条目数 >= 阈值）写封面 + 目录（TOC 域 + 完整缓存条目 + 标题书签）；
 *   短文无封面、无目录，正文从第 1 页开始（REQ-LAY-001）。
 * - 永不写 w:updateFields（E2 裁决）；tocNumbers === null 时页码固定 "00"。
 * - 字节级可复现：固定 ZIP 时间戳/条目顺序/压缩参数、无随机 ID、无时间/路径/用户名。
 *
 * @module docx
 */
import { createHash } from "node:crypto";
import { readFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DocconvertError } from "../contracts/errors.js";
import { PROGRAM_VERSION, TOC_DEPTH } from "../contracts/index.js";
import { toWriteError } from "../contracts/output-errors.js";
import { buildDocumentRels, buildDocumentXml, buildNumberingXml, createContext } from "./render.js";
import { loadTemplate } from "./template.js";
import { inlineText } from "./xml.js";
import { zipWrite } from "./zip.js";

/**
 * 长文阈值 T32（config layout.longdocHeadingThreshold = 3）。
 * renderDocx 的冻结签名不含 threshold，故在此镜像默认值；模板/配置一致性由启动预检校验。
 */
export const LONGDOC_HEADING_THRESHOLD = 3;

/** architecture 8.1：ZIP 条目固定顺序。 */
const FIXED_ENTRY_ORDER = Object.freeze([
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "docProps/app.xml",
  "word/document.xml",
  "word/styles.xml",
  "word/settings.xml",
  "word/fontTable.xml",
  "word/numbering.xml",
  "word/footer1.xml",
  "word/_rels/document.xml.rels",
]);

/** 临时文件序号（只用于临时文件名，不进入产物内容）。 */
let tempSequence = 0;

/**
 * 收集目录条目：只遍历顶层 blocks，只收 H1-H3（引用内标题不进目录）。
 * @param {import("../contracts/index.js").AstDocument} doc
 * @param {{ depth?: 1|2|3 }} [opts]
 * @returns {Array<import("../contracts/index.js").TocEntry>}
 */
export function collectTocEntries(doc, opts = {}) {
  const depth = opts.depth ?? TOC_DEPTH;
  /** @type {Array<import("../contracts/index.js").TocEntry>} */
  const entries = [];
  for (const block of doc.blocks ?? []) {
    if (!block || block.kind !== "heading") continue;
    const level = Number(block.level);
    if (!Number.isFinite(level) || level > depth) continue;
    const index = entries.length + 1;
    entries.push({
      index,
      level: /** @type {1|2|3} */ (level),
      text: inlineText(block.children).trim(),
      bookmark: typeof block.bookmark === "string" && block.bookmark !== ""
        ? block.bookmark
        : "_Toc" + String(index).padStart(4, "0"),
    });
  }
  return entries;
}

/**
 * 长文判定：H1-H3 条目数 >= 阈值（T32）。
 * @param {Array<import("../contracts/index.js").TocEntry>} entries
 * @param {number} threshold
 * @returns {boolean}
 */
export function isLongDoc(entries, threshold) {
  return entries.length >= threshold;
}

/**
 * 渲染 DOCX。
 * @param {import("../contracts/index.js").AstDocument} doc
 * @param {string} outPath
 * @param {{ templatePath: string, tocNumbers?: Array<number>|null, tocPlaceholder?: string }} options
 * @returns {Promise<import("../contracts/index.js").DocxRenderResult>}
 */
export async function renderDocx(doc, outPath, options = /** @type {any} */ ({})) {
  const templatePath = options.templatePath;
  if (typeof templatePath !== "string" || templatePath === "") {
    throw new DocconvertError("template-missing", "renderDocx 缺少模板路径（模板不接受其它值）", {
      hint: "重新安装 docconvert",
      detail: { reason: "template-path-required" },
    });
  }

  const template = await loadTemplate(templatePath);
  const tocEntries = collectTocEntries(doc, { depth: TOC_DEPTH });
  const longDoc = isLongDoc(tocEntries, LONGDOC_HEADING_THRESHOLD);
  const tocNumbers = normalizeTocNumbers(options.tocNumbers, tocEntries.length);
  const tocPlaceholder = normalizeTocPlaceholder(options.tocPlaceholder);
  const assets = await loadAssets(doc);
  const title = resolveTitle(doc);

  const ctx = createContext({ template, assets, tocEntries, tocNumbers, tocPlaceholder, longDoc, title });
  const documentXml = buildDocumentXml(doc, ctx);
  const documentRels = buildDocumentRels(ctx);
  const numberingXml = buildNumberingXml(ctx);

  const generated = new Map();
  generated.set("docProps/core.xml", buildCoreXml());
  generated.set("docProps/app.xml", buildAppXml());
  generated.set("word/document.xml", documentXml);
  generated.set("word/_rels/document.xml.rels", documentRels);
  if (template.parts.has("word/numbering.xml")) generated.set("word/numbering.xml", numberingXml);

  /** @type {Array<{ name: string, data: Buffer }>} */
  const entries = [];
  const used = new Set();
  for (const name of FIXED_ENTRY_ORDER) {
    if (generated.has(name)) {
      entries.push({ name, data: Buffer.from(/** @type {string} */ (generated.get(name)), "utf8") });
      used.add(name);
      continue;
    }
    const part = template.parts.get(name);
    if (part) {
      entries.push({ name, data: part });
      used.add(name);
    }
  }
  // 媒体：按 asset 首次出现序号（8.4），编号决定字节顺序。
  for (const asset of assets.values()) {
    if (!asset.resolved || !asset.buffer) continue;
    const name = "word/media/" + asset.mediaName;
    entries.push({ name, data: asset.buffer });
    used.add(name);
  }
  // 模板里其它部件按名称码点序追加，保持确定性（未来新增 footer2 等也稳定）。
  const leftovers = [...template.parts.keys()]
    .filter((name) => !used.has(name) && !name.startsWith("word/media/"))
    .sort();
  for (const name of leftovers) {
    entries.push({ name, data: /** @type {Buffer} */ (template.parts.get(name)) });
  }

  const zipBuffer = zipWrite(entries);
  const absoluteOut = resolve(outPath);
  await mkdir(dirname(absoluteOut), { recursive: true });
  tempSequence += 1;
  const tempPath = absoluteOut + ".tmp-" + process.pid + "-" + tempSequence;
  try {
    await writeFile(tempPath, zipBuffer);
    await rename(tempPath, absoluteOut);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw toWriteError(error, { target: absoluteOut, what: " DOCX 产物" });
  }

  const finalStat = await stat(absoluteOut);
  const sha256 = createHash("sha256").update(zipBuffer).digest("hex").toUpperCase();
  return {
    outputPath: absoluteOut,
    bytes: finalStat.size,
    sha256,
    tocEntries,
  };
}

/**
 * 校验并规整 tocNumbers：null = 第一遍占位；数组长度必须等于目录条目数（否则两遍法状态不一致）。
 * @param {Array<number>|null|undefined} numbers
 * @param {number} count
 * @returns {Array<number>|null}
 */
function normalizeTocNumbers(numbers, count) {
  if (numbers === null || numbers === undefined) return null;
  if (!Array.isArray(numbers)) {
    throw new DocconvertError("convert-failed", "tocNumbers 必须是数组或 null", {
      hint: "查看 conversion-log.jsonl",
      detail: { kind: "toc-numbers-invalid", actual: typeof numbers },
    });
  }
  if (numbers.length !== count) {
    throw new DocconvertError(
      "convert-failed",
      "两遍法状态不一致：tocNumbers 长度 " + numbers.length + " != 目录条目数 " + count,
      {
        hint: "查看 conversion-log.jsonl",
        detail: { kind: "toc-numbers-mismatch", expected: count, actual: numbers.length },
      },
    );
  }
  return numbers.map((value, index) => {
    const page = Math.trunc(Number(value));
    if (!Number.isInteger(page) || page < 1) {
      throw new DocconvertError("convert-failed", "第 " + (index + 1) + " 条目录页码非法：" + String(value), {
        hint: "查看 conversion-log.jsonl",
        detail: { kind: "toc-numbers-invalid", index: index + 1, value: String(value) },
      });
    }
    return page;
  });
}

/**
 * 目录页码占位串（additive optional；默认 "00"）。
 * t15 的 TOC 降级分支传 "——"（§7.3.3 G2 / TC-TOC-DEGRADED）：页码列必须显式表达"不可测量"，
 * 不能用 "00" 冒充真实页码，也不能留空。
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTocPlaceholder(value) {
  if (value === undefined || value === null) return "00";
  if (typeof value !== "string" || value.trim() === "") {
    throw new DocconvertError("convert-failed", "tocPlaceholder 必须是非空字符串（默认 \"00\"）", {
      hint: "查看 conversion-log.jsonl",
      detail: { kind: "toc-placeholder-invalid", actual: typeof value },
    });
  }
  if (value.length > 16) {
    throw new DocconvertError("convert-failed", "tocPlaceholder 过长（上限 16 字符）：" + value, {
      hint: "查看 conversion-log.jsonl",
      detail: { kind: "toc-placeholder-invalid", length: value.length },
    });
  }
  return value;
}

/**
 * 读取可内嵌资产：只有 resolved 且 mime 为 png/jpeg 的图片进入包内（REQ-ELEM-19）。
 * @param {import("../contracts/index.js").AstDocument} doc
 * @returns {Promise<Map<string, any>>}
 */
async function loadAssets(doc) {
  const assets = new Map();
  let index = 0;
  for (const asset of doc.assets ?? []) {
    if (!asset || typeof asset.id !== "string") continue;
    index += 1;
    const base = {
      id: asset.id,
      alt: typeof asset.alt === "string" ? asset.alt : "",
      rawSrc: typeof asset.rawSrc === "string" ? asset.rawSrc : "",
      resolved: asset.resolved === true,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
    };
    if (!base.resolved || typeof asset.absolutePath !== "string") {
      assets.set(asset.id, { ...base, resolved: false });
      continue;
    }
    const extension = asset.mime === "image/png" ? "png" : asset.mime === "image/jpeg" ? "jpeg" : "";
    if (extension === "") {
      // 非 PNG/JPEG：不内嵌，渲染为占位（与 REQ-ELEM-19 的降级可见结果一致）。
      assets.set(asset.id, { ...base, resolved: false });
      continue;
    }
    let buffer = null;
    try {
      buffer = await readFile(asset.absolutePath);
    } catch {
      buffer = null;
    }
    if (!buffer) {
      assets.set(asset.id, { ...base, resolved: false });
      continue;
    }
    assets.set(asset.id, { ...base, mediaName: "image" + index + "." + extension, buffer });
  }
  return assets;
}

/**
 * 封面标题来源：meta.title（preprocess 取首个 H1 或文件名去扩展名）-> 首个 H1 文本 -> 空串。
 * @param {import("../contracts/index.js").AstDocument} doc
 * @returns {string}
 */
function resolveTitle(doc) {
  const metaTitle = doc.meta && typeof doc.meta.title === "string" ? doc.meta.title.trim() : "";
  if (metaTitle !== "") return metaTitle;
  for (const block of doc.blocks ?? []) {
    if (block && block.kind === "heading") {
      const text = inlineText(block.children).trim();
      if (text !== "") return text;
    }
  }
  return "";
}

/**
 * docProps/core.xml：creator=docconvert、revision=1，**不写任何日期**。
 *
 * C-DOCX-01（已上报）：architecture 8.2 要求 dcterms:created/modified = 2000-01-01T00:00:00Z，
 * 但 REQ-REP-003（P0：封面/正文/页脚/元数据均不含日期）与 TC-REP-03 的
 * /20\d\d-\d\d-\d\d/ 断言把任何 ISO 日期都判为泄漏。按需求优先执行：两个日期元素省略
 * （OPC 核心属性均可选），可复现性不受影响（无运行时间写入）。
 * @returns {string}
 */
function buildCoreXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + "<dc:creator>docconvert</dc:creator>"
    + "<cp:revision>1</cp:revision>"
    + "</cp:coreProperties>";
}

/**
 * docProps/app.xml（8.2）：Application=docconvert、AppVersion=程序版本、无 Company。
 * @returns {string}
 */
function buildAppXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
    + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + "<Application>docconvert</Application>"
    + "<AppVersion>" + PROGRAM_VERSION + "</AppVersion>"
    + "</Properties>";
}
