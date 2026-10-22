/**
 * config-loader（architecture §2.2 模块 11 / §4.1 / §4.4 / §4.6）。
 *
 * 职责：
 * - 读取随包内置的 config/default.yml（**自写 YAML 子集解析**，不引入第三方库）；
 * - 白名单 / 黑名单校验（REQ-TPL-005/006）；
 * - 与模板双向一致性校验：把 default.yml 声明的版式值（pt）与模板 styles.xml 的
 *   w:sz（half-points）逐项比对；不等 → template-missing（由 precheck 抛）。
 *   模板未显式声明的样式尺寸不判死（构建期由 tools/build-template.js 保证全覆盖，
 *   见卡 3 的模板构建测试）；样式 ID 缺失一律视为模板损坏。
 *
 * 纪律：不读 CWD / 用户主目录 / 环境变量，没有 --config（REQ-TPL-004）。
 *
 * @module config
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DocconvertError } from "../contracts/errors.js";

export const CONFIG_REL_PATH = "config/default.yml";

/**
 * 白名单叶子键（冻结，architecture §4.4）。
 * @type {ReadonlySet<string>}
 */
export const ALLOWED_KEYS = new Set([
  "page.size",
  "page.margins.top", "page.margins.bottom", "page.margins.left", "page.margins.right",
  "fonts.latin", "fonts.cjk", "fonts.mono",
  "fonts.cjkFallback", "fonts.latinFallback", "fonts.monoFallback",
  "sizes.body", "sizes.h1", "sizes.h2", "sizes.h3", "sizes.h4", "sizes.h5", "sizes.h6",
  "sizes.table", "sizes.code", "sizes.footer", "sizes.toc", "sizes.coverTitle",
  "colors.tableHeaderFill", "colors.codeFill", "colors.link", "colors.footerText",
  "table.widthCm", "table.cellPaddingTwips", "table.afterSpacePt",
  "layout.bodyLineSpacing", "layout.bodyFirstLineIndentChars",
  "layout.longdocHeadingThreshold", "layout.h1PageBreak",
  "toc.depth", "toc.bookmarkDepth",
  "output.dirName", "output.docxExt", "output.pdfExt",
  "log.fileName",
  "images.maxWidthCm",
]);

/** 黑名单关键词（键名与字符串值双向扫描，REQ-TPL-006）。 */
const BLACKLIST_PATTERN = /(path|url|http|template|reference|theme|date|time|random|seed)/i;

/**
 * 模板样式 ID → config 字号键（双源校验，architecture §4.3/§4.6）。
 * 模板未声明 w:sz 的样式不参与比对。
 * @type {Readonly<Record<string, string>>}
 */
export const STYLE_SIZE_TOKENS = Object.freeze({
  Normal: "sizes.body",
  Heading1: "sizes.h1",
  Heading2: "sizes.h2",
  Heading3: "sizes.h3",
  Heading4: "sizes.h4",
  Heading5: "sizes.h5",
  Heading6: "sizes.h6",
  DocTitle: "sizes.coverTitle",
  TOC1: "sizes.toc",
  TOC2: "sizes.toc",
  TOC3: "sizes.toc",
  CodeBlock: "sizes.code",
  TableText: "sizes.table",
  FooterText: "sizes.footer",
});

/**
 * 模板必须且仅必须定义的样式 ID（architecture §4.3）。
 * @type {ReadonlyArray<string>}
 */
export const REQUIRED_STYLE_IDS = Object.freeze([
  "Normal", "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6",
  "DocTitle", "TOC1", "TOC2", "TOC3", "CodeBlock", "TableText", "Quote", "FooterText",
  "CharacterInlineCode",
]);

/**
 * 解析 YAML 子集：两空格缩进的嵌套映射、标量、行内数组、# 注释。
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseYamlSubset(text) {
  /** @type {Array<{ indent: number, obj: Record<string, unknown> }>} */
  const stack = [{ indent: -1, obj: {} }];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    const sep = body.indexOf(":");
    if (sep <= 0) {
      throw new DocconvertError("template-missing", `config/default.yml 第 ${i + 1} 行无法解析：${body}`, {
        detail: { line: i + 1 },
      });
    }
    const key = body.slice(0, sep).trim();
    const rest = body.slice(sep + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (rest === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = parseScalar(rest, i + 1);
    }
  }
  return stack[0].obj;
}

/**
 * @param {string} raw
 * @returns {string}
 */
function stripComment(raw) {
  let inQuote = null;
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === "[") { depth += 1; continue; }
    if (ch === "]") { depth -= 1; continue; }
    if (ch === "#" && depth === 0 && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i).replace(/\s+$/, "");
    }
  }
  return raw;
}

/**
 * @param {string} text
 * @param {number} lineNo
 * @returns {unknown}
 */
function parseScalar(text, lineNo) {
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((part) => parseScalar(part.trim(), lineNo));
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return /^["'].*["']$/.test(text) ? text.slice(1, -1) : text;
}

/**
 * 把嵌套对象摊平为 "a.b.c" → value。
 * @param {Record<string, unknown>} obj
 * @param {string} [prefix]
 * @returns {Map<string, unknown>}
 */
export function flattenConfig(obj, prefix = "") {
  /** @type {Map<string, unknown>} */
  const out = new Map();
  for (const [key, value] of Object.entries(obj)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flattenConfig(/** @type {Record<string, unknown>} */ (value), dotted)) out.set(k, v);
    } else {
      out.set(dotted, value);
    }
  }
  return out;
}

/**
 * 按点路径取值。
 * @param {Record<string, any>} config
 * @param {string} dotted
 * @returns {unknown}
 */
export function valueAt(config, dotted) {
  let current = config;
  for (const part of dotted.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

/**
 * 白名单 + 黑名单校验。
 * @param {Map<string, unknown>} flat
 */
function validateConfig(flat) {
  for (const [key, value] of flat) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new DocconvertError("template-missing", `config/default.yml 含非法键：${key}`, {
        detail: { key, reason: "not-in-whitelist" },
      });
    }
    if (BLACKLIST_PATTERN.test(key)) {
      throw new DocconvertError("template-missing", `config/default.yml 的键命中黑名单关键词：${key}`, {
        detail: { key, reason: "blacklisted-key" },
      });
    }
    if (typeof value === "string" && BLACKLIST_PATTERN.test(value)) {
      throw new DocconvertError("template-missing", `config/default.yml 的值命中黑名单关键词：${key}=${value}`, {
        detail: { key, reason: "blacklisted-value" },
      });
    }
  }
}

/**
 * 读取并校验随包内置的 config/default.yml。
 * @param {{ packageRoot: string }} options
 * @returns {Promise<{ config: Record<string, any>, flat: Map<string, unknown>, sourcePath: string }>}
 */
export async function loadConfig({ packageRoot }) {
  const sourcePath = join(packageRoot, CONFIG_REL_PATH);
  let text;
  try {
    text = await readFile(sourcePath, "utf8");
  } catch (error) {
    throw new DocconvertError("template-missing", `内置配置缺失：${sourcePath}`, {
      detail: { reason: "config-missing" },
      cause: error,
    });
  }
  const parsed = parseYamlSubset(text);
  const flat = flattenConfig(parsed);
  validateConfig(flat);
  return { config: parsed, flat, sourcePath };
}

/**
 * 双向一致性校验（architecture §4.1/§4.6）：config 的 pt 值 × 2 == 模板 w:sz。
 * @param {{ config: Record<string, any>, styles: Map<string, { sz?: number, eastAsia?: string }> }} input
 * @returns {{ mismatches: Array<{ styleId: string, key: string, expected: number, actual: number }>, compared: number }}
 */
export function verifyTemplateConsistency({ config, styles }) {
  /** @type {Array<{ styleId: string, key: string, expected: number, actual: number }>} */
  const mismatches = [];
  let compared = 0;
  for (const [styleId, key] of Object.entries(STYLE_SIZE_TOKENS)) {
    const style = styles.get(styleId);
    if (!style || typeof style.sz !== "number") continue; // 模板未声明：由构建期模板测试保证
    const pt = Number(valueAt(config, key));
    if (!Number.isFinite(pt)) continue;
    const expected = Math.round(pt * 2);
    compared += 1;
    if (style.sz !== expected) {
      mismatches.push({ styleId, key, expected, actual: style.sz });
    }
  }
  return { mismatches, compared };
}
