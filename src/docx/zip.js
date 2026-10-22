/**
 * 确定性 ZIP 读写（architecture §8.1，冻结）。
 *
 * 写：条目顺序由调用方给定；时间戳固定 DOS 1980-01-01 00:00:00；method=8
 *     （deflateRawSync level 9）；不置 bit 3（无 data descriptor）；无 ZIP64；
 *     externalAttributes=0、版本字段与注释全为常量 → 同一输入字节完全一致。
 * 读：只服务模板解析（中央目录 + 本地头 + inflate），不追求通用性。
 *
 * @module docx/zip
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

/** DOS 时间：00:00:00（§8.1）。 */
const DOS_TIME = 0;
/** DOS 日期：1980-01-01（§8.1）。 */
const DOS_DATE = 0x0021;
/** ZIP 通用位标志：仅 bit 11（UTF-8 文件名）。 */
const FLAGS_UTF8 = 0x0800;
/** 版本字段常量。 */
const VERSION = 20;

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 把条目写成确定性 ZIP。
 * @param {Array<{ name: string, data: Buffer | string }>} entries 顺序即产物顺序
 * @returns {Buffer}
 */
export function zipWrite(entries) {
  /** @type {Buffer[]} */
  const chunks = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const compressed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAGS_UTF8, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(FLAGS_UTF8, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 30);
    central.writeUInt32LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0);
  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...centrals, eocd]);
}

/**
 * 读取 ZIP 全部条目内容。
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>}
 */
export function zipRead(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error("ZIP 结构损坏：找不到中央目录结束记录");
  const total = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (total === 0xffff || centralSize === 0xffffffff) throw new Error("ZIP64 暂不支持");
  if (centralOffset + centralSize > buffer.length) throw new Error("ZIP 结构损坏：中央目录越界");

  /** @type {Map<string, Buffer>} */
  const parts = new Map();
  let offset = centralOffset;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("ZIP 结构损坏：中央目录签名不匹配");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`ZIP 结构损坏：本地头签名不匹配（${name}）`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const stored = buffer.subarray(dataStart, dataStart + compressedSize);
    parts.set(name, method === 8 ? inflateRawSync(stored) : Buffer.from(stored));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function findEocd(buffer) {
  const start = Math.max(0, buffer.length - EOCD_SIZE - 0xffff);
  for (let i = buffer.length - EOCD_SIZE; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}
