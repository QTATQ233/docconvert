/**
 * readPdfOutline 单元测试：手写最小 PDF（3 页 / 4 条书签，含 H4）+ UTF-16BE 中文标题。
 * 不依赖 kit、不依赖网络，验证 level 过滤、页映射、标题解码、页数统计。
 *
 * 运行：node --test --test-isolation=none test/toc/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPdfOutline, tocOutlineEntries } from "../../src/toc/outline.js";

/** UTF-16BE（带 BOM）十六进制编码的 PDF 文本串。 */
function utf16beHex(text) {
  let hex = "FEFF";
  for (const unit of text.split("")) {
    const code = unit.charCodeAt(0);
    hex += code.toString(16).padStart(4, "0").toUpperCase();
  }
  return "<" + hex + ">";
}

const PDF = [
  "%PDF-1.7",
  "1 0 obj",
  "<</Type/Catalog/Pages 2 0 R/Outlines 3 0 R>>",
  "endobj",
  "2 0 obj",
  "<</Type/Pages/Kids[4 0 R 5 0 R 6 0 R]/Count 3>>",
  "endobj",
  "3 0 obj",
  "<</Type/Outlines/First 7 0 R/Last 9 0 R/Count 4>>",
  "endobj",
  "4 0 obj",
  "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>",
  "endobj",
  "5 0 obj",
  "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>",
  "endobj",
  "6 0 obj",
  "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>",
  "endobj",
  "7 0 obj",
  "<</Title " + utf16beHex("第一章 总则") + "/Parent 3 0 R/Dest[4 0 R /XYZ 0 842 null]/First 8 0 R>>",
  "endobj",
  "8 0 obj",
  "<</Title (1.1 Sub section)/Parent 7 0 R/Dest[5 0 R /XYZ 0 842 null]/First 9 0 R>>",
  "endobj",
  "9 0 obj",
  "<</Title (1.1.1 Deep heading)/Parent 8 0 R/Dest[6 0 R /XYZ 0 842 null]/First 10 0 R>>",
  "endobj",
  "10 0 obj",
  "<</Title (1.1.1.1 H4 only bookmark)/Parent 9 0 R/Dest[6 0 R /XYZ 0 842 null]>>",
  "endobj",
  "trailer",
  "<</Root 1 0 R/Size 11>>",
  "%%EOF",
].join("\n");

test("readPdfOutline：页数/页映射/层级/标题解码", async () => {
  const dir = await mkdtemp(join(tmpdir(), "docconvert-toc-"));
  const file = join(dir, "fixture.pdf");
  try {
    await writeFile(file, PDF, "latin1");
    const outline = await readPdfOutline(file);
    assert.equal(outline.pageCount, 3);
    assert.equal(outline.entries.length, 4);
    assert.deepEqual(outline.entries.map((entry) => entry.level), [0, 1, 2, 3]);
    assert.deepEqual(outline.entries.map((entry) => entry.page), [1, 2, 3, 3]);
    assert.equal(outline.entries[0].title, "第一章 总则");
    assert.equal(outline.entries[1].title, "1.1 Sub section");
    // H4 只进 PDF 书签，不进目录（level<=2）。
    const toc = tocOutlineEntries(outline);
    assert.equal(toc.length, 3);
    assert.deepEqual(toc.map((entry) => entry.page), [1, 2, 3]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readPdfOutline：非 PDF / 缺文件 -> convert-failed", async () => {
  await assert.rejects(() => readPdfOutline(join(tmpdir(), "no-such-docconvert.pdf")), (error) => {
    assert.equal(error.code, "convert-failed");
    assert.equal(error.detail.kind, "pdf-outline");
    return true;
  });
});
