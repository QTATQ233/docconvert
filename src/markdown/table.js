/**
 * 管道表格：行切分、分隔行判定、对齐映射、行列不齐的补齐/合并
 * （requirements REQ-ELEM-11/12，architecture §3.1.1 TableModel）。
 *
 * 纯字符串处理，不产告警；告警由 index.js 按 requirements §5.2 统一发射。
 *
 * @module markdown/table
 */

/** 分隔行单元格：可带左/右对齐冒号，至少 1 个连字符。 */
const DELIMITER_CELL = /^:?-+:?$/;

/**
 * 一行里是否存在「未被转义、也不在行内代码里」的竖线。
 * @param {string} line
 * @returns {boolean}
 */
export function hasUnescapedPipe(line) {
  if (typeof line !== "string") return false;
  let backticks = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") {
      let run = 1;
      while (line[i + run] === "`") run++;
      backticks = backticks === run ? 0 : run;
      i += run - 1;
      continue;
    }
    if (ch === "|" && backticks === 0) return true;
  }
  return false;
}

/**
 * 切分一行表格为单元格文本（保留行内代码里的竖线，反转义 \|）。
 * @param {string} rawLine
 * @returns {string[]}
 */
export function splitRow(rawLine) {
  const line = String(rawLine == null ? "" : rawLine).replace(/^[ \t]+/, "");
  const cells = [];
  let cell = "";
  let backticks = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      const next = line[i + 1];
      cell += next === "|" ? "|" : "\\" + next;
      i++;
      continue;
    }
    if (ch === "`") {
      let run = 1;
      while (line[i + run] === "`") run++;
      backticks = backticks === run ? 0 : run;
      cell += "`".repeat(run);
      i += run - 1;
      continue;
    }
    if (ch === "|" && backticks === 0) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);

  const trimmedLine = line.replace(/[ \t]+$/, "");
  if (trimmedLine.startsWith("|") && cells.length > 0) cells.shift();
  if (trimmedLine.endsWith("|") && cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((value) => value.trim());
}

/**
 * 是否为分隔行（| --- | :--: |）。
 * @param {string} line
 * @returns {boolean}
 */
export function isDelimiterRow(line) {
  if (typeof line !== "string" || !line.includes("|")) return false;
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((cellText) => DELIMITER_CELL.test(cellText.replace(/[ \t]/g, "")));
}

/**
 * 对齐标记 → TableModel.align 取值。
 * @param {string} cellText
 * @returns {"left"|"center"|"right"|null}
 */
export function alignOf(cellText) {
  const value = String(cellText == null ? "" : cellText).replace(/[ \t]/g, "");
  if (!DELIMITER_CELL.test(value)) return null;
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/**
 * 行列不齐：少则补空单元格；多则把多余单元格文本以「 / 」并入最后一列（REQ-ELEM-12）。
 * @param {string[]} cells
 * @param {number} columnCount
 * @returns {string[]}
 */
export function normalizeRow(cells, columnCount) {
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
