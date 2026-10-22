/**
 * 输入解码（architecture §3.2「编码」一行冻结内容 / REQ-IN-002）。
 *
 * 顺序写死：剥离 UTF-8 BOM → UTF-8 严格解码 → 失败回退 GB18030 严格解码 → 再失败抛 decode-error。
 * 每个文件只做一次解码，不猜测、不修补字节。
 *
 * @module preprocess/decode
 */
import { DocconvertError } from "../contracts/errors.js";

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * @param {Buffer} buffer 原始字节
 * @returns {boolean} 是否以 UTF-8 BOM 开头
 */
function hasUtf8Bom(buffer) {
  return buffer.length >= 3 && buffer[0] === UTF8_BOM[0] && buffer[1] === UTF8_BOM[1] && buffer[2] === UTF8_BOM[2];
}

/**
 * 按冻结顺序解码输入字节。
 * @param {Buffer} buffer
 * @param {string} absolutePath 仅用于错误信息
 * @returns {{ text: string, encoding: "utf-8" | "utf-8-bom" | "gb18030" }}
 * @throws {DocconvertError} decode-error（两种编码均严格解码失败）
 */
export function decodeSourceBytes(buffer, absolutePath) {
  const body = hasUtf8Bom(buffer) ? buffer.subarray(3) : buffer;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { text, encoding: hasUtf8Bom(buffer) ? "utf-8-bom" : "utf-8" };
  } catch (utf8Error) {
    try {
      const text = new TextDecoder("gb18030", { fatal: true }).decode(body);
      return { text, encoding: "gb18030" };
    } catch (gbError) {
      throw new DocconvertError("decode-error", "无法解码输入文件（UTF-8 与 GB18030 均失败）：" + absolutePath, {
        detail: { path: absolutePath },
        cause: gbError ?? utf8Error,
      });
    }
  }
}

/**
 * 换行归一：CRLF、CR → LF（REQ-IN-002）。
 * @param {string} text
 * @returns {string}
 */
export function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n");
}
