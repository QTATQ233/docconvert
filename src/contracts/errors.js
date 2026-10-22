/**
 * 全局错误模型（冻结，architecture §3.0）。
 *
 * 所有模块的失败只有一个出口：抛 DocconvertError。
 * 禁止抛裸 Error、禁止 process.exit（退出码只由 bin/docconvert.js 交给进程）。
 *
 * @module contracts/errors
 */
import { ERROR_EXIT_CODES, ERROR_HINTS } from "./index.js";

/**
 * docconvert 的唯一错误类型。
 */
export class DocconvertError extends Error {
  /**
   * @param {string} code 14 个已登记错误码之一（architecture §3.11）
   * @param {string} message 面向用户的中文说明（不含堆栈）
   * @param {{ hint?: string, detail?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = "DocconvertError";
    const exitCode = ERROR_EXIT_CODES[code];
    if (exitCode === undefined) {
      // 先登记再使用：未登记的错误码属于开发期错误。
      throw new TypeError(`未登记的错误码：${code}（见 requirements §9.1）`);
    }
    this.code = code;
    this.exitCode = exitCode;
    this.hint = options.hint ?? ERROR_HINTS[code];
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * @param {unknown} value
 * @returns {value is DocconvertError}
 */
export function isDocconvertError(value) {
  return value instanceof DocconvertError;
}

/**
 * 未捕获异常统一包装为 internal-error（architecture §3.0 纪律③）。
 * @param {unknown} cause
 * @returns {DocconvertError}
 */
export function toDocconvertError(cause) {
  if (isDocconvertError(cause)) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new DocconvertError("internal-error", `未预期的内部错误：${message}`, { cause });
}

/**
 * 面向用户的两行文本：`ERROR <code>: <说明>` + 可选 `hint: <建议>`。
 * 不含堆栈（REQ-CLI-006）。
 * @param {DocconvertError} error
 * @returns {string[]}
 */
export function formatErrorLines(error) {
  const lines = [`ERROR ${error.code}: ${error.message}`];
  if (error.hint) lines.push(`hint: ${error.hint}`);
  return lines;
}
