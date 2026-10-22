/**
 * 软换行拼接（REQ-MD-002 / REQ-TXT-002：Markdown 与 .txt 共用同一实现，防规范分裂）。
 *
 * 规则（requirements §2.3.2 写死）：逐行去掉首尾空白后连接；若已拼接文本的末字符与
 * 下一行首字符都属于 CJK（U+4E00–U+9FFF、U+3400–U+4DBF）或全角标点
 * （U+3000–U+303F、U+FF00–U+FFEF），直接相连不加空格；否则插入 1 个半角空格。
 *
 * 本文件不读文件、不产生告警，可被 src/txt 直接复用（architecture §3.3「同一函数」）。
 *
 * @module markdown/soft-join
 */

/** CJK 汉字 + 全角标点（含全角空格）。 */
const CJK_OR_FULLWIDTH = /[\u3400-\u4DBF\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/;

/**
 * 单个字符是否属于 CJK 或全角标点。
 * @param {string} ch
 * @returns {boolean}
 */
export function isCjkOrFullwidth(ch) {
  return typeof ch === "string" && ch.length > 0 && CJK_OR_FULLWIDTH.test(ch);
}

/**
 * 按 REQ-TXT-002 拼接两段文本（左段已拼接结果 + 右段下一行）。
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
export function joinSoftPair(left, right) {
  const head = typeof left === "string" ? left : "";
  const tail = typeof right === "string" ? right : "";
  if (head === "") return tail;
  if (tail === "") return head;
  const last = head[head.length - 1];
  const first = tail[0];
  return isCjkOrFullwidth(last) && isCjkOrFullwidth(first) ? head + tail : head + " " + tail;
}

/**
 * 拼接一组源码行（每行先去掉首尾空白；空行跳过）。
 * @param {string[]} lines
 * @returns {string}
 */
export function joinSoftLines(lines) {
  let out = "";
  for (const line of lines || []) {
    const trimmed = String(line == null ? "" : line).trim();
    if (trimmed === "") continue;
    out = joinSoftPair(out, trimmed);
  }
  return out;
}
