/**
 * markdown-parser：受控 GFM 子集 → Block[]（architecture §3.3 / §3.12 冻结签名）
 *
 * 边界（architecture §3.3）：
 * - 只做语法解析：不读文件、不决定样式、不收集目录（目录由 docx-render 的 collectTocEntries 负责）。
 * - 软换行拼接走 soft-join.js（与 .txt 同一实现，REQ-MD-002 / REQ-TXT-002）。
 * - 书签 _TocNNNN 只对 H1–H6 生成，按全文出现顺序；由 ctx.nextBookmark() 注入，
 *   缺省时用内部单调计数器兜底（同一输入两次解析结果相同）。
 * - 三态降级：任务列表 / 脚注 / 内联 HTML / 缩进代码块 / 引用超深 / 列表超深 /
 *   表格缺分隔行或行列不齐 / front matter / 删除线 / 公式 / 不可内嵌图片 / 非 http(s)/mailto 链接。
 * - 永不抛异常：任何未预期错误都退化为「原文保留的段落」（REQ-MD-004）。
 *
 * @module markdown
 */
import { emitWarning } from "./messages.js";
import { joinSoftPair } from "./soft-join.js";
import { parseInline, HARD_BREAK } from "./inline.js";
import { splitRow, alignOf, isDelimiterRow, hasUnescapedPipe } from "./table.js";

/** 空行（仅空白）。 */
const BLANK = /^[ \t]*$/;
/** 围栏开始：≤3 空格缩进 + ≥3 个反引号或波浪号 + info string。 */
const FENCE_OPEN = /^( {0,3})(\`{3,}|~{3,})(.*)$/;
/** ATX 标题：# 后必须有空格（或行尾）；允许闭合式 ### 标题 ###。 */
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
/** 分隔线：≥3 个 * - _，中间允许空格。 */
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** Setext 下划线：=== 或 ---。 */
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
/** 引用行前缀。 */
const QUOTE_PREFIX = /^ {0,3}>/;
/** 引用前缀（可多层：> > / >>）。 */
const QUOTE_MARKERS = /^(?: {0,3}>[ \t]?)+/;
/** 无序列表项。 */
const UNORDERED = /^([ \t]*)([-+*])([ \t]+)(.*)$/;
/** 有序列表项（1–9 位数字 + . 或 )）。 */
const ORDERED = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(.*)$/;
/** 脚注定义行。 */
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]]+\]:/;

/**
 * 解析 Markdown 文本（architecture §3.12 冻结签名）。
 * @param {string} text 已规范换行（CRLF/CR → LF）的源码
 * @param {{ sourcePath?: string, resolveAsset?: Function, warn?: Function, nextBookmark?: Function }} ctx
 * @returns {Array<object>} Block[]
 */
export function parseMarkdown(text, ctx) {
  const source = typeof text === "string" ? text : text == null ? "" : String(text);
  const lines = source.split(/\r\n|\r|\n/);
  const state = {
    ctx: ctx && typeof ctx === "object" ? ctx : {},
    fallbackBookmarks: 0,
  };
  try {
    return parseBlocks(lines, 1, state, { listDepth: 0 });
  } catch {
    const fallback = lines.join("\n").trim();
    return fallback === "" ? [] : [{ kind: "paragraph", children: [{ kind: "text", text: fallback }] }];
  }
}

/**
 * 块级解析主循环。
 * @param {string[]} lines
 * @param {number} baseLine 本段第一行在源文件中的 1-based 行号
 * @param {{ctx: object, fallbackBookmarks: number}} state
 * @param {{listDepth: number}} opts
 * @returns {Array<object>}
 */
function parseBlocks(lines, baseLine, state, opts) {
  const ctx = state.ctx;
  const listDepth = opts && opts.listDepth ? opts.listDepth : 0;
  /** @type {Array<object>} */
  const blocks = [];
  let i = 0;
  let frontMatterChecked = false;

  while (i < lines.length) {
    const line = lines[i];
    const lineNo = baseLine + i;
    if (BLANK.test(line)) {
      i += 1;
      continue;
    }

    if (!frontMatterChecked) {
      frontMatterChecked = true;
      if (i === 0 && line.trim() === "---") {
        const end = findFrontMatterEnd(lines);
        if (end > 0) {
          emitWarning(ctx, "front-matter-not-recognized", lineNo);
          blocks.push({ kind: "hr" });
          blocks.push(...frontMatterParagraphs(lines, 1, end, lineNo + 1, state));
          i = end + 1;
          continue;
        }
      }
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence && !(fence[2][0] === "\`" && fence[3].includes("\`"))) {
      const parsed = parseFence(lines, i);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    if (QUOTE_PREFIX.test(line)) {
      const parsed = parseBlockquote(lines, i, lineNo, state, listDepth);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      const level = atx[1].length;
      const headingText = String(atx[2] == null ? "" : atx[2]).replace(/[ \t]+#+[ \t]*$/, "").trim();
      blocks.push(makeHeading(level, headingText, state, lineNo));
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const parsed = parseTable(lines, i, lineNo, state);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    if (matchListItem(line)) {
      const parsed = parseList(lines, i, lineNo, state, listDepth);
      if (parsed.block) blocks.push(parsed.block);
      blocks.push(...parsed.blocks);
      i = parsed.next;
      continue;
    }

    if (FOOTNOTE_DEF.test(line)) {
      let cursor = i;
      const raw = [];
      while (cursor < lines.length && !BLANK.test(lines[cursor])) {
        raw.push(lines[cursor]);
        cursor += 1;
      }
      emitWarning(ctx, "footnote-unsupported", lineNo);
      blocks.push({ kind: "paragraph", children: [{ kind: "text", text: raw.map((v) => v.trim()).join(" ") }] });
      i = cursor;
      continue;
    }

    if (indentWidth(line) >= 4) {
      let cursor = i;
      const raw = [];
      while (cursor < lines.length && !BLANK.test(lines[cursor]) && indentWidth(lines[cursor]) >= 4) {
        raw.push(stripIndent(lines[cursor], 4));
        cursor += 1;
      }
      emitWarning(ctx, "indented-code-unsupported", lineNo);
      blocks.push({ kind: "paragraph", children: buildInlineFromLines(raw, lineNo, state) });
      i = cursor;
      continue;
    }

    if (/^ {0,3}\|/.test(line)) {
      let cursor = i;
      const raw = [];
      while (cursor < lines.length && !BLANK.test(lines[cursor]) && /^ {0,3}\|/.test(lines[cursor])) {
        raw.push(lines[cursor]);
        cursor += 1;
      }
      emitWarning(ctx, "table-malformed", lineNo);
      blocks.push({ kind: "paragraph", children: buildInlineFromLines(raw, lineNo, state) });
      i = cursor;
      continue;
    }

    if (i + 1 < lines.length && SETEXT.test(lines[i + 1])) {
      const marker = lines[i + 1].trim()[0];
      const level = marker === "=" ? 1 : 2;
      blocks.push(makeHeading(level, line.trim(), state, lineNo));
      i += 2;
      continue;
    }

    const paragraph = collectParagraph(lines, i, lineNo, state);
    blocks.push({ kind: "paragraph", children: paragraph.children });
    i = paragraph.next;
  }

  return blocks;
}

/**
 * 收集一个段落（遇到空行 / 新块起点停止）。
 * @returns {{children: Array<object>, next: number}}
 */
function collectParagraph(lines, start, startLineNo, state) {
  const raw = [];
  let cursor = start;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (BLANK.test(line)) break;
    if (cursor > start) {
      const fence = FENCE_OPEN.exec(line);
      if (fence && !(fence[2][0] === "\`" && fence[3].includes("\`"))) break;
      if (ATX.test(line)) break;
      if (HR.test(line)) break;
      if (QUOTE_PREFIX.test(line)) break;
      if (FOOTNOTE_DEF.test(line)) break;
      if (isTableStart(lines, cursor)) break;
      const marker = matchListItem(line);
      if (marker && (!marker.ordered || marker.number === 1)) break;
    }
    raw.push(line);
    cursor += 1;
  }
  return { children: buildInlineFromLines(raw, startLineNo, state), next: cursor };
}

/**
 * 把段落/单元格的多行源码拼成 Inline[]：软换行按 REQ-TXT-002，行尾 2 空格或
 * 未转义反斜杠产生硬换行 { kind: "br" }（REQ-MD-003）。
 * @param {string[]} rawLines
 * @param {number} startLineNo
 * @param {{ctx: object}} state
 * @returns {Array<object>}
 */
function buildInlineFromLines(rawLines, startLineNo, state) {
  let out = "";
  let previousHard = false;
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];
    let content = raw.trim();
    let hard = / {2,}$/.test(raw);
    const trailing = /\\+$/.exec(content);
    if (trailing && trailing[0].length % 2 === 1) {
      hard = true;
      content = content.slice(0, -1);
    }
    if (content === "") continue;
    if (out === "") out = content;
    else if (previousHard) out += content;
    else out = joinSoftPair(out, content);
    if (hard && index < rawLines.length - 1) {
      out += HARD_BREAK;
      previousHard = true;
    } else {
      previousHard = false;
    }
  }
  while (out.endsWith(HARD_BREAK)) out = out.slice(0, -1);
  if (out === "") return [];
  return parseInline(out, state.ctx, startLineNo);
}

/**
 * 围栏代码块：围栏内不解析任何 Markdown；未闭合时从围栏行到文末全部作为代码内容。
 * @returns {{block: object, next: number}}
 */
function parseFence(lines, start) {
  const open = FENCE_OPEN.exec(lines[start]);
  const fenceChar = open[2][0];
  const minLength = open[2].length;
  const info = String(open[3] == null ? "" : open[3]).trim();
  const lang = info.split(/[ \t]+/)[0];
  const closePattern =
    fenceChar === "\`" ? new RegExp("^ {0,3}\`{" + minLength + ",}[ \\t]*$") : new RegExp("^ {0,3}~{" + minLength + ",}[ \\t]*$");
  const content = [];
  let cursor = start + 1;
  while (cursor < lines.length) {
    if (closePattern.test(lines[cursor])) {
      cursor += 1;
      break;
    }
    content.push(lines[cursor]);
    cursor += 1;
  }
  const block = { kind: "code", text: content.join("\n") };
  if (lang) block.lang = lang;
  return { block, next: cursor };
}

/**
 * 引用块：≤2 级，第 3 级起并入第 2 级并告警。
 * @returns {{block: object, next: number}}
 */
function parseBlockquote(lines, start, startLineNo, state, listDepth) {
  const inner = [];
  let maxMarkers = 0;
  let cursor = start;
  while (cursor < lines.length) {
    if (!QUOTE_PREFIX.test(lines[cursor])) break;
    const markers = QUOTE_MARKERS.exec(lines[cursor]);
    const count = (markers[0].match(/>/g) || []).length;
    if (count > maxMarkers) maxMarkers = count;
    inner.push(lines[cursor].slice(markers[0].length));
    cursor += 1;
  }
  if (maxMarkers > 2) emitWarning(state.ctx, "quote-depth-clamped", startLineNo);
  const depth = maxMarkers > 1 ? 2 : 1;
  const children = parseBlocks(inner, startLineNo, state, { listDepth });
  return { block: { kind: "blockquote", depth, children }, next: cursor };
}

/**
 * 列表：≤3 级；超深并入第 3 级并告警；任务列表保留 [ ]/[x] 字面并告警。
 * @returns {{block: object|null, blocks: Array<object>, next: number}}
 */
function parseList(lines, start, startLineNo, state, listDepth) {
  const first = matchListItem(lines[start]);
  const ordered = first.ordered;
  const listIndent = first.indent;
  const depth = listDepth + 1;

  if (depth > 3) {
    emitWarning(state.ctx, "list-depth-clamped", startLineNo);
    /** @type {Array<object>} */
    const blocks = [];
    let cursor = start;
    while (cursor < lines.length) {
      const marker = matchListItem(lines[cursor]);
      if (!marker || marker.ordered !== ordered || marker.indent !== listIndent) break;
      const collected = collectListItem(lines, cursor, marker, listIndent);
      if (marker.text.trim() !== "") {
        blocks.push({ kind: "paragraph", children: buildInlineFromLines([marker.text], startLineNo, state) });
      }
      for (const extra of collected.raw.slice(1)) {
        if (extra.trim() !== "") {
          blocks.push({ kind: "paragraph", children: buildInlineFromLines([extra], startLineNo, state) });
        }
      }
      cursor = collected.next;
    }
    return { block: null, blocks, next: cursor };
  }

  /** @type {Array<{children: Array<object>}>} */
  const items = [];
  let tight = true;
  let cursor = start;
  while (cursor < lines.length) {
    const marker = matchListItem(lines[cursor]);
    if (!marker || marker.ordered !== ordered || marker.indent !== listIndent) break;
    const collected = collectListItem(lines, cursor, marker, listIndent);
    if (!collected.tight) tight = false;
    if (isTaskItem(collected.raw[0])) emitWarning(state.ctx, "task-list-degraded", startLineNo + (cursor - start));
    const children = parseBlocks(collected.raw, startLineNo + (cursor - start), state, { listDepth: depth });
    items.push({ children });
    cursor = collected.next;
  }

  return {
    block: { kind: "list", ordered, start: ordered ? first.number : 1, tight, items },
    blocks: [],
    next: cursor,
  };
}

/**
 * 收集一个列表项的原文行（续行按内容缩进反缩进）。
 * @returns {{raw: string[], next: number, tight: boolean}}
 */
function collectListItem(lines, start, marker, listIndent) {
  const contentIndent = marker.contentIndent;
  const raw = [marker.text];
  let tight = true;
  let cursor = start + 1;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (BLANK.test(line)) {
      let lookahead = cursor;
      while (lookahead < lines.length && BLANK.test(lines[lookahead])) lookahead += 1;
      if (lookahead >= lines.length) break;
      const nextMarker = matchListItem(lines[lookahead]);
      if (nextMarker && nextMarker.indent >= listIndent) {
        raw.push("");
        tight = false;
        cursor = lookahead;
        continue;
      }
      if (indentWidth(lines[lookahead]) >= contentIndent) {
        raw.push("");
        tight = false;
        cursor = lookahead;
        continue;
      }
      break;
    }
    const nextMarker = matchListItem(line);
    if (nextMarker) {
      if (nextMarker.indent <= listIndent) break;
      raw.push(stripIndent(line, contentIndent));
      cursor += 1;
      continue;
    }
    if (indentWidth(line) >= contentIndent) {
      raw.push(stripIndent(line, contentIndent));
      cursor += 1;
      continue;
    }
    if (!isContinuationLine(lines, cursor)) break;
    raw.push(line.trim());
    cursor += 1;
  }
  return { raw, next: cursor, tight };
}

/**
 * 非缩进行能否作为列表项的惰性续行（不是新块起点即可）。
 * @param {string[]} lines
 * @param {number} index
 * @returns {boolean}
 */
function isContinuationLine(lines, index) {
  const line = lines[index];
  const fence = FENCE_OPEN.exec(line);
  if (fence && !(fence[2][0] === "\`" && fence[3].includes("\`"))) return false;
  if (ATX.test(line)) return false;
  if (HR.test(line)) return false;
  if (QUOTE_PREFIX.test(line)) return false;
  if (FOOTNOTE_DEF.test(line)) return false;
  if (isTableStart(lines, index)) return false;
  return true;
}

/**
 * 是否为任务列表项（requirements REQ-ELEM-10：保留 [ ] / [x] 原文）。
 * @param {string} text
 * @returns {boolean}
 */
function isTaskItem(text) {
  return /^\[[ xX]\](?:[ \t]|$)/.test(String(text == null ? "" : text));
}

/**
 * 表格起点：本行有竖线，且下一行是列数可用的分隔行。
 * @param {string[]} lines
 * @param {number} index
 * @returns {boolean}
 */
function isTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  const head = lines[index];
  const delimiter = lines[index + 1];
  if (!hasUnescapedPipe(head) || !hasUnescapedPipe(delimiter)) return false;
  if (!isDelimiterRow(delimiter)) return false;
  return splitRow(head).length > 0;
}

/**
 * 管道表格：缺分隔行/列数不可用 → 整块降级段落 + table-malformed；
 * 数据行列数不齐 → 补齐或「 / 」并入最后一列 + table-ragged。
 * @returns {{block: object, next: number}}
 */
function parseTable(lines, start, startLineNo, state) {
  const headCells = splitRow(lines[start]);
  const delimiterCells = splitRow(lines[start + 1]);

  if (headCells.length === 0 || headCells.length !== delimiterCells.length) {
    emitWarning(state.ctx, "table-malformed", startLineNo);
    let cursor = start;
    const raw = [];
    while (cursor < lines.length && !BLANK.test(lines[cursor]) && hasUnescapedPipe(lines[cursor])) {
      raw.push(lines[cursor]);
      cursor += 1;
    }
    return { block: { kind: "paragraph", children: buildInlineFromLines(raw, startLineNo, state) }, next: cursor };
  }

  const align = delimiterCells.map((cell) => alignOf(cell));
  const header = headCells.map((cell) => parseInline(cell, state.ctx, startLineNo));
  /** @type {Array<Array<Array<object>>>} */
  const rows = [];
  let cursor = start + 2;
  while (cursor < lines.length && !BLANK.test(lines[cursor]) && hasUnescapedPipe(lines[cursor])) {
    const cells = splitRow(lines[cursor]);
    const lineNo = startLineNo + (cursor - start);
    let normalized = cells;
    if (cells.length !== headCells.length) {
      emitWarning(state.ctx, "table-ragged", lineNo, { header: headCells.length, row: cells.length });
      normalized = normalizeRowCells(cells, headCells.length);
    }
    rows.push(normalized.map((cell) => parseInline(cell, state.ctx, lineNo)));
    cursor += 1;
  }

  return { block: { kind: "table", model: { align, header, rows } }, next: cursor };
}

/**
 * 行列不齐：少则补空单元格；多则多余单元格文本以「 / 」并入最后一列（REQ-ELEM-12）。
 * @param {string[]} cells
 * @param {number} columnCount
 * @returns {string[]}
 */
function normalizeRowCells(cells, columnCount) {
  if (cells.length === columnCount) return cells;
  if (cells.length < columnCount) {
    return [...cells, ...new Array(columnCount - cells.length).fill("")];
  }
  const head = cells.slice(0, columnCount - 1);
  const tail = cells
    .slice(columnCount - 1)
    .map((value) => String(value).trim())
    .filter((value) => value !== "");
  head.push(tail.join(" / "));
  return head;
}

/**
 * 生成标题节点（含稳定书签 _TocNNNN）。
 * @param {number} level
 * @param {string} text
 * @param {{ctx: object, fallbackBookmarks: number}} state
 * @param {number} lineNo
 * @returns {object}
 */
function makeHeading(level, text, state, lineNo) {
  const ctx = state.ctx;
  let bookmark = "";
  if (typeof ctx.nextBookmark === "function") {
    try {
      bookmark = ctx.nextBookmark();
    } catch {
      bookmark = "";
    }
  }
  if (typeof bookmark !== "string" || bookmark === "") {
    state.fallbackBookmarks += 1;
    bookmark = "_Toc" + String(state.fallbackBookmarks).padStart(4, "0");
  }
  return {
    kind: "heading",
    level: Math.min(6, Math.max(1, level)),
    children: parseInline(text, ctx, lineNo),
    bookmark,
  };
}

/**
 * 列表项标记识别。
 * @param {string} line
 * @returns {{indent: number, ordered: boolean, number: number, contentIndent: number, text: string} | null}
 */
function matchListItem(line) {
  const unordered = UNORDERED.exec(line);
  if (unordered && !HR.test(line)) {
    const indent = indentWidth(unordered[1]);
    const gap = Math.max(1, indentWidth(unordered[3]));
    return { indent, ordered: false, number: 1, contentIndent: indent + 1 + gap, text: unordered[4] };
  }
  const ordered = ORDERED.exec(line);
  if (ordered) {
    const indent = indentWidth(ordered[1]);
    const gap = Math.max(1, indentWidth(ordered[3]));
    return {
      indent,
      ordered: true,
      number: Number.parseInt(ordered[2], 10),
      contentIndent: indent + ordered[2].length + 1 + gap,
      text: ordered[5],
    };
  }
  return null;
}

/**
 * 前导空白宽度（制表符按 4 列，REQ-IN-002）。
 * @param {string} line
 * @returns {number}
 */
function indentWidth(line) {
  let width = 0;
  for (const ch of String(line == null ? "" : line)) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

/**
 * 去掉前导空白列（制表符按 4 列）。
 * @param {string} line
 * @param {number} columns
 * @returns {string}
 */
function stripIndent(line, columns) {
  let consumed = 0;
  let index = 0;
  while (index < line.length && consumed < columns) {
    if (line[index] === " ") {
      consumed += 1;
      index += 1;
    } else if (line[index] === "\t") {
      consumed += 4;
      index += 1;
    } else {
      break;
    }
  }
  return line.slice(index);
}

/**
 * front matter 结束行（首行 --- 起；空行前必须找到 --- 或 ...，最多看 50 行）。
 * @param {string[]} lines
 * @returns {number} 结束行下标；-1 表示不是 front matter
 */
function findFrontMatterEnd(lines) {
  for (let index = 1; index < lines.length && index <= 50; index += 1) {
    if (BLANK.test(lines[index])) return -1;
    const trimmed = lines[index].trim();
    if (trimmed === "---" || trimmed === "...") return index;
  }
  return -1;
}

/**
 * front matter 正文：原样保留为段落（首行的 --- 已按分隔线渲染）。
 * @param {string[]} lines
 * @param {number} from
 * @param {number} to
 * @param {number} startLineNo
 * @param {{ctx: object}} state
 * @returns {Array<object>}
 */
function frontMatterParagraphs(lines, from, to, startLineNo, state) {
  /** @type {Array<object>} */
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    blocks.push({ kind: "paragraph", children: buildInlineFromLines(current, startLineNo, state) });
    current = [];
  };
  for (let index = from; index <= to; index += 1) {
    if (BLANK.test(lines[index])) {
      flush();
      continue;
    }
    current.push(lines[index]);
  }
  flush();
  return blocks;
}
