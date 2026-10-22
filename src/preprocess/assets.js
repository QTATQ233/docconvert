/**
 * 图片资产登记（architecture §3.1.2 AssetRef / §3.2「资产」/ REQ-ELEM-18/19、REQ-IN-005）。
 *
 * 冻结规则：只解析「相对路径 + PNG/JPEG + 文件存在可读」的图片；远程地址、绝对路径、
 * data:、SVG/GIF/WEBP、缺失文件一律 resolved=false —— 不下载、不读取绝对路径、不抛异常。
 * 解析是同步的（ParseContext.resolveAsset 的签名是同步返回 AssetRef）。
 *
 * @module preprocess/assets
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

/** 读文件头字节的上限（只用于解析图片尺寸，最多 64 KiB）。 */
const HEAD_BYTES = 65536;

/** 有 scheme 的地址（http:、https:、data:、file:、ftp: …）一律不解析。 */
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * 读文件头（不整文件读入）。
 * @param {string} absolutePath
 * @returns {Buffer}
 */
function readHead(absolutePath) {
  const fd = openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const bytes = readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(fd);
  }
}

/**
 * PNG IHDR 尺寸（宽 4 字节 @16，高 4 字节 @20，大端）。
 * @param {Buffer} head
 * @returns {{ width: number, height: number } | null}
 */
function pngSize(head) {
  if (head.length < 24) return null;
  const signature = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (!signature) return null;
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * JPEG 尺寸：扫描段标记直到 SOFn（0xC0–0xCF 去掉 C4/C8/CC）。
 * @param {Buffer} head
 * @returns {{ width: number, height: number } | null}
 */
function jpegSize(head) {
  if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < head.length) {
    if (head[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = head[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS 之前没有 SOF
    const length = head.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      const height = head.readUInt16BE(offset + 5);
      const width = head.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * @param {Buffer} head
 * @param {"image/png" | "image/jpeg"} mime
 * @returns {{ width: number, height: number } | null}
 */
function readImageSize(head, mime) {
  try {
    return mime === "image/png" ? pngSize(head) : jpegSize(head);
  } catch {
    return null;
  }
}

/**
 * 判定一个 src 是否可内嵌，并产出 AssetRef（不含 id；id 由注册表按首次出现顺序分配）。
 * @param {string} rawSrc 源码原文
 * @param {string} baseDir 相对路径解析基准（缺省为输入文件所在目录）
 * @returns {object} AssetRef（id 待填）
 */
function buildAssetRef(rawSrc, baseDir) {
  /** @type {Record<string, unknown>} */
  const ref = { id: "", rawSrc, mime: "application/octet-stream", alt: "", resolved: false };
  const src = rawSrc.trim();
  if (src === "") return ref;

  // 远程/协议地址、协议相对、绝对路径：一律降级（不下载、不读绝对路径）
  if (SCHEME_PATTERN.test(src) || src.startsWith("//")) return ref;
  if (isAbsolute(src) || /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("\\\\")) return ref;

  const extension = extname(src).toLowerCase();
  const mime = extension === ".png"
    ? "image/png"
    : (extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : null);
  if (mime === null) return ref;

  const absolutePath = resolve(baseDir, src);
  try {
    if (!statSync(absolutePath).isFile()) return ref;
    const head = readHead(absolutePath);
    const size = readImageSize(head, mime);
    // 扩展名与文件头不一致（如 .png 实际是文本）→ 视为格式不支持，降级
    if (size === null) return ref;
    ref.mime = mime;
    ref.resolved = true;
    ref.absolutePath = absolutePath;
    ref.widthPx = size.width;
    ref.heightPx = size.height;
    return ref;
  } catch {
    return ref;
  }
}

/**
 * 建资产注册表：同一 rawSrc 只登记一次，按首次出现顺序编号 asset-0001…；
 * 返回的对象是 assets 数组里的同一引用，parser 可回填 alt（§3.1.2 AssetRef.alt）。
 * @param {string} baseDir 相对路径解析基准
 * @param {Array<object>} assets 文档级资产数组（会被就地追加）
 * @returns {{ resolveAsset: (rawSrc: string) => object }}
 */
export function createAssetRegistry(baseDir, assets) {
  /** @type {Map<string, object>} */
  const byRawSrc = new Map();
  return {
    resolveAsset(rawSrc) {
      const key = typeof rawSrc === "string" ? rawSrc : String(rawSrc ?? "");
      const cached = byRawSrc.get(key);
      if (cached) return cached;
      const ref = buildAssetRef(key, baseDir);
      ref.id = "asset-" + String(assets.length + 1).padStart(4, "0");
      byRawSrc.set(key, ref);
      assets.push(ref);
      return ref;
    },
  };
}
