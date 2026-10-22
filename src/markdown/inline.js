/**
 * 行内解析：受控 GFM 子集 → Inline[]（architecture §3.1.1 / §3.3）
 *
 * 支持：text / strong / em / code / link（含自动链接）/ image / br。
 * 降级（原文保留 + requirements §5.2 固定告警）：
 * - 内联 HTML 与 HTML 注释 → inline-html-unsupported
 * - 脚注引用 [^x] → footnote-unsupported
 * - 删除线 ~~x~~ → strikethrough-unsupported
 * - 数学公式 $x$ → formula-unsupported
 * - 图片不可内嵌 → image-degraded
 * - 链接目标非 http/https/mailto → link-target-degraded（目标以全角括号追加到可见文字，
 *   渲染层直接渲染 children 即可，不需二次补目标）
 * 未闭合的强调/代码/链接按字面保留（REQ-MD-004），绝不抛异常。
 *
 * @module markdown/inline
 */
import { emitWarning } from "./messages.js";

/** 硬换行的内部哨兵：块级层写入，行内层消费为 { kind: "br" }。 */
export const HARD_BREAK = "\u0000";

/** ASCII 标点（CommonMark 可转义字符集）。 */
const ESCAPABLE = /[!-/:-@[-\`{-~]/;

/** ![alt](src "title") */
const IMAGE = /^!\[([^\]\n]*)\]\(\s*<?([^)>\n]*)>?(?:\s+"([^"\n]*)")?\s*\)/;

/** [文字](href "title") */
const LINK = /^\[([^\]\n]*)\]\(\s*<?([^)>\n]*)>?(?:\s+"([^"\n]*)")?\s*\)/;

/** 自动链接：<https://…> / <mailto:…> */
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^<>\s]+)>/i;

/** 脚注引用 [^id] */
const FOOTNOTE_REF = /^\[\^[^\]\n]+\]/;

/** HTML 注释 */
const HTML_COMMENT = /^<!--[\s\S]*?-->/;

/** HTML 标签（含自闭合） */
const HTML_TAG = /^<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?\/?>/;

/**
 * 解析一段行内文本。
 * @param {string} text
 * @param {{ warn?: Function, resolveAsset?: Function }} ctx
 * @param {number} [line] 1-based 行号（告警用）
 * @param {number} [depth]
 * @returns {Array<object>}
 */
export function parseInline(text, ctx, line, depth = 0) {
  /** @type {Array<object>} */
  const out = [];
  if (typeof text !== "string" || text === "") return out;
  if (depth > 12) {
    pushText(out, text.split(HARD_BREAK).join(""));
    return out;
  }
  for (const segment of splitCodeSpans(text)) {
    if (segment.type === "code") {
      out.push({ kind: "code", text: segment.text });
      continue;
    }
    scanText(segment.text, ctx, line, depth, out);
  }
  return out;
}

/**
 * 先切出行内代码段（反引号成对；未闭合按字面保留）。
 * @param {string} text
 * @returns {Array<{type: "text"|"code", text: string}>}
 */
function splitCodeSpans(text) {
  /** @type {Array<{type: "text"|"code", text: string}>} */
  const segments = [];
  let buffer = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "\`") {
      buffer += text[i];
      i += 1;
      continue;
    }
    let run = 1;
    while (text[i + run] === "\`") run += 1;
    let cursor = i + run;
    let close = -1;
    while (cursor < text.length) {
      if (text[cursor] === "\`") {
        let candidate = 1;
        while (text[cursor + candidate] === "\`") candidate += 1;
        if (candidate === run) {
          close = cursor;
          break;
        }
        cursor += candidate;
        continue;
      }
      cursor += 1;
    }
    if (close < 0) {
      buffer += "\`".repeat(run);
      i += run;
      continue;
    }
    if (buffer !== "") {
      segments.push({ type: "text", text: buffer });
      buffer = "";
    }
    let code = text.slice(i + run, close);
    code = code.split(HARD_BREAK).join("");
    if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") {
      code = code.slice(1, -1);
    }
    segments.push({ type: "code", text: code });
    i = close + run;
  }
  if (buffer !== "") segments.push({ type: "text", text: buffer });
  return segments;
}

/**
 * 扫描一段纯文本（代码段之外），产出 Inline 节点。
 * @param {string} text
 * @param {{ warn?: Function, resolveAsset?: Function }} ctx
 * @param {number} line
 * @param {number} depth
 * @param {Array<object>} out
 */
function scanText(text, ctx, line, depth, out) {
  let buffer = "";
  let i = 0;
  const flush = () => {
    if (buffer !== "") {
      pushText(out, buffer);
      buffer = "";
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === HARD_BREAK) {
      flush();
      out.push({ kind: "br" });
      i += 1;
      continue;
    }

    if (ch === "\\" && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "<") {
      const handled = readAngle(text, i, ctx, line);
      if (handled) {
        if (handled.node) {
          flush();
          out.push(handled.node);
        } else {
          buffer += text.slice(i, i + handled.length);
        }
        i += handled.length;
        continue;
      }
    }

    if (ch === "!" && text[i + 1] === "[") {
      const handled = readImage(text, i, ctx, line);
      if (handled) {
        flush();
        out.push(handled.node);
        i += handled.length;
        continue;
      }
    }

    if (ch === "[") {
      const handled = readBracket(text, i, ctx, line, depth);
      if (handled) {
        if (handled.node) {
          flush();
          out.push(handled.node);
        } else {
          buffer += text.slice(i, i + handled.length);
        }
        i += handled.length;
        continue;
      }
    }

    if (ch === "~" && text[i + 1] === "~") {
      const handled = readStrikethrough(text, i);
      if (handled) {
        emitWarning(ctx, "strikethrough-unsupported", line);
        buffer += text.slice(i, i + handled.length);
        i += handled.length;
        continue;
      }
    }

    if (ch === "$") {
      const handled = readFormula(text, i);
      if (handled) {
        emitWarning(ctx, "formula-unsupported", line);
        buffer += text.slice(i, i + handled.length);
        i += handled.length;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const emphasis = readEmphasis(text, i, ctx, line, depth);
      if (emphasis) {
        flush();
        out.push(emphasis.node);
        i += emphasis.length;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();
}

/**
 * 行内 HTML 注释/标签、自动链接，以及「这里没有语法」的判定。
 * @returns {{length: number, node?: object} | null}
 */
function readAngle(text, start, ctx, line) {
  const rest = text.slice(start);
  const auto = AUTOLINK.exec(rest);
  if (auto) {
    return {
      length: auto[0].length,
      node: { kind: "link", href: auto[1], children: [{ kind: "text", text: auto[1] }] },
    };
  }
  const comment = HTML_COMMENT.exec(rest);
  if (comment) {
    emitWarning(ctx, "inline-html-unsupported", line);
    return { length: comment[0].length };
  }
  const tag = HTML_TAG.exec(rest);
  if (tag) {
    emitWarning(ctx, "inline-html-unsupported", line);
    return { length: tag[0].length };
  }
  return null;
}

/**
 * 图片：交给 ctx.resolveAsset 登记 AssetRef；不可内嵌时告警 image-degraded。
 * @returns {{length: number, node: object} | null}
 */
function readImage(text, start, ctx, line) {
  const match = IMAGE.exec(text.slice(start));
  if (!match) return null;
  return { length: match[0].length, node: buildImage(match[1], match[2].trim(), match[3], ctx, line) };
}

/**
 * @param {string} alt
 * @param {string} rawSrc
 * @param {string} [title]
 * @returns {{kind: "image", assetId: string, alt: string, title?: string}}
 */
function buildImage(alt, rawSrc, title, ctx, line) {
  let asset = null;
  try {
    if (ctx && typeof ctx.resolveAsset === "function") asset = ctx.resolveAsset(rawSrc);
  } catch {
    asset = null;
  }
  /** @type {{kind: "image", assetId: string, alt: string, title?: string}} */
  const node = {
    kind: "image",
    assetId: asset && typeof asset.id === "string" && asset.id !== "" ? asset.id : "asset-unresolved",
    alt,
  };
  if (title) node.title = title;
  if (!asset || asset.resolved !== true) emitWarning(ctx, "image-degraded", line);
  return node;
}

/**
 * 方括号：脚注引用（字面保留 + 告警）优先，其次链接。
 * @returns {{length: number, node?: object} | null}
 */
function readBracket(text, start, ctx, line, depth) {
  const rest = text.slice(start);
  const footnote = FOOTNOTE_REF.exec(rest);
  if (footnote) {
    emitWarning(ctx, "footnote-unsupported", line);
    return { length: footnote[0].length };
  }
  const match = LINK.exec(rest);
  if (!match) return null;
  const href = (match[2] || "").trim();
  const title = match[3];
  const children = parseInline(match[1], ctx, line, depth + 1);
  /** @type {object} */
  let node;
  if (isSupportedTarget(href)) {
    node = { kind: "link", href, children };
  } else {
    emitWarning(ctx, "link-target-degraded", line);
    if (!plainText(children).includes(href)) pushText(children, "（" + href + "）");
    node = { kind: "link", href, children, degraded: true };
  }
  if (title) node.title = title;
  return { length: match[0].length, node };
}

/**
 * 链接目标白名单：http/https/mailto（REQ-ELEM-15/16）。
 * @param {string} href
 * @returns {boolean}
 */
function isSupportedTarget(href) {
  return /^(?:https?:\/\/|mailto:)/i.test(href);
}

/**
 * 删除线（P2 不支持）：返回整段长度，调用方按字面保留。
 * @returns {{length: number} | null}
 */
function readStrikethrough(text, start) {
  const close = text.indexOf("~~", start + 2);
  if (close < 0) return null;
  const inner = text.slice(start + 2, close);
  if (inner === "" || inner.includes(HARD_BREAK)) return null;
  return { length: close + 2 - start };
}

/**
 * 数学公式（P2 不支持）：$…$，首尾不得为空白。
 * @returns {{length: number} | null}
 */
function readFormula(text, start) {
  const close = text.indexOf("$", start + 1);
  if (close < 0) return null;
  const inner = text.slice(start + 1, close);
  if (inner === "" || /^\s|\s$/.test(inner) || inner.includes(HARD_BREAK)) return null;
  return { length: close + 1 - start };
}

/**
 * 强调：**strong** / *em* / __strong__ / _em_；未闭合返回 null（字面保留）。
 * @returns {{length: number, node: object} | null}
 */
function readEmphasis(text, start, ctx, line, depth) {
  const ch = text[start];
  const double = text[start + 1] === ch && text[start + 2] !== ch;
  const length = double ? 2 : 1;
  const openerEnd = start + length;
  if (openerEnd >= text.length) return null;
  const first = text[openerEnd];
  if (first === " " || first === "\t" || first === HARD_BREAK) return null;
  if (ch === "_" && start > 0 && /[0-9A-Za-z\u3400-\u9fff]/.test(text[start - 1])) return null;
  if (depth >= 8) return null;

  const delimiter = ch.repeat(length);
  let searchFrom = openerEnd;
  while (searchFrom < text.length) {
    const close = text.indexOf(delimiter, searchFrom);
    if (close < 0) return null;
    let slashes = 0;
    for (let k = close - 1; k >= 0 && text[k] === "\\"; k -= 1) slashes += 1;
    if (slashes % 2 === 1) {
      searchFrom = close + length;
      continue;
    }
    const inner = text.slice(openerEnd, close);
    if (inner === "" || /^\s|\s$/.test(inner)) {
      searchFrom = close + length;
      continue;
    }
    if (ch === "_") {
      const after = text[close + length];
      if (after && /[0-9A-Za-z]/.test(after)) {
        searchFrom = close + length;
        continue;
      }
    }
    const children = parseInline(inner, ctx, line, depth + 1);
    return { length: close + length - start, node: { kind: double ? "strong" : "em", children } };
  }
  return null;
}

/**
 * 追加文本节点（合并相邻 text，避免碎片）。
 * @param {Array<object>} nodes
 * @param {string} text
 */
function pushText(nodes, text) {
  if (text === "") return;
  const last = nodes[nodes.length - 1];
  if (last && last.kind === "text") {
    last.text += text;
    return;
  }
  nodes.push({ kind: "text", text });
}

/**
 * 行内节点的纯文本（用于判断链接文字是否已包含目标）。
 * @param {Array<object>} nodes
 * @returns {string}
 */
function plainText(nodes) {
  let out = "";
  for (const node of nodes || []) {
    if (node.kind === "text" || node.kind === "code") out += node.text;
    else if (node.kind === "br") out += " ";
    else if (node.children) out += plainText(node.children);
  }
  return out;
}
