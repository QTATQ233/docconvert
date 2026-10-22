/**
 * 模板解析（architecture §3.5 / §4）：模板是版式的**唯一**来源。
 *
 * 渲染器不读 config/default.yml，也不写字号/颜色/边距常量；它只做三件事：
 * ① 复制模板部件（styles/settings/fontTable/numbering/footer + 属性部件）；
 * ② 从模板 document.xml 的 sectPr 取页面几何（版心宽高 → 表格宽度、图片上限）；
 * ③ 只写 w:pStyle 引用与结构性直接属性（numPr、tblW/tblLayout、书签、域代码、图片 extent）。
 *
 * 模板不合格（缺部件 / 缺样式 / 缺 sectPr / 含 updateFields）一律 template-missing（退出码 4），
 * 不猜默认值（全局约束 3：失败必须明确报错）。
 *
 * @module docx/template
 */
import { readFile } from "node:fs/promises";
import { DocconvertError } from "../contracts/errors.js";
import { TEMPLATE_REQUIRED_PARTS } from "../contracts/index.js";
import { EMU_PER_CM, EMU_PER_TWIP, twipsToCm } from "./xml.js";
import { zipRead } from "./zip.js";

/** 冻结的 15 个样式 ID（architecture §4.3）。 */
export const FROZEN_STYLE_IDS = Object.freeze([
  "Normal",
  "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6",
  "DocTitle", "TOC1", "TOC2", "TOC3",
  "CodeBlock", "TableText", "Quote", "FooterText", "CharacterInlineCode",
]);

/**
 * 辅助样式 ID（§4.3 之外，用于消除渲染器里的版式常量，见 build-template.js 头注）。
 * 缺任意一个 → template-missing：宁可启动失败，也不退回硬编码。
 */
export const AUX_STYLE_IDS = Object.freeze([
  "Hyperlink", "HrLine", "CoverRule", "TocTitle", "TableDoc", "TableGap",
]);

/**
 * 读取并校验模板。
 * @param {string} templatePath 模板绝对路径（不接受其它值）
 * @returns {Promise<{
 *   parts: Map<string, Buffer>,
 *   sectionXml: string,
 *   geometry: { pageWidthTwips: number, pageHeightTwips: number, textWidthTwips: number, textHeightTwips: number, imageMaxWidthEmu: number, imageMaxHeightEmu: number },
 *   rels: Array<{ id: string, type: string, target: string, targetMode: string|null }>,
 *   maxRelId: number,
 *   numbering: { xml: string, bulletNumId: number, decimalNumId: number, decimalAbstractId: number, maxNumId: number },
 *   styleIds: Set<string>
 * }>}
 */
export async function loadTemplate(templatePath) {
  let buffer;
  try {
    buffer = await readFile(templatePath);
  } catch (error) {
    const code = error && typeof error === "object" ? /** @type {any} */ (error).code : "";
    throw new DocconvertError("template-missing", `内置模板无法读取：${templatePath}`, {
      hint: "重新安装 docconvert，或运行 node tools/build-template.js 重新生成模板",
      detail: { reason: code === "ENOENT" ? "missing" : "unreadable", templatePath, errno: code },
      cause: error,
    });
  }

  /** @type {Map<string, Buffer>} */
  let parts;
  try {
    parts = zipRead(buffer);
  } catch (error) {
    throw new DocconvertError("template-missing", `内置模板损坏（ZIP 无法解析）：${templatePath}`, {
      hint: "运行 node tools/build-template.js 重新生成模板",
      detail: { reason: "zip-invalid", templatePath },
      cause: error,
    });
  }

  const missingParts = TEMPLATE_REQUIRED_PARTS.filter((part) => !parts.has(part));
  if (missingParts.length > 0) {
    throw new DocconvertError("template-missing", `内置模板缺少必需部件：${missingParts.join("、")}`, {
      detail: { reason: "missing-parts", missing: missingParts },
    });
  }

  const stylesXml = partText(parts, "word/styles.xml");
  const styleIds = new Set(extractAll(stylesXml, /w:styleId="([^"]+)"/g));
  const missingStyles = [...FROZEN_STYLE_IDS, ...AUX_STYLE_IDS].filter((id) => !styleIds.has(id));
  if (missingStyles.length > 0) {
    throw new DocconvertError("template-missing", `内置模板缺少必需样式：${missingStyles.join("、")}`, {
      hint: "运行 node tools/build-template.js 重新生成模板（样式清单见 architecture §4.3）",
      detail: { reason: "missing-styles", missing: missingStyles },
    });
  }

  const documentXml = partText(parts, "word/document.xml");
  const sectionMatch = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(documentXml);
  if (!sectionMatch) {
    throw new DocconvertError("template-missing", "内置模板缺少 sectPr（页面设置）", {
      detail: { reason: "missing-sectpr" },
    });
  }
  const sectionXml = sectionMatch[0];
  const geometry = computeGeometry(sectionXml);

  const settingsXml = partText(parts, "word/settings.xml");
  if (/<w:updateFields\b/.test(settingsXml)) {
    // E2 裁决：永不请求更新域（REQ-TOC-010：打开不弹窗）。模板带了就立即失败。
    throw new DocconvertError("template-missing", "内置模板 settings.xml 含 w:updateFields（违反 E2 裁决）", {
      hint: "运行 node tools/build-template.js 重新生成模板",
      detail: { reason: "update-fields-forbidden" },
    });
  }

  const relsXml = partText(parts, "word/_rels/document.xml.rels");
  const rels = parseRelationships(relsXml);
  const maxRelId = rels.reduce((max, rel) => Math.max(max, numericId(rel.id)), 0);

  const numberingXml = parts.has("word/numbering.xml") ? partText(parts, "word/numbering.xml") : "";
  const numbering = parseNumbering(numberingXml);

  return { parts, sectionXml, geometry, rels, maxRelId, numbering: { ...numbering, xml: numberingXml }, styleIds };
}

/**
 * 版心几何：全部来自模板 sectPr，渲染器据此算表格宽度与图片上限。
 * 图片宽度上限取「版心宽按 0.1cm 取整」（9638 twips → 17.0 cm → 6,120,000 EMU），
 * 高度上限取「版心高减去页眉/页脚保留带」，保证整图不跨越页眉页脚区。
 * @param {string} sectionXml
 */
function computeGeometry(sectionXml) {
  const pgSz = matchAttributes(sectionXml, "<w:pgSz\\b([^>]*)>");
  const pgMar = matchAttributes(sectionXml, "<w:pgMar\\b([^>]*)>");
  if (!pgSz || !pgMar) {
    throw new DocconvertError("template-missing", "内置模板 sectPr 缺少 pgSz 或 pgMar", {
      detail: { reason: "missing-page-setup" },
    });
  }
  const pageWidthTwips = toNumber(pgSz["w:w"]);
  const pageHeightTwips = toNumber(pgSz["w:h"]);
  const top = toNumber(pgMar["w:top"]);
  const bottom = toNumber(pgMar["w:bottom"]);
  const left = toNumber(pgMar["w:left"]);
  const right = toNumber(pgMar["w:right"]);
  const header = toNumber(pgMar["w:header"], 0);
  const footer = toNumber(pgMar["w:footer"], 0);
  const textWidthTwips = pageWidthTwips - left - right;
  const textHeightTwips = pageHeightTwips - top - bottom;
  if (!(textWidthTwips > 0) || !(textHeightTwips > 0)) {
    throw new DocconvertError("template-missing", "内置模板 sectPr 的版心尺寸非法", {
      detail: { reason: "invalid-page-setup", textWidthTwips, textHeightTwips },
    });
  }
  const usableHeightTwips = Math.max(1, textHeightTwips - header - footer);
  return {
    pageWidthTwips,
    pageHeightTwips,
    textWidthTwips,
    textHeightTwips,
    imageMaxWidthEmu: Math.round(twipsToCm(textWidthTwips) * EMU_PER_CM),
    imageMaxHeightEmu: Math.round(usableHeightTwips * EMU_PER_TWIP),
  };
}

/**
 * word/_rels/document.xml.rels → 关系表。
 * @param {string} relsXml
 * @returns {Array<{ id: string, type: string, target: string, targetMode: string|null }>}
 */
function parseRelationships(relsXml) {
  /** @type {Array<{ id: string, type: string, target: string, targetMode: string|null }>} */
  const rels = [];
  const pattern = /<Relationship\b([^>]*)\/?>/g;
  let hit = pattern.exec(relsXml);
  while (hit) {
    const attrs = parseAttributes(hit[1]);
    if (attrs.Id) {
      rels.push({
        id: attrs.Id,
        type: attrs.Type ?? "",
        target: attrs.Target ?? "",
        targetMode: attrs.TargetMode ?? null,
      });
    }
    hit = pattern.exec(relsXml);
  }
  return rels;
}

/**
 * 解析 numbering.xml：取项目符号与十进制编号的 numId / abstractNumId。
 * @param {string} numberingXml
 */
function parseNumbering(numberingXml) {
  /** @type {Map<number, number>} */ const numToAbstract = new Map();
  /** @type {Map<number, string>} */ const abstractFmt = new Map();
  /** @type {number} */ let maxNumId = 0;

  const numPattern = /<w:num\b[^>]*w:numId="(\d+)"[^>]*>\s*<w:abstractNumId\s+w:val="(\d+)"/g;
  let hit = numPattern.exec(numberingXml);
  while (hit) {
    const numId = Number(hit[1]);
    numToAbstract.set(numId, Number(hit[2]));
    maxNumId = Math.max(maxNumId, numId);
    hit = numPattern.exec(numberingXml);
  }

  const abstractPattern = /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g;
  let absHit = abstractPattern.exec(numberingXml);
  while (absHit) {
    const fmt = /<w:numFmt\s+w:val="([^"]+)"/.exec(absHit[2]);
    abstractFmt.set(Number(absHit[1]), fmt ? fmt[1] : "");
    absHit = abstractPattern.exec(numberingXml);
  }

  let bulletNumId = 0;
  let decimalNumId = 0;
  let decimalAbstractId = -1;
  for (const [numId, abstractId] of numToAbstract) {
    const fmt = abstractFmt.get(abstractId) ?? "";
    if (fmt === "bullet" && bulletNumId === 0) bulletNumId = numId;
    if (fmt === "decimal" && decimalNumId === 0) {
      decimalNumId = numId;
      decimalAbstractId = abstractId;
    }
  }
  if (bulletNumId === 0 || decimalNumId === 0) {
    throw new DocconvertError("template-missing", "内置模板 numbering.xml 缺少项目符号或十进制编号定义", {
      hint: "运行 node tools/build-template.js 重新生成模板",
      detail: { reason: "missing-numbering", bulletNumId, decimalNumId },
    });
  }
  return { bulletNumId, decimalNumId, decimalAbstractId, maxNumId };
}

/**
 * @param {Map<string, Buffer>} parts
 * @param {string} name
 * @returns {string}
 */
function partText(parts, name) {
  const buffer = parts.get(name);
  return buffer ? buffer.toString("utf8") : "";
}

/**
 * @param {string} xml
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function extractAll(xml, pattern) {
  /** @type {string[]} */ const out = [];
  let hit = pattern.exec(xml);
  while (hit) {
    out.push(hit[1]);
    hit = pattern.exec(xml);
  }
  return out;
}

/**
 * @param {string} xml
 * @param {string} patternSource
 * @returns {Record<string, string> | null}
 */
function matchAttributes(xml, patternSource) {
  const hit = new RegExp(patternSource).exec(xml);
  return hit ? parseAttributes(hit[1]) : null;
}

/**
 * @param {string} body
 * @returns {Record<string, string>}
 */
function parseAttributes(body) {
  /** @type {Record<string, string>} */ const attrs = {};
  const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let hit = pattern.exec(body);
  while (hit) {
    attrs[hit[1]] = hit[2];
    hit = pattern.exec(body);
  }
  return attrs;
}

/**
 * @param {string|undefined} value
 * @param {number} [fallback]
 * @returns {number}
 */
function toNumber(value, fallback = Number.NaN) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {string} id 例如 "rId3"
 * @returns {number}
 */
function numericId(id) {
  const parsed = Number(String(id).replace(/^rId/, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
