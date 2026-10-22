/**
 * OOXML 片段工具：转义、字符清洗、单位换算（architecture §4.2 单位约定）。
 *
 * 只做机械换算，不承载任何版式常量：字号/颜色/边距全部来自模板样式。
 * 单位：twips（1/1440 in）、half-points（w:sz）、EMU（1/914400 in）。
 *
 * @module docx/xml
 */

/** 1 cm = 567 twips（OOXML 通行取整，与 T04 = 9638 一致：17.0 cm）。 */
export const TWIPS_PER_CM = 567;
/** 1 cm = 360000 EMU。 */
export const EMU_PER_CM = 360000;
/** 1 twip = 635 EMU。 */
export const EMU_PER_TWIP = 635;
/** 96 dpi 下 1 px = 9525 EMU。 */
export const EMU_PER_PX_96 = 9525;

/**
 * 文本节点转义（& < >）。
 * @param {string} text
 * @returns {string}
 */
export function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 属性值转义（额外处理引号）。
 * @param {string} text
 * @returns {string}
 */
export function escAttr(text) {
  return esc(text).replace(/"/g, "&quot;");
}

/**
 * XML 1.0 非法字符清洗（控制字符、孤立代理项）：保留内容语义，不静默丢正文。
 * @param {string} text
 * @returns {string}
 */
export function cleanXmlChars(text) {
  let out = "";
  for (const ch of String(text)) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x9 || code === 0xa || code === 0xd) { out += ch; continue; }
    if (code < 0x20) continue;
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (code === 0xfffe || code === 0xffff) continue;
    out += ch;
  }
  return out;
}

/**
 * 直接写进 <w:t> 的文本：清洗 + 转义。
 * @param {string} text
 * @returns {string}
 */
export function textXml(text) {
  return esc(cleanXmlChars(text));
}

/**
 * twips → EMU。
 * @param {number} twips
 * @returns {number}
 */
export function twipsToEmu(twips) {
  return Math.round(twips * EMU_PER_TWIP);
}

/**
 * twips → 0.1 cm 精度的厘米数（版心宽度取整，见 index.js 图片上限说明）。
 * @param {number} twips
 * @returns {number}
 */
export function twipsToCm(twips) {
  return Math.round((twips / TWIPS_PER_CM) * 10) / 10;
}

/**
 * px@96dpi → EMU。
 * @param {number} px
 * @returns {number}
 */
export function pxToEmu(px) {
  return Math.round(px * EMU_PER_PX_96);
}

/**
 * 内联树扁平化为纯文本（目录条目/图片 alt 用）。
 * @param {Array<object>} inlines
 * @returns {string}
 */
export function inlineText(inlines) {
  let out = "";
  for (const inline of inlines ?? []) {
    if (!inline) continue;
    if (inline.kind === "text" || inline.kind === "code") out += inline.text;
    else if (inline.kind === "br") out += " ";
    else if (inline.kind === "image") out += inline.alt ?? "";
    else if (inline.children) out += inlineText(inline.children);
  }
  return out;
}

/**
 * 从 XML 文本里取第一个 <tag .../> 的属性表。
 * @param {string} xml
 * @param {string} tag 例如 "w:pgSz"
 * @returns {Record<string, string> | null}
 */
export function readAttributes(xml, tag) {
  const match = new RegExp(`<${tag}\\b([^>]*)>`).exec(xml);
  if (!match) return null;
  /** @type {Record<string, string>} */
  const attrs = {};
  const body = match[1];
  const attrPattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let hit = attrPattern.exec(body);
  while (hit) {
    attrs[hit[1]] = hit[2];
    hit = attrPattern.exec(body);
  }
  return attrs;
}
