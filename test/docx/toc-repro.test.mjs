/**
 * docx-render TOC / 可复现 / 元数据测试。
 * 运行：node --test --test-isolation=none test/docx/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderDocx } from "../../src/docx/index.js";
import { zipRead } from "../../src/docx/zip.js";
import {
  astDocument,
  count,
  heading,
  longBlocks,
  makeTempDir,
  paragraph,
  partText,
  readDocx,
  removeDir,
  TEMPLATE_PATH,
  text,
} from "./helpers.mjs";

/** @type {string[]} */
const tempDirs = [];
test.after(async () => {
  for (const dir of tempDirs) await removeDir(dir);
});

/** 固定 ZIP 条目顺序（architecture 8.1）。 */
const EXPECTED_ORDER = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "docProps/app.xml",
  "word/document.xml",
  "word/styles.xml",
  "word/settings.xml",
  "word/fontTable.xml",
  "word/numbering.xml",
  "word/footer1.xml",
  "word/_rels/document.xml.rels",
];

/**
 * 顺序扫描本地头，返回 ZIP 条目名（用于验证固定顺序）。
 * @param {Buffer} buffer
 * @returns {string[]}
 */
function localEntryNames(buffer) {
  const names = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    names.push(buffer.toString("utf8", offset + 30, offset + 30 + nameLength));
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

test("TOC：完整缓存条目 + 标题书签 + 页码占位 00 + 不写 updateFields", async () => {
  const blocks = longBlocks(4);
  const dir = await makeTempDir("toc-");
  tempDirs.push(dir);
  const outPath = join(dir, "toc.docx");
  const result = await renderDocx(astDocument(blocks, { title: "长文标题" }), outPath, { templatePath: TEMPLATE_PATH });
  const parts = await readDocx(outPath);
  const documentXml = partText(parts, "word/document.xml");
  const settingsXml = partText(parts, "word/settings.xml");

  assert.equal(result.tocEntries.length, 12, "4 组 x 3 级 = 12 条目录");
  assert.equal(count(documentXml, /w:hyperlink w:anchor="_Toc\d{4}" w:history="1"/g), 12, "每条缓存条目一个锚点超链接");
  assert.equal(count(documentXml, /<w:t xml:space="preserve">00<\/w:t>/g), 12, "第一遍页码固定 00");
  assert.match(documentXml, /<w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u <\/w:instrText>/);
  assert.equal(count(documentXml, /<w:fldChar w:fldCharType="begin"\/>/g), 1);
  assert.equal(count(documentXml, /<w:fldChar w:fldCharType="separate"\/>/g), 1);
  assert.equal(count(documentXml, /<w:fldChar w:fldCharType="end"\/>/g), 1);
  assert.equal(count(documentXml, /w:fldCharType="begin" w:dirty/g), 0, "域不标 dirty");
  assert.equal(count(settingsXml, /w:updateFields/g), 0, "E2：settings 不含 updateFields");
  assert.equal(count(documentXml, /w:updateFields/g), 0);
  assert.equal(count(documentXml, /<w:bookmarkStart /g), 12, "标题书签齐全");
  assert.equal(count(documentXml, /w:pStyle w:val="TOC[123]"/g), 14, "12 条目 + 域起止两段");
  assert.equal(count(documentXml, /w:pStyle w:val="DocTitle"/g), 1);
});

test("TOC：tocNumbers 回填页码（第二遍）", async () => {
  const blocks = [heading(1, "第一章", "_Toc0001"), heading(2, "1.1", "_Toc0002"), heading(3, "1.1.1", "_Toc0003")];
  const dir = await makeTempDir("toc-fill-");
  tempDirs.push(dir);
  const outPath = join(dir, "filled.docx");
  const result = await renderDocx(astDocument(blocks), outPath, {
    templatePath: TEMPLATE_PATH,
    tocNumbers: [2, 3, 5],
  });
  assert.equal(result.tocEntries.length, 3);
  const documentXml = partText(await readDocx(outPath), "word/document.xml");
  for (const page of ["2", "3", "5"]) {
    assert.match(documentXml, new RegExp('<w:t xml:space="preserve">' + page + "</w:t>"), "回填页码 " + page);
  }
  assert.equal(count(documentXml, /<w:t xml:space="preserve">00<\/w:t>/g), 0, "回填后不再有占位");
});

test("TOC 占位：默认 '00'（不传 tocPlaceholder）", async () => {
  const blocks = [heading(1, "第一章", "_Toc0001"), heading(2, "1.1", "_Toc0002"), heading(3, "1.1.1", "_Toc0003")];
  const dir = await makeTempDir("toc-ph-default-");
  tempDirs.push(dir);
  const outPath = join(dir, "default.docx");
  await renderDocx(astDocument(blocks), outPath, { templatePath: TEMPLATE_PATH, tocNumbers: null });
  const documentXml = partText(await readDocx(outPath), "word/document.xml");
  assert.equal(count(documentXml, /<w:t xml:space="preserve">00<\/w:t>/g), 3, "默认占位 00 x 3 条");
  assert.equal(count(documentXml, /<w:t xml:space="preserve">——<\/w:t>/g), 0);
});

test("TOC 占位：显式 '——'（TOC 降级，§7.3.3 G2 / TC-TOC-DEGRADED）", async () => {
  const blocks = [heading(1, "第一章", "_Toc0001"), heading(2, "1.1", "_Toc0002"), heading(3, "1.1.1", "_Toc0003")];
  const dir = await makeTempDir("toc-ph-dash-");
  tempDirs.push(dir);
  const outPath = join(dir, "degraded.docx");
  // t15 的调用形态：tocNumbers=null + tocPlaceholder='——'
  const result = await renderDocx(astDocument(blocks), outPath, {
    templatePath: TEMPLATE_PATH,
    tocNumbers: null,
    tocPlaceholder: "——",
  });
  assert.equal(result.tocEntries.length, 3);
  const documentXml = partText(await readDocx(outPath), "word/document.xml");
  assert.equal(count(documentXml, /<w:t xml:space="preserve">——<\/w:t>/g), 3, "三条目录页码列都是 ——");
  assert.equal(count(documentXml, /<w:t xml:space="preserve">00<\/w:t>/g), 0, "降级时不得出现 00 冒充真实页码");
  assert.equal(count(documentXml, /w:updateFields/g), 0, "降级仍不写 updateFields");
  assert.equal(count(documentXml, /w:hyperlink w:anchor="_Toc\d{4}"/g), 3, "降级仍保留完整缓存条目");
  assert.match(documentXml, /TOC \\o "1-3"/, "降级仍写 TOC 域");
});

test("TOC 占位：非法值 -> convert-failed（不静默）", async () => {
  const blocks = [heading(1, "第一章", "_Toc0001"), heading(2, "1.1", "_Toc0002"), heading(3, "1.1.1", "_Toc0003")];
  const dir = await makeTempDir("toc-ph-bad-");
  tempDirs.push(dir);
  for (const bad of ["", "   ", 42, "0123456789abcdefg"]) {
    await assert.rejects(
      () => renderDocx(astDocument(blocks), join(dir, "bad.docx"), {
        templatePath: TEMPLATE_PATH,
        tocNumbers: null,
        tocPlaceholder: bad,
      }),
      (error) => error && error.code === "convert-failed" && error.detail.kind === "toc-placeholder-invalid",
      "非法占位应失败: " + JSON.stringify(bad),
    );
  }
});

test("TOC：tocNumbers 长度不符 -> convert-failed（不静默）", async () => {
  const blocks = [heading(1, "第一章", "_Toc0001"), heading(2, "1.1", "_Toc0002"), heading(3, "1.1.1", "_Toc0003")];
  const dir = await makeTempDir("toc-bad-");
  tempDirs.push(dir);
  await assert.rejects(
    () => renderDocx(astDocument(blocks), join(dir, "bad.docx"), { templatePath: TEMPLATE_PATH, tocNumbers: [1, 2] }),
    (error) => error && error.code === "convert-failed" && error.exitCode === 5,
  );
  await assert.rejects(
    () => renderDocx(astDocument(blocks), join(dir, "bad2.docx"), { templatePath: TEMPLATE_PATH, tocNumbers: [1, 2, 0] }),
    (error) => error && error.code === "convert-failed" && error.detail.kind === "toc-numbers-invalid",
  );
});

test("可复现：同一 AST 两次生成 SHA-256 完全相同，且 ZIP 时间戳/顺序固定", async () => {
  const blocks = [
    heading(1, "第一章 可复现", "_Toc0001"),
    paragraph(text("正文 A"), { kind: "code", text: "x" }, text("tail")),
    heading(2, "1.1 小节", "_Toc0002"),
    heading(3, "1.1.1 细节", "_Toc0003"),
    { kind: "hr" },
    { kind: "table", model: { align: ["left"], header: [[text("列")]], rows: [[[text("值")]]] } },
  ];
  const dirA = await makeTempDir("repro-a-");
  const dirB = await makeTempDir("repro-b-");
  tempDirs.push(dirA, dirB);
  const doc = astDocument(blocks);
  const first = await renderDocx(doc, join(dirA, "a.docx"), { templatePath: TEMPLATE_PATH });
  const second = await renderDocx(doc, join(dirB, "b.docx"), { templatePath: TEMPLATE_PATH });
  assert.equal(first.sha256, second.sha256, "两次生成字节一致");
  assert.equal(first.bytes, second.bytes);

  const buffer = await readFile(join(dirA, "a.docx"));
  const names = localEntryNames(buffer);
  assert.deepEqual(names.slice(0, EXPECTED_ORDER.length), EXPECTED_ORDER, "ZIP 条目顺序固定");
  assert.equal(buffer.readUInt16LE(10), 0, "DOS 时间固定 00:00:00");
  assert.equal(buffer.readUInt16LE(12), 0x0021, "DOS 日期固定 1980-01-01");
  const flags = buffer.readUInt16LE(6);
  assert.equal(flags, 0x0800, "通用位标志固定为 UTF-8 文件名（bit 11），bit 3 未置位");
  assert.equal(flags & 0x08, 0, "不使用 data descriptor");
});

test("可复现：重复写同一路径可覆盖，且不残留临时文件", async () => {
  const dir = await makeTempDir("overwrite-");
  tempDirs.push(dir);
  const outPath = join(dir, "same.docx");
  const doc = astDocument([heading(1, "标题", "_Toc0001"), paragraph(text("正文"))]);
  const first = await renderDocx(doc, outPath, { templatePath: TEMPLATE_PATH });
  const second = await renderDocx(doc, outPath, { templatePath: TEMPLATE_PATH });
  assert.equal(first.sha256, second.sha256);
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(dir);
  assert.deepEqual(files, ["same.docx"], "无 .tmp- 残留: " + files.join(","));
});

test("元数据与隐私：无日期、无绝对路径、无用户名、无随机 ID", async () => {
  const dir = await makeTempDir("meta-");
  tempDirs.push(dir);
  const outPath = join(dir, "meta.docx");
  await renderDocx(astDocument(longBlocks(2)), outPath, { templatePath: TEMPLATE_PATH });
  const parts = await readDocx(outPath);
  let blob = "";
  for (const [name, buffer] of parts) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) blob += buffer.toString("utf8");
  }
  assert.equal(count(blob, /20\d\d-\d\d-\d\d|20\d\d年\d+月/g), 0, "产物内无任何日期");
  assert.equal(blob.includes(process.env.USERNAME || "\u0000"), false, "无用户名");
  assert.equal(/[A-Z]:\\\\Users/.test(blob), false, "无绝对路径");
  const coreXml = partText(parts, "docProps/core.xml");
  assert.match(coreXml, /<dc:creator>docconvert<\/dc:creator>/);
  assert.equal(count(coreXml, /dcterms:created|dcterms:modified/g), 0);
  const appXml = partText(parts, "docProps/app.xml");
  assert.match(appXml, /<Application>docconvert<\/Application>/);
  assert.equal(count(appXml, /<Company>/g), 0);
});

test("模板缺失 -> template-missing（退出码 4，不静默）", async () => {
  const dir = await makeTempDir("notpl-");
  tempDirs.push(dir);
  await assert.rejects(
    () => renderDocx(astDocument([paragraph(text("x"))]), join(dir, "x.docx"), {
      templatePath: join(dir, "missing-template.docx"),
    }),
    (error) => error && error.code === "template-missing" && error.exitCode === 4,
  );
});

test("模板损坏 -> template-missing", async () => {
  const dir = await makeTempDir("badtpl-");
  tempDirs.push(dir);
  const brokenPath = join(dir, "broken.docx");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(brokenPath, Buffer.from("not a zip"));
  await assert.rejects(
    () => renderDocx(astDocument([paragraph(text("x"))]), join(dir, "x.docx"), { templatePath: brokenPath }),
    (error) => error && error.code === "template-missing" && error.detail.reason === "zip-invalid",
  );
});
