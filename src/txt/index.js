/**
 * txt-structurer（新开发，architecture §3.4 / requirements §2.3）
 *
 * 实现计划（≤10 行）：
 * 1 空白归一（CRLF/CR→LF、Tab→4 空格）；2 行级优先级 1 Setext → 2 首行标题 → 3 分隔线 → 4 列表 → 5 段落；
 * 3 Setext 用「当前行 + 紧随下划线行」判定并跳过下划线行；4 首行标题 = 首个非空行 + 后跟空行 + 不以句末标点结尾 + 宽度 ≤60 列；
 * 5 分隔线与列表按 §2.3.1/§2.3.3，缩进→层级 min(3,1+floor(s/2))，超 3 级告警并并入第 3 级；
 * 6 列表项续行与段落拼接复用 src/markdown/soft-join.js（REQ-TXT-002 同一函数，防规范分裂）；
 * 7 段落在块级命中/空行处闭合，CJK 相邻不加空格；
 * 8 全文无标题 → no-heading-detected；9 零改写：只做空白处理与拼接；10 输出 Block[]（bookmark 由 ctx.nextBookmark 单调分配）。
 *
 * 纯函数：不读文件、不猜语义、不生成样式（architecture §3.4「不做」）。
 *
 * @module txt
 */
import { joinSoftLines, joinSoftPair } from "../markdown/soft-join.js";

/**
 * 写死的告警文案（requirements §5.2；本模块只产生这两个 code）。
 * @type {Readonly<Record<string, string>>}
 */
export const WARNING_MESSAGES = Object.freeze({
  "no-heading-detected": "未识别到任何标题，文档标题取文件名",
  "list-depth-clamped": "列表超过 3 级，已并入第 3 级",
});

/** 分隔线：整行仅由 3 个及以上同种 - * _ 组成（字符之间可含空格）。 */
const HR_PATTERN = /^([-*_])(?: *\1){2,}$/;

/** Setext 下划线：整行仅由 3 个及以上等号/连字符组成（行首行尾空格已裁掉）。 */
const SETEXT_EQ_PATTERN = /^={3,}$/;
const SETEXT_DASH_PATTERN = /^-{3,}$/;

/** 首行标题不得以句末/句中停顿标点结尾（requirements §2.3.1 规则 2，逐字）。 */
const SENTENCE_END_PATTERN = /[。．.！!？?；;，,：:]\s*$/;

/** 全角/CJK 宽度区间（显示宽度按 CJK=2、其余=1 计）。 */
const WIDE_RANGES = Object.freeze([
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
]);

/**
 * @param {string} line 已 trimEnd 的行
 * @returns {number} 前导空格数（Tab 已在入口展开为 4 空格）
 */
function leadingSpaces(line) {
  const match = /^ */.exec(line);
  return match ? match[0].length : 0;
}

/**
 * @param {string} line
 * @returns {boolean} 是否分隔线（requirements §2.3.1 规则 3）
 */
function isHorizontalRule(line) {
  return HR_PATTERN.test(line.trim());
}

/**
 * @param {string} line
 * @returns {1|2|0} 1 = 等号下划线（H1），2 = 连字符下划线（H2），0 = 不是下划线
 */
function setextLevel(line) {
  const value = String(line ?? "").trim();
  if (SETEXT_EQ_PATTERN.test(value)) return 1;
  if (SETEXT_DASH_PATTERN.test(value)) return 2;
  return 0;
}

/**
 * 显示宽度：CJK 与全角符号记 2 列，其余记 1 列（requirements §2.3.1 规则 2）。
 * @param {string} value
 * @returns {number}
 */
export function displayWidth(value) {
  let width = 0;
  for (const ch of String(value ?? "")) {
    const cp = ch.codePointAt(0);
    width += WIDE_RANGES.some(([start, end]) => cp >= start && cp <= end) ? 2 : 1;
  }
  return width;
}

/**
 * 列表项判定（requirements §2.3.3）。
 * - 无序：行首（允许前导空格）- * + • · 之一，其后至少 1 个空格/制表符；
 * - 有序：1–2 位数字 + . ) 、 + 至少 1 个空格/制表符；或 （1）/ (1)（其后空格可选）。
 * @param {string} line 已 trimEnd 的原始行（保留前导空格）
 * @returns {{ ordered: boolean, start: number, markerIndent: number, content: string } | null}
 */
function parseListLine(line) {
  const indent = leadingSpaces(line);
  const rest = line.slice(indent);
  if (rest === "") return null;

  const unordered = /^([-*+•·])[ ]+(\S.*)$/u.exec(rest);
  if (unordered) {
    return { ordered: false, start: 1, markerIndent: indent, content: unordered[2].trim() };
  }
  const ordered = /^(\d{1,2})([.)、])[ ]+(\S.*)$/u.exec(rest);
  if (ordered) {
    return { ordered: true, start: Number(ordered[1]), markerIndent: indent, content: ordered[3].trim() };
  }
  const bracketed = /^[（(](\d{1,2})[）)][ ]*(\S.*)$/u.exec(rest);
  if (bracketed) {
    return { ordered: true, start: Number(bracketed[1]), markerIndent: indent, content: bracketed[2].trim() };
  }
  return null;
}

/**
 * @param {string[]} lines
 * @param {number} from
 * @returns {number} 下一个非空行下标，-1 = 没有了
 */
function nextNonEmptyIndex(lines, from) {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].trim() !== "") return index;
  }
  return -1;
}

/**
 * 无 ctx 时的兜底计数器（供独立单测使用）。
 * @returns {() => string}
 */
function createBookmarkCounter() {
  let counter = 0;
  return () => {
    counter += 1;
    return "_Toc" + String(counter).padStart(4, "0");
  };
}

/**
 * .txt 结构化：严格按 requirements §2.3.1 的优先级表产出 Block[]。
 * @param {string} text 源文本（内部会再做一次换行/Tab 归一，可重复调用）
 * @param {{ warn?: (w: { code: string, message: string, line?: number }) => void, nextBookmark?: () => string }} [ctx]
 * @returns {Array<object>} Block[]
 */
export function structureText(text, ctx = {}) {
  const warn = typeof ctx.warn === "function" ? ctx.warn : () => {};
  const nextBookmark = typeof ctx.nextBookmark === "function" ? ctx.nextBookmark : createBookmarkCounter();

  const source = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines = source.split("\n");
  const firstNonEmpty = lines.findIndex((line) => line.trim() !== "");

  /** @type {Array<object>} */
  const blocks = [];
  /** @type {Array<{ level: number, list: object, lastItem: object | null, lastNumber: number, markerIndent: number }>} */
  const listStack = [];
  /** @type {string[]} */
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const value = joinSoftLines(paragraph);
    paragraph = [];
    if (value !== "") blocks.push({ kind: "paragraph", children: [{ kind: "text", text: value }] });
  };

  const closeList = () => {
    listStack.length = 0;
  };

  const pushHeading = (level, value) => {
    flushParagraph();
    closeList();
    blocks.push({ kind: "heading", level, bookmark: nextBookmark(), children: [{ kind: "text", text: value }] });
  };

  const addListItem = (parsed, lineNo) => {
    let level = 1 + Math.floor(parsed.markerIndent / 2);
    if (level > 3) {
      level = 3;
      warn({ code: "list-depth-clamped", message: WARNING_MESSAGES["list-depth-clamped"], line: lineNo });
    }

    while (listStack.length > 0 && listStack[listStack.length - 1].level > level) listStack.pop();

    let top = listStack[listStack.length - 1];
    const needsNewList = !top
      || top.level < level
      || top.list.ordered !== parsed.ordered
      || (top.list.ordered && top.lastItem !== null && parsed.start !== top.lastNumber + 1);

    if (needsNewList) {
      // 同层换列表类型 / 有序编号断开 → 另起一个列表（编号保持原文）
      if (top && top.level === level) listStack.pop();
      const parent = listStack[listStack.length - 1];
      const container = parent && parent.lastItem ? parent.lastItem.children : blocks;
      const list = { kind: "list", ordered: parsed.ordered, start: parsed.start, tight: true, items: [] };
      container.push(list);
      top = { level, list, lastItem: null, lastNumber: parsed.start, markerIndent: parsed.markerIndent };
      listStack.push(top);
    }

    const item = { children: [] };
    if (parsed.content !== "") {
      item.children.push({ kind: "paragraph", children: [{ kind: "text", text: parsed.content }] });
    }
    top.list.items.push(item);
    top.lastItem = item;
    top.lastNumber = parsed.start;
    top.markerIndent = parsed.markerIndent;
  };

  const appendContinuation = (value) => {
    const top = listStack[listStack.length - 1];
    if (!top || !top.lastItem) return false;
    const item = top.lastItem;
    const last = item.children[item.children.length - 1];
    if (last && last.kind === "paragraph") {
      last.children[0].text = joinSoftPair(last.children[0].text, value);
    } else {
      item.children.push({ kind: "paragraph", children: [{ kind: "text", text: value }] });
    }
    return true;
  };

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    const lineNo = index + 1;

    // 空行：段落在块级命中/空行处闭合；列表遇到空行时看下一个非空行是否仍是列表项
    if (trimmed === "") {
      flushParagraph();
      if (listStack.length > 0) {
        const next = nextNonEmptyIndex(lines, index + 1);
        const nextLine = next === -1 ? "" : lines[next].trimEnd();
        const continuesList = nextLine !== ""
          && parseListLine(nextLine) !== null
          && !isHorizontalRule(nextLine);
        if (continuesList) {
          for (const entry of listStack) entry.list.tight = false;
        } else {
          closeList();
        }
      }
      index += 1;
      continue;
    }

    const listLine = parseListLine(line);

    // 规则 1：Setext 下划线标题（当前行 + 紧随的下划线行；当前行不得是列表项/分隔线/下划线本身）
    if (!listLine && !isHorizontalRule(trimmed) && setextLevel(trimmed) === 0) {
      const level = setextLevel(lines[index + 1] ?? "");
      if (level > 0) {
        pushHeading(level, trimmed);
        index += 2;
        continue;
      }
    }

    // 规则 3：分隔线。前置于规则 2 的依据是 §2.3.1 消歧规则：「若上一行为空行或不存在，
    // 则按规则 3 解释为分隔线」——文首的 --- 没有可依附的标题文本行，必须是分隔线而不是 H1。
    if (isHorizontalRule(trimmed)) {
      flushParagraph();
      closeList();
      blocks.push({ kind: "hr" });
      index += 1;
      continue;
    }

    // 规则 2：首行标题（首个非空行 + 后跟空行/全文唯一非空行 + 非列表 + 不以句末标点结尾 + 宽度 ≤ 60）
    if (index === firstNonEmpty && !listLine) {
      const followedByBlank = index + 1 >= lines.length || lines[index + 1].trim() === "";
      if (followedByBlank && !SENTENCE_END_PATTERN.test(trimmed) && displayWidth(trimmed) <= 60) {
        pushHeading(1, trimmed);
        index += 1;
        continue;
      }
    }

    // 规则 4：列表项
    if (listLine) {
      flushParagraph();
      addListItem(listLine, lineNo);
      index += 1;
      continue;
    }

    // 列表项续行：缩进 ≥ 该项标记缩进 + 2 的非空、非列表行（requirements §2.3.3）
    if (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      if (top.lastItem && leadingSpaces(line) >= top.markerIndent + 2) {
        appendContinuation(trimmed);
        index += 1;
        continue;
      }
      closeList();
    }

    // 规则 5：普通段落（极大连续非空行序列，逐行按 CJK 规则拼接）
    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  closeList();

  if (!blocks.some((block) => block.kind === "heading")) {
    warn({ code: "no-heading-detected", message: WARNING_MESSAGES["no-heading-detected"] });
  }

  return blocks;
}
