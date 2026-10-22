/**
 * test/docx 共享夹具：合成 AST、临时目录、DOCX 解包工具。
 * 不依赖子进程（本机沙箱禁止 Node 管道 stdio），全部进程内完成。
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipRead } from "../../src/docx/zip.js";

export const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const TEMPLATE_PATH = join(PACKAGE_ROOT, "templates", "reference.docx");
export const EXAMPLES_DIR = join(PACKAGE_ROOT, "examples");
export const TMP_ROOT = join(PACKAGE_ROOT, "test", "docx", ".tmp");

/**
 * @param {string} [prefix]
 * @returns {Promise<string>}
 */
export async function makeTempDir(prefix = "case-") {
  await mkdir(TMP_ROOT, { recursive: true });
  return mkdtemp(join(TMP_ROOT, prefix));
}

/**
 * @param {string} dir
 */
export async function removeDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

/**
 * 解包 DOCX 为「部件名 -> 文本」。
 * @param {string} docxPath
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function readDocx(docxPath) {
  return zipRead(await readFile(docxPath));
}

/**
 * @param {Map<string, Buffer>} parts
 * @param {string} name
 * @returns {string}
 */
export function partText(parts, name) {
  const buffer = parts.get(name);
  return buffer ? buffer.toString("utf8") : "";
}

/**
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {number}
 */
export function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

/** 文本内联。 */
export const text = (value) => ({ kind: "text", text: value });

/** 标题块。 */
export const heading = (level, value, bookmark) => ({
  kind: "heading",
  level,
  bookmark,
  children: [text(value)],
});

/** 段落块。 */
export const paragraph = (...children) => ({ kind: "paragraph", children: children.flat() });

/**
 * 合成 AstDocument。
 * @param {Array<object>} blocks
 * @param {{ title?: string, assets?: Array<object>, warnings?: Array<object> }} [extra]
 */
export function astDocument(blocks, extra = {}) {
  const title = extra.title ?? "测试文档";
  return {
    schemaVersion: 1,
    meta: {
      absolutePath: "/virtual/test.md",
      format: "md",
      sha256: "0".repeat(64),
      bytes: 1,
      mtimeMs: 0,
      encoding: "utf-8",
      title,
    },
    blocks,
    assets: extra.assets ?? [],
    warnings: extra.warnings ?? [],
  };
}

/**
 * 长文 AST：H1-H3 共 n 组，便于目录断言。
 * @param {number} groups
 */
export function longBlocks(groups) {
  const blocks = [];
  let counter = 0;
  const nextBookmark = () => {
    counter += 1;
    return "_Toc" + String(counter).padStart(4, "0");
  };
  for (let index = 1; index <= groups; index += 1) {
    blocks.push(heading(1, "第" + index + "章 主题", nextBookmark()));
    blocks.push(paragraph(text("正文段落 " + index)));
    blocks.push(heading(2, "第" + index + "节 小节", nextBookmark()));
    blocks.push(heading(3, "第" + index + "小节 细则", nextBookmark()));
  }
  return blocks;
}

/** 图片资产（example 里的真实 PNG，用于验证内嵌与缩放）。 */
export function pngAsset(id, fileName, widthPx, heightPx, alt = "") {
  return {
    id,
    rawSrc: "assets/" + fileName,
    absolutePath: join(EXAMPLES_DIR, "assets", fileName),
    mime: "image/png",
    widthPx,
    heightPx,
    alt,
    resolved: true,
  };
}

/** 缺失图片资产（resolved=false -> 占位 + 来源行）。 */
export function missingAsset(id, rawSrc, alt = "") {
  return {
    id,
    rawSrc,
    mime: "application/octet-stream",
    alt,
    resolved: false,
  };
}
