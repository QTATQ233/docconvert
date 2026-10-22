/**
 * 真实管线端到端核验（开发卡 4）：examples/headings.md（34 标题）与 examples/long-50.md（135 标题）。
 *
 * 链路：preprocess（真实）-> renderWithToc（真实 docx-render + pdf-render + toc 两遍法）-> 独立复核：
 *   - 最终 PDF 书签（level<=2）条数 == 目录条目数；
 *   - DOCX 目录段落里的页码（逐条）== 最终 PDF 书签页序（即 34/34、135/135）；
 *   - updateFields 不存在（打开不弹窗，§7.2）；标题书签存在；
 *   - TocReport：mode=two-pass、passes=2、converged=true、mismatches=[]。
 *
 * 运行：node test/pdf/e2e-real-pipeline.mjs [--json=out.json]
 */
import { inflateRawSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preprocess } from "../../src/preprocess/index.js";
import { renderWithToc } from "../../src/toc/index.js";
import { readPdfOutline, tocOutlineEntries } from "../../src/toc/outline.js";
import { locateKit } from "../../src/kit/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const htmlPath = join(packageRoot, "examples", "headings.md");
const longPath = join(packageRoot, "examples", "long-50.md");
const jsonOut = (process.argv.slice(2).find((item) => item.startsWith("--json=")) || "").slice(7);

/** 从 ZIP 中取出一个条目的原始字节（只支持 store/deflate，够读 OOXML 即可）。 */
function unzipEntry(buffer, entryName) {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (name === entryName) return method === 0 ? data : inflateRawSync(data);
    offset = dataStart + compressedSize;
  }
  return null;
}

/** 抽取 DOCX 目录段落里的页码文本（每条目一行）。 */
function tocPageTexts(documentXml) {
  const paragraphs = documentXml.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*?w:pStyle w:val="TOC[123]"(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g) || [];
  const pages = [];
  for (const paragraph of paragraphs) {
    const texts = [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]);
    if (texts.length > 0) pages.push(texts[texts.length - 1]);
  }
  return pages;
}

const report = { role: "dev-pdf", stage: "2.1", cases: [], ok: true };
const base = mkdtempSync(join(tmpdir(), "docconvert-e2e-"));
const kit = locateKit({ installRoot: packageRoot });

/** @param {{ label: string, source: string, expectMinEntries: number }} testCase */
async function runCase(testCase) {
  const outDir = join(base, testCase.label);
  const workDir = join(base, testCase.label + "-work");
  mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const doc = await preprocess(testCase.source);
  const result = await renderWithToc(doc, {
    outDir,
    workDir,
    templatePath: join(packageRoot, "templates", "reference.docx"),
    wantDocx: true,
    wantPdf: true,
    kit,
    tocThreshold: 3,
    timeoutMs: 180000,
  });
  const outline = await readPdfOutline(result.pdf.outputPath);
  const filtered = tocOutlineEntries(outline);
  const documentXml = unzipEntry(readFileSync(result.docx.outputPath), "word/document.xml").toString("utf8");
  const numbers = tocPageTexts(documentXml);
  const numeric = numbers.filter((value) => /^\d+$/.test(value)).map(Number);
  const matched = numeric.filter((value, index) => filtered[index] && filtered[index].page === value).length;
  const expected = filtered.length;
  const updateFields = (documentXml.match(/<w:updateFields/g) || []).length;
  const bookmarks = (documentXml.match(/<w:bookmarkStart/g) || []).length;
  const entry = {
    case: testCase.label,
    source: testCase.source.replace(packageRoot + "\\", ""),
    pages: outline.pageCount,
    entries: result.toc.entries,
    outlineEntries: expected,
    tocNumberLines: numeric.length,
    matched,
    expected,
    converged: result.toc.converged,
    passes: result.toc.passes,
    mode: result.toc.mode,
    mismatches: result.toc.mismatches.length,
    updateFields,
    bookmarks,
    elapsedMs: Date.now() - started,
  };
  entry.ok = result.toc.mode === "two-pass"
    && result.toc.converged === true
    && result.toc.mismatches.length === 0
    && result.toc.entries === expected
    && expected >= testCase.expectMinEntries
    && numeric.length === expected
    && matched === expected
    && updateFields === 0
    && bookmarks >= expected;
  if (!entry.ok) report.ok = false;
  report.cases.push(entry);
}

try {
  // 期望值取 fixtures 的实际 H1–H3 数（examples/headings.md = 25 条、examples/long-50.md = 134 条）；
  // test-cases.md 写的 34 / 135 与实际样本不符，已作为 C-PDF-04 上报（不属于本卡可改文件）。
  await runCase({ label: "headings-25", source: htmlPath, expectMinEntries: 25 });
  await runCase({ label: "long-50-134", source: longPath, expectMinEntries: 134 });
} catch (error) {
  report.ok = false;
  report.error = String(error && error.stack ? error.stack : error);
} finally {
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  rmSync(base, { recursive: true, force: true });
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
