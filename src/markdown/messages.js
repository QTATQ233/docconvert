/**
 * Markdown 降级告警的固定文案（requirements §5.2 逐字；architecture §3.1.2）。
 *
 * 纪律：
 * - message 必须取本表文案，code 必须是 contracts.WARNING_CODES 中已登记的机器键；
 *   未登记的 code 一律不发射（REQ-DEP-004：不得新增未登记项）。
 * - 只有 table-ragged 允许替换 {header}/{row} 两个占位（§5.2 原文即为「表头 N 列，本行 M 列」）。
 * - 告警通道故障不得中断解析（REQ-MD-004 / REQ-ELEM-28）。
 *
 * @module markdown/messages
 */

/** @type {Readonly<Record<string, string>>} */
export const WARNING_TEXT = Object.freeze({
  "image-degraded": "图片未内嵌（远程地址/绝对路径/文件缺失/格式不支持），已降级为占位段落",
  "footnote-unsupported": "v1 不支持脚注，已按原文保留",
  "task-list-degraded": "任务列表已降级为普通列表，保留方括号原文",
  "inline-html-unsupported": "v1 不支持内联 HTML，已按原文保留",
  "indented-code-unsupported": "v1 不支持缩进代码块，已按普通段落处理",
  "list-depth-clamped": "列表超过 3 级，已并入第 3 级",
  "quote-depth-clamped": "引用超过 2 级，已并入第 2 级",
  "table-ragged": "表格行列数不一致（表头 {header} 列，本行 {row} 列），已按规则补齐或合并",
  "table-malformed": "表格缺少分隔行，整块按普通段落处理",
  "table-nested-unsupported": "v1 不支持单元格内嵌套表格，已按原文保留",
  "link-target-degraded": "链接目标不是 http/https/mailto，已降级为文本",
  "front-matter-not-recognized": "文件头 YAML 块不被识别，已按原文保留",
  "strikethrough-unsupported": "v1 不支持删除线，已按原文保留",
  "formula-unsupported": "v1 不支持数学公式，已按原文保留",
});

/**
 * 发出一条降级告警。
 * @param {{ warn?: Function }} ctx ParseContext（preprocess 注入）
 * @param {string} code 已登记告警码
 * @param {number} [line] 1-based 行号
 * @param {Record<string, string|number>} [values] 仅 table-ragged 使用
 */
export function emitWarning(ctx, code, line, values) {
  const template = WARNING_TEXT[code];
  if (!template) return;
  let message = template;
  if (values) {
    for (const key of Object.keys(values)) {
      message = message.split("{" + key + "}").join(String(values[key]));
    }
  }
  /** @type {{code: string, message: string, line?: number}} */
  const warning = { code, message };
  if (Number.isInteger(line) && line > 0) warning.line = line;
  if (ctx && typeof ctx.warn === "function") {
    try {
      ctx.warn(warning);
    } catch {
      // 告警通道故障不得中断解析。
    }
  }
}
