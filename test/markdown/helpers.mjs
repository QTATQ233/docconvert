/**
 * markdown-parser 单测辅助：构造与 preprocess 语义一致的 ParseContext。
 *
 * 只出现在 test/markdown/**，不是产品代码：resolveAsset 按 architecture §3.2 的资产规则
 * （只解析相对路径 + PNG/JPEG + 文件存在可读）模拟实现，并读 PNG 头拿像素尺寸。
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

/**
 * 构造 ParseContext。
 * @param {string} sourcePath 源文件绝对路径
 * @param {Record<string, unknown>} [overrides]
 * @returns {{sourcePath: string, warnings: Array<object>, assets: Array<object>, warn: Function, nextBookmark: Function, resolveAsset: Function}}
 */
export function makeCtx(sourcePath, overrides = {}) {
  const warnings = [];
  const assets = [];
  let bookmarkSeq = 0;
  let assetSeq = 0;

  return {
    sourcePath,
    warnings,
    assets,
    warn(warning) {
      warnings.push(warning);
    },
    nextBookmark() {
      bookmarkSeq += 1;
      return "_Toc" + String(bookmarkSeq).padStart(4, "0");
    },
    resolveAsset(rawSrc) {
      assetSeq += 1;
      const id = "asset-" + String(assetSeq).padStart(4, "0");
      const ref = { id, rawSrc, mime: "application/octet-stream", alt: "", resolved: false };
      const src = String(rawSrc == null ? "" : rawSrc);
      const looksAbsolute =
        /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || src.startsWith("/") || src.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(src);
      const extension = extname(src).toLowerCase();
      if (!looksAbsolute && (extension === ".png" || extension === ".jpg" || extension === ".jpeg")) {
        const candidate = resolve(dirname(sourcePath), src);
        try {
          if (statSync(candidate).isFile()) {
            ref.absolutePath = candidate;
            ref.resolved = true;
            ref.mime = extension === ".png" ? "image/png" : "image/jpeg";
            const size = readPngSize(candidate);
            if (size) {
              ref.widthPx = size.width;
              ref.heightPx = size.height;
            }
          }
        } catch {
          // 文件缺失：resolved 保持 false（调用方按 image-degraded 处理）。
        }
      }
      assets.push(ref);
      return ref;
    },
    ...overrides,
  };
}

/**
 * 读取 PNG 的宽高（IHDR，字节 16–24）。
 * @param {string} filePath
 * @returns {{width: number, height: number} | null}
 */
function readPngSize(filePath) {
  try {
    const buffer = readFileSync(filePath);
    if (buffer.length < 24 || buffer[0] !== 0x89 || buffer[1] !== 0x50) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * 深度优先展开块（含 blockquote.children 与 list.items[].children）。
 * @param {Array<object>} blocks
 * @returns {Array<object>}
 */
export function flattenBlocks(blocks) {
  const out = [];
  for (const block of blocks || []) {
    out.push(block);
    if (block.kind === "blockquote") out.push(...flattenBlocks(block.children));
    else if (block.kind === "list") {
      for (const item of block.items || []) out.push(...flattenBlocks(item.children));
    }
  }
  return out;
}

/**
 * 把 Inline 树拍平成纯文本（用于断言字面保留）。
 * @param {Array<object>} nodes
 * @returns {string}
 */
export function inlineText(nodes) {
  let out = "";
  for (const node of nodes || []) {
    if (node.kind === "text" || node.kind === "code") out += node.text;
    else if (node.kind === "br") out += "\n";
    else if (node.children) out += inlineText(node.children);
  }
  return out;
}
