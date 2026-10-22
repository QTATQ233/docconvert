/**
 * 最小 ZIP 读取器（只读，无第三方依赖，architecture D6）。
 *
 * 用途：
 * - 启动预检第 ② 步：模板 ZIP 可解析、必需部件齐全；
 * - 模板 / 配置双源校验（architecture §4.1/§4.6）：读出 word/styles.xml 的关键值。
 *
 * 支持 store(0) 与 deflate(8)；不支持 ZIP64/加密（模板与产物都由本程序生成，不会用到）。
 *
 * @module cli/zip
 */
import { inflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

/**
 * @typedef {{ name: string, method: number, compressedSize: number, uncompressedSize: number, localHeaderOffset: number }} ZipEntry
 */

/**
 * 解析内存中的 ZIP。
 * @param {Buffer} buffer
 * @returns {{ names: string[], entries: ZipEntry[], read(name: string): Buffer }}
 */
export function readZip(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("ZIP 结构损坏：找不到中央目录结束记录");
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > buffer.length) throw new Error("ZIP 结构损坏：中央目录越界");
  if (totalEntries === 0xffff || centralSize === 0xffffffff) throw new Error("ZIP64 暂不支持");

  /** @type {ZipEntry[]} */
  const entries = [];
  let offset = centralOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("ZIP 结构损坏：中央目录签名不匹配");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  /** @param {string} name */
  function read(name) {
    const entry = entries.find((item) => item.name === name);
    if (!entry) throw new Error(`ZIP 内不存在条目：${name}`);
    const local = entry.localHeaderOffset;
    if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) throw new Error(`ZIP 条目损坏：${name}`);
    const nameLength = buffer.readUInt16LE(local + 26);
    const extraLength = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + nameLength + extraLength;
    const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return Buffer.from(raw);
    if (entry.method === 8) return inflateRawSync(raw);
    throw new Error(`不支持的 ZIP 压缩方式 ${entry.method}：${name}`);
  }

  return { names: entries.map((entry) => entry.name), entries, read };
}

/**
 * 读取 ZIP 文件并解析。
 * @param {string} filePath
 * @returns {Promise<{ names: string[], entries: ZipEntry[], read(name: string): Buffer }>}
 */
export async function readZipFile(filePath) {
  return readZip(await readFile(filePath));
}

/**
 * 只读条目名清单（启动预检的轻量入口）。
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
export async function inspectZip(filePath) {
  return (await readZipFile(filePath)).names;
}

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}
