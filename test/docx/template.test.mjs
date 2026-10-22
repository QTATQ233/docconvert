/**
 * 模板测试：部件齐全、无正文文本、样式与 config token 一致、无 updateFields、可重复生成。
 * 运行：node --test --test-isolation=none test/docx/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zipRead } from "../../src/docx/zip.js";
import { buildTemplate } from "../../tools/build-template.js";
import { count, partText, TEMPLATE_PATH } from "./helpers.mjs";

/** architecture 4.3 的 16 个冻结样式 ID。 */
const FROZEN_STYLE_IDS = [
  "Normal",
  "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6",
  "DocTitle", "TOC1", "TOC2", "TOC3",
  "CodeBlock", "TableText", "Quote", "FooterText", "CharacterInlineCode",
];

/** 辅助样式（把版式值关进模板，避免渲染器硬编码）。 */
const AUX_STYLE_IDS = ["Hyperlink", "HrLine", "CoverRule", "TocTitle", "TableDoc", "TableGap"];

const EXPECTED_PARTS = [
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

const TEMPLATE_BUFFER = await readFile(TEMPLATE_PATH);
const TEMPLATE_PARTS = zipRead(TEMPLATE_BUFFER);
const STYLES_XML = partText(TEMPLATE_PARTS, "word/styles.xml");
const DOCUMENT_XML = partText(TEMPLATE_PARTS, "word/document.xml");
const SETTINGS_XML = partText(TEMPLATE_PARTS, "word/settings.xml");
const NUMBERING_XML = partText(TEMPLATE_PARTS, "word/numbering.xml");
const FOOTER_XML = partText(TEMPLATE_PARTS, "word/footer1.xml");

test("模板部件齐全且顺序符合 architecture 8.1", () => {
  const names = [...TEMPLATE_PARTS.keys()];
  assert.deepEqual(names, EXPECTED_PARTS);
});

test("模板不含正文文本（REQ-TPL-002 / TC-TPL-01 visible_text=0）", () => {
  assert.equal(count(DOCUMENT_XML, /<w:t[^>]*>[^<]+<\/w:t>/g), 0, "document.xml 无任何可见文本节点");
  assert.equal(count(DOCUMENT_XML, /<w:t\b/g), 0);
});

test("模板定义 16 个冻结样式 + 6 个辅助样式", () => {
  const ids = new Set([...STYLES_XML.matchAll(/w:styleId="([^"]+)"/g)].map((hit) => hit[1]));
  for (const id of [...FROZEN_STYLE_IDS, ...AUX_STYLE_IDS]) assert.ok(ids.has(id), "缺少样式 " + id);
  assert.equal(count(STYLES_XML, /<w:style\b/g), FROZEN_STYLE_IDS.length + AUX_STYLE_IDS.length + 1, "23 个样式（16 冻结 + 6 辅助 + TableNormal 默认表样式）");
});

test("样式数值与 config token 一致（T05/T06/T07/T08/T12-T14/T17/T22/T24/T26/T27/T28）", () => {
  assert.match(STYLES_XML, /w:ascii="Calibri"/);
  assert.match(STYLES_XML, /w:eastAsia="微软雅黑"/);
  assert.match(STYLES_XML, /w:ascii="Consolas"/);
  const szOf = (styleId) => {
    const hit = new RegExp('<w:style w:type="paragraph" w:styleId="' + styleId + '">[\\s\\S]*?</w:style>').exec(STYLES_XML);
    assert.ok(hit, "缺少样式块 " + styleId);
    const sz = /<w:sz w:val="(\d+)"\/>/.exec(hit[0]);
    return sz ? Number(sz[1]) : Number.NaN;
  };
  assert.equal(szOf("Normal"), 24, "正文 12pt");
  assert.equal(szOf("Heading1"), 36, "H1 18pt");
  assert.equal(szOf("Heading2"), 30, "H2 15pt");
  assert.equal(szOf("Heading3"), 26, "H3 13pt");
  assert.equal(szOf("TableText"), 17, "表格 8.5pt");
  assert.equal(szOf("CodeBlock"), 18, "代码 9pt");
  assert.equal(szOf("FooterText"), 18, "页脚 9pt");
  assert.equal(szOf("TOC1"), 21, "目录 10.5pt");
  assert.equal(szOf("DocTitle"), 52, "封面 26pt");
  assert.match(STYLES_XML, /<w:ind w:firstLineChars="200" w:firstLine="480"\/>/, "正文首行缩进 2 字符（T10）");
  assert.match(STYLES_XML, /w:line="360" w:lineRule="auto"/, "1.5 倍行距（T09）");
  for (let level = 0; level < 6; level += 1) {
    assert.equal(count(STYLES_XML, new RegExp('<w:outlineLvl w:val="' + level + '"/>', "g")), 1, "大纲级别 " + level);
  }
  assert.match(STYLES_XML, /w:fill="EDEDED"/, "表头底纹（T19）");
  assert.match(STYLES_XML, /w:fill="F5F5F5"/, "代码底纹（T23）");
  assert.match(STYLES_XML, /<w:color w:val="0563C1"\/>/, "链接色来自 config");
  assert.match(STYLES_XML, /<w:color w:val="808080"\/>/, "页脚灰来自 config");
  assert.match(STYLES_XML, /<w:tab w:val="right" w:leader="dot" w:pos="9638"\/>/, "目录点线引导到版心右边界（T27）");
});

test("页面设置与 architecture T01-T04 一致，且封面页无页脚（titlePg）", () => {
  assert.match(DOCUMENT_XML, /<w:pgSz w:w="11906" w:h="16838"\/>/, "A4（T01）");
  assert.match(DOCUMENT_XML, /w:top="1247" w:right="1134" w:bottom="1247" w:left="1134"/, "边距 2.2/2.0cm（T02/T03）");
  assert.match(DOCUMENT_XML, /<w:titlePg\/>/, "首页不同（封面无页脚，REQ-LAY-012）");
  assert.match(DOCUMENT_XML, /<w:footerReference w:type="default" r:id="rId3"\/>/);
  assert.match(FOOTER_XML, /<w:pStyle w:val="FooterText"\/>/);
  assert.match(FOOTER_XML, /<w:instrText xml:space="preserve"> PAGE <\/w:instrText>/, "页脚 PAGE 域（T26）");
});

test("settings.xml 不含 updateFields / rsids（E2 裁决 + 8.2）", () => {
  assert.equal(count(SETTINGS_XML, /w:updateFields/g), 0);
  assert.equal(count(SETTINGS_XML, /w:rsids/g), 0);
});

test("numbering.xml：bullet + decimal，各 3 级，每级缩进 419 悬挂 419（T30）", () => {
  assert.equal(count(NUMBERING_XML, /<w:abstractNum /g), 2);
  assert.equal(count(NUMBERING_XML, /<w:numFmt w:val="bullet"\/>/g), 3);
  assert.equal(count(NUMBERING_XML, /<w:numFmt w:val="decimal"\/>/g), 1);
  assert.equal(count(NUMBERING_XML, /<w:ind w:left="419" w:hanging="419"\/>/g), 2, "一级缩进");
  assert.equal(count(NUMBERING_XML, /<w:ind w:left="838" w:hanging="419"\/>/g), 2, "二级缩进");
  assert.equal(count(NUMBERING_XML, /<w:ind w:left="1257" w:hanging="419"\/>/g), 2, "三级缩进");
  assert.match(NUMBERING_XML, /<w:num w:numId="1"><w:abstractNumId w:val="0"\/><\/w:num>/);
  assert.match(NUMBERING_XML, /<w:num w:numId="2"><w:abstractNumId w:val="1"\/><\/w:num>/);
});

test("模板与 config 同步：两次进程内生成字节一致，且与仓库内模板逐字节相同", async () => {
  const first = await buildTemplate();
  const second = await buildTemplate();
  assert.equal(first.sha256, second.sha256, "同一 config 两次生成一致");
  const committed = createHash("sha256").update(TEMPLATE_BUFFER).digest("hex").toUpperCase();
  assert.equal(committed, first.sha256, "templates/reference.docx 是 tools/build-template.js 的当前产物（无漂移）");
  assert.deepEqual(first.parts.map((part) => part.name), EXPECTED_PARTS);
});
