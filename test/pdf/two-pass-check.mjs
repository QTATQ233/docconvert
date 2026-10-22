/**
 * 两遍法端到端核验（开发卡 4）：34 标题 fixture / S-01（>99 页三位页码）/ S-02（浮动图片 + 跨页表格）。
 *
 * 为什么不用 renderWithToc：docx-render 在阶段 2.1 仍是桩（卡 3 落地），无法用 AST 生成真实版式。
 * 本脚本用真实 kit 走「DOCX -> PDF#1 -> readPdfOutline -> 回填 DOCX -> PDF#2 -> verifyTocConvergence」，
 * 覆盖本卡拥有的全部环节（pdf-renderer + toc 解析/计划/收敛判定）；编排重试逻辑由
 * test/toc/toc-convergence.test.mjs（TC-TOC-02）覆盖。
 *
 * 运行：node test/pdf/two-pass-check.mjs [--json=out.json]
 * 退出码：0 = 全部通过；1 = 有失败项。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { renderPdf } from "../../src/pdf/index.js";
import { locateKit } from "../../src/kit/index.js";
import { readPdfOutline, tocOutlineEntries } from "../../src/toc/outline.js";
import { planTocNumbers, verifyTocConvergence } from "../../src/toc/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "..");
const args = process.argv.slice(2);
const jsonOut = (args.find((item) => item.startsWith("--json=")) || "").slice(7);

// ---------------------------------------------------------------- ZIP / OOXML 最小工具
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/** 固定时间戳的 ZIP（仅测试 fixture 使用）。 */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const compressed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONTS = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri"/>';

function p(text) {
  return '<w:p><w:r>' + FONTS + '<w:t xml:space="preserve">' + esc(text) + "</w:t></w:r></w:p>";
}
function heading(level, text, id) {
  return '<w:p><w:pPr><w:pStyle w:val="Heading' + level + '"/><w:keepNext/>' +
    '<w:bookmarkStart w:id="' + (100 + id) + '" w:name="_Toc9' + String(id).padStart(4, "0") + '"/>' +
    '<w:bookmarkEnd w:id="' + (100 + id) + '"/></w:pPr><w:r><w:t xml:space="preserve">' + esc(text) + "</w:t></w:r></w:p>";
}
function pageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}
function tocLine(level, text, pageText, id) {
  return '<w:p><w:pPr><w:pStyle w:val="TOC' + level + '"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9600"/></w:tabs></w:pPr>' +
    '<w:hyperlink w:anchor="_Toc9' + String(id).padStart(4, "0") + '" w:history="1">' +
    '<w:r><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r><w:r><w:tab/></w:r>' +
    '<w:r><w:t xml:space="preserve">' + esc(pageText) + "</w:t></w:r></w:hyperlink></w:p>";
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr>' + FONTS + '<w:sz w:val="24"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr><w:rPr>' + FONTS + '<w:sz w:val="24"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/><w:spacing w:before="180" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/><w:spacing w:before="180" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9600"/></w:tabs><w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9600"/></w:tabs><w:ind w:left="240"/><w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9600"/></w:tabs><w:ind w:left="480"/><w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="21"/></w:rPr></w:style>' +
  "</w:styles>";

const SETTINGS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:defaultTabStop w:val="420"/></w:settings>';

/** 浮动图片（wp:anchor + wrapSquare），用于 S-02。 */
function floatingImage(relId) {
  return '<w:p><w:pPr><w:spacing w:before="120" w:after="240"/></w:pPr><w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>2286000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2743200" cy="1828800"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Figure 1"/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="figure"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="1828800"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor>' +
    "</w:drawing></w:r></w:p>";
}

/** 跨页长表格（60 行 x 3 列）。 */
function longTable(rows) {
  const cell = (text, header) =>
    '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r>' +
    (header ? "<w:rPr><w:b/></w:rPr>" : "") + '<w:t xml:space="preserve">' + esc(text) + "</w:t></w:r></w:p></w:tc>";
  let xml = '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>';
  xml += "<w:tr>" + cell("序号", true) + cell("名称 Name", true) + cell("说明 Note", true) + "</w:tr>";
  for (let i = 1; i <= rows; i += 1) {
    xml += "<w:tr>" + cell(String(i), false) + cell("行 " + String(i) + " Row", false) + cell("跨页表格稳定性 sample", false) + "</w:tr>";
  }
  return xml + "</w:tbl>";
}

/**
 * 生成 S-02 测试 DOCX：封面 + 目录（占位/回填）+ 浮动图片 + 跨页表格 + 8 个章节。
 * @param {{ outPath: string, numbers: Record<string, string|number>|null, imagePath: string, imageExt: string }} options
 */
function buildS02Docx(options) {
  const { outPath, numbers, imagePath, imageExt } = options;
  const headings = [];
  let id = 0;
  for (let chapter = 1; chapter <= 8; chapter += 1) {
    headings.push({ id: ++id, level: 1, text: String(chapter) + " 第" + String(chapter) + "章 稳定性" });
    headings.push({ id: ++id, level: 2, text: String(chapter) + ".1 小节 Section" });
    headings.push({ id: ++id, level: 3, text: String(chapter) + ".1.1 主题 Topic" });
  }
  const pageText = (headingId) => {
    if (!numbers) return "00";
    const value = numbers[headingId];
    return value === undefined ? "00" : String(value);
  };
  let body = '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="240"/></w:pPr>' +
    '<w:r>' + FONTS + '<w:rPr><w:b/><w:sz w:val="56"/></w:rPr><w:t>S-02 稳定性 fixture</w:t></w:r></w:p>';
  body += pageBreak();
  body += p("目录 Contents");
  for (const heading of headings) body += tocLine(heading.level, heading.text, pageText(heading.id), heading.id);
  body += pageBreak();
  for (const item of headings) {
    body += heading(item.level, item.text, item.id);
    if (item.level === 1) {
      body += p("本章用于验证浮动图片与跨页表格是否破坏两遍分页一致性。This chapter hosts a floating image.");
      body += floatingImage("rId4");
      body += p("浮动图片之后的正文，用于验证 wrapSquare 周围的文字排布与分页。");
      body += longTable(60);
      body += p("跨页表格之后的正文，继续占据版面，确保表格确实跨页。");
    } else {
      body += p("普通正文段落，用于填充分页。Body text for pagination.");
    }
  }
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1134" w:bottom="1247" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>";
  const contentType = imageExt === "jpg" ? "image/jpeg" : "image/png";
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="' + imageExt + '" ContentType="' + contentType + '"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    "</Types>";
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";
  const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.' + imageExt + '"/>' +
    "</Relationships>";
  const buffer = zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/styles.xml", data: STYLES },
    { name: "word/settings.xml", data: SETTINGS },
    { name: "word/media/image1." + imageExt, data: readFileSync(imagePath) },
  ]);
  writeFileSync(outPath, buffer);
  return { headings, entries: headings };
}

// ---------------------------------------------------------------- 核验主流程
const report = { role: "dev-pdf", stage: "2.1", checks: [], fixtures: [] };
const workDir = mkdtempSync(join(tmpdir(), "docconvert-twopass-"));
const outDir = join(workDir, "out");
mkdirSync(outDir, { recursive: true });

/** @param {string} name @param {boolean} ok @param {object} detail */
function check(name, ok, detail) {
  report.checks.push({ name, ok, detail });
}

/** 把 outline（过滤 level<=2）映射成 mkdocx 的 numbers 文件（heading id = 顺序）。 */
function numbersFromOutline(outline) {
  const filtered = tocOutlineEntries(outline);
  const numbers = {};
  filtered.forEach((entry, index) => {
    numbers[String(index + 1)] = entry.page;
  });
  return numbers;
}

/**
 * 跑一个 fixture 的两遍法。
 * @param {{ name: string, pass1: () => void, entries: () => Array<object>, buildPass2: (numbers: object) => void, expectedMinEntries?: number }} fixture
 */
async function runFixture(fixture) {
  const kit = locateKit({ installRoot: packageRoot });
  const base = join(workDir, fixture.name);
  mkdirSync(base, { recursive: true });
  const started = Date.now();
  const pdf1 = join(base, "pass1.pdf");
  const docx1 = join(base, "pass1.docx");
  fixture.pass1(docx1);
  const t0 = Date.now();
  await renderPdf(docx1, pdf1, { kit, workDir });
  const t1 = Date.now();
  const outline1 = await readPdfOutline(pdf1);
  const entries = fixture.entries();
  const numbers = planTocNumbers(outline1, entries);
  check(fixture.name + ":outline-count", tocOutlineEntries(outline1).length === entries.length, {
    outline: tocOutlineEntries(outline1).length,
    entries: entries.length,
  });
  const docx2 = join(base, "pass2.docx");
  const pdf2 = join(base, "pass2.pdf");
  fixture.buildPass2(numbers, docx2);
  await renderPdf(docx2, pdf2, { kit, workDir });
  const t2 = Date.now();
  const outline2 = await readPdfOutline(pdf2);
  const verdict = verifyTocConvergence(outline1, outline2, numbers);
  const matched = tocOutlineEntries(outline2).filter((entry, index) => entry.page === numbers[index]).length;
  const total = tocOutlineEntries(outline2).length;
  check(fixture.name + ":page-count-stable", outline1.pageCount === outline2.pageCount, {
    pass1: outline1.pageCount,
    pass2: outline2.pageCount,
  });
  check(fixture.name + ":converged", verdict.converged, { mismatches: verdict.mismatches.slice(0, 3) });
  check(fixture.name + ":page-match", matched === total && total > 0, { matched, total });
  const entry = {
    fixture: fixture.name,
    pages: outline2.pageCount,
    entries: total,
    matched,
    converged: verdict.converged,
    retries: 0,
    pass1Ms: t1 - t0,
    pass2Ms: t2 - t1,
    totalMs: Date.now() - started,
    sha256Pdf2: createHash("sha256").update(readFileSync(pdf2)).digest("hex").slice(0, 16),
  };
  report.fixtures.push(entry);
  return entry;
}

try {
  // 1) 34 标题 fixture：spike 生成的真实版式 DOCX（34 条 H1–H3 / 8 页）。
  const mkdocx = join(packageRoot, "_spike", "mkdocx.mjs");
  const spike34 = join(workDir, "fixture-34", "pass1.docx");
  mkdirSync(join(workDir, "fixture-34"), { recursive: true });
  // 沙箱禁止管道 stdio（避坑指南 1）→ spawnSync 用 stdio:"ignore"，不捕获子进程输出。
  const gen34 = spawnSync(process.execPath, [mkdocx, spike34, "--toc=cached", "--update-fields=false"], { stdio: "ignore" });
  if (gen34.status !== 0) throw new Error("mkdocx 34 标题 fixture 生成失败：status=" + String(gen34.status));
  const headings34 = [];
  {
    const source = readFileSync(mkdocx, "utf8");
    const re = /level: (\d), text: "([^"]+)"/g;
    let match;
    while ((match = re.exec(source))) headings34.push({ level: Number(match[1]), text: match[2] });
    headings34.splice(0, headings34.length, ...headings34.filter((item) => item.level <= 3));
  }
  const entries34 = headings34.map((item, index) => ({
    index: index + 1,
    level: Math.min(3, item.level),
    text: item.text,
    bookmark: "_Toc9" + String(index + 1).padStart(4, "0"),
  }));
  const r34 = await runFixture({
    name: "fixture-34",
    pass1: (out) => { if (out !== spike34) copyFileSync(spike34, out); },
    entries: () => entries34,
    buildPass2: (numbers, target) => {
      const numbersPath = join(workDir, "fixture-34", "numbers.json");
      writeFileSync(numbersPath, JSON.stringify(numbers));
      const gen = spawnSync(process.execPath, [mkdocx, target, "--toc=cached", "--update-fields=false", "--numbers=" + numbersPath], { stdio: "ignore" });
      if (gen.status !== 0) throw new Error("mkdocx 34 标题 pass2 生成失败：status=" + String(gen.status));
    },
  });
  report.fixtures[report.fixtures.length - 1].note = "34 标题 fixture（spike 版式）：页码 " + String(r34.matched) + "/" + String(r34.entries);

  // 2) S-01：> 99 页（110 章 x 6 标题 = 660 条），占位强制 3 位 "000"，回填 3 位页码。
  const s01Dir = join(workDir, "s01");
  mkdirSync(s01Dir, { recursive: true });
  const placeholder = {};
  for (let i = 1; i <= 660; i += 1) placeholder[String(i)] = "000";
  const placeholderPath = join(s01Dir, "placeholder.json");
  writeFileSync(placeholderPath, JSON.stringify(placeholder));
  const genS01a = spawnSync(process.execPath, [mkdocx, join(s01Dir, "pass1.docx"), "--toc=cached", "--update-fields=false", "--chapters=110", "--numbers=" + placeholderPath], { stdio: "ignore" });
  if (genS01a.status !== 0) throw new Error("mkdocx S-01 pass1 生成失败：status=" + String(genS01a.status));
  const headingsS01 = [];
  for (let chapter = 1; chapter <= 110; chapter += 1) {
    headingsS01.push({ level: 1, text: chapter + " Chapter " + chapter + " 章节" });
    headingsS01.push({ level: 2, text: chapter + ".1 Section 小节" });
    headingsS01.push({ level: 3, text: chapter + ".1.1 Topic 主题" });
    headingsS01.push({ level: 3, text: chapter + ".1.2 Topic 主题二" });
    headingsS01.push({ level: 2, text: chapter + ".2 Section 小节二" });
    headingsS01.push({ level: 3, text: chapter + ".2.1 Topic 主题三" });
  }
  const entriesS01 = headingsS01.map((item, index) => ({
    index: index + 1,
    level: item.level,
    text: item.text,
    bookmark: "_Toc9" + String(index + 1).padStart(4, "0"),
  }));
  await runFixture({
    name: "S-01-long-3digit",
    pass1: (out) => copyFileSync(join(s01Dir, "pass1.docx"), out),
    entries: () => entriesS01,
    buildPass2: (numbers, target) => {
      const numbersPath = join(s01Dir, "numbers.json");
      writeFileSync(numbersPath, JSON.stringify(numbers));
      const gen = spawnSync(process.execPath, [mkdocx, target, "--toc=cached", "--update-fields=false", "--chapters=110", "--numbers=" + numbersPath], { stdio: "ignore" });
      if (gen.status !== 0) throw new Error("mkdocx S-01 pass2 生成失败：status=" + String(gen.status));
    },
  });
  const s01 = report.fixtures[report.fixtures.length - 1];
  check("S-01:pages>99", s01.pages > 99, { pages: s01.pages });
  check("S-01:has-3digit-pages", s01.pageMatchMax >= 100 || s01.pages > 99, { pages: s01.pages });

  // 3) S-02：浮动图片 + 跨页表格。
  const s02Dir = join(workDir, "s02");
  mkdirSync(s02Dir, { recursive: true });
  const imagePath = join(packageRoot, "examples", "assets", "figure-flow.png");
  const s02Headings = [];
  for (let chapter = 1; chapter <= 8; chapter += 1) {
    s02Headings.push({ level: 1, text: chapter + " 第" + chapter + "章 稳定性" });
    s02Headings.push({ level: 2, text: chapter + ".1 小节 Section" });
    s02Headings.push({ level: 3, text: chapter + ".1.1 主题 Topic" });
  }
  const entriesS02 = s02Headings.map((item, index) => ({
    index: index + 1,
    level: item.level,
    text: item.text,
    bookmark: "_Toc9" + String(index + 1).padStart(4, "0"),
  }));
  await runFixture({
    name: "S-02-float-table",
    pass1: (out) => buildS02Docx({ outPath: out, numbers: null, imagePath, imageExt: "png" }),
    entries: () => entriesS02,
    buildPass2: (numbers, target) => buildS02Docx({ outPath: target, numbers, imagePath, imageExt: "png" }),
  });

  report.ok = report.checks.every((item) => item.ok);
} catch (error) {
  report.ok = false;
  report.error = String(error && error.stack ? error.stack : error);
} finally {
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  rmSync(workDir, { recursive: true, force: true });
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
