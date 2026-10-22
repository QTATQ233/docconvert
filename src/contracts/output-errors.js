/**
 * 输出侧错误的统一映射（architecture §3.11：output-not-writable / 环境 / 退出码 4）。
 *
 * 只有"写不进去"属于环境问题（权限、只读、磁盘满、路径被占用）；
 * 其余写入失败仍是 convert-failed（转换 / 退出码 5）。
 *
 * @module contracts/output-errors
 */
import { DocconvertError } from "./errors.js";

/** 视为"输出不可写"的 errno。 */
const NOT_WRITABLE_CODES = new Set(["EACCES", "EPERM", "EROFS", "ENOSPC", "ENOTDIR", "EISDIR", "EBUSY"]);

/**
 * @param {unknown} error
 * @returns {string}
 */
export function errorCodeOf(error) {
  return error && typeof error === "object" && typeof (/** @type {any} */ (error).code) === "string"
    ? /** @type {any} */ (error).code
    : "";
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNotWritableError(error) {
  return NOT_WRITABLE_CODES.has(errorCodeOf(error));
}

/**
 * 把写入失败包装成 DocconvertError（output-not-writable / convert-failed）。
 * @param {unknown} error
 * @param {{ target: string, what: string }} context
 * @returns {DocconvertError}
 */
export function toWriteError(error, context) {
  const message = error instanceof Error ? error.message : String(error);
  if (isNotWritableError(error)) {
    return new DocconvertError("output-not-writable", `无法写入${context.what}：${context.target}（${message}）`, {
      hint: "检查 -o 目录权限，或改用可写目录",
      detail: { kind: "output-not-writable", target: context.target, errno: errorCodeOf(error) },
      cause: error,
    });
  }
  return new DocconvertError("convert-failed", `无法写入${context.what}：${context.target}（${message}）`, {
    hint: "查看 conversion-log.jsonl",
    detail: { kind: "write", target: context.target, errno: errorCodeOf(error) },
    cause: error,
  });
}
