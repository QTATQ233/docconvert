/**
 * docx-render 结构测试：标题层级、短/长文骨架、表格、代码块、列表、引用、链接、图片。
 * 运行：node --test --test-isolation=none test/docx/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { renderDocx } from "../../src/docx/index.js";
import {
  astDocument,
  count,
  heading,
  makeTempDir,
  missingAsset,
  paragraph,
  partText,
  pngAsset,
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

/**
 * @param {string} name
 * @param {object} doc
 * @param {object} [options]
 */
async function render(name, doc, options = {}) {
  const dir = await makeTempDir(name + "-");
  tempDirs.push(dir);
  const outPath = join(dir, name + ".docx");
  const result = await renderDocx(doc, outPath, { templatePath: TEMPLATE_PATH, ...options });
  const parts = await readDocx(outPath);
  return { result, parts, documentXml: partText(parts, "word/document.xml"), stylesXml: partText(parts, "word/styles.xml"), dir };
}

test("标题：pStyle Heading1-6 + 书签，大纲级别来自模板样式", async () => {
  const blocks = [
    heading(1, "第一章 总则", "_Toc0001"),
    paragraph(text("正文。")),
    heading(2, "1.1 目的", "_Toc0002"),
    heading(3, "1.1.1 细节", "_Toc0003"),
    heading(4, "1.1.1.1 更深", "_Toc0004"),
    heading(5, "更深五级", "_Toc0005"),
    heading(6, "更深六级", "_Toc0006"),
  ];
  const { documentXml, stylesXml } = await render("headings", astDocument(blocks));
  for (let level = 1; level <= 6; level += 1) {
    assert.equal(count(documentXml, new RegExp('w:pStyle w:val="Heading' + level + '"', "g")), 1, "Heading" + level + " 引用数");
    assert.equal(count(stylesXml, new RegExp('<w:style w:type="paragraph" w:styleId="Heading' + level + '"', "g")), 1);
  }
  assert.equal(count(documentXml, /<w:bookmarkStart /g), 6, "每个标题一个书签");
  assert.equal(count(documentXml, /<w:bookmarkEnd /g), 6);
  assert.equal(count(documentXml, /w:outlineLvl/g), 0, "document.xml 不写 outlineLvl（来自样式）");
  assert.equal(count(stylesXml, /<w:outlineLvl w:val="/g), 6, "H1-H6 各一个大纲级别");
  assert.match(documentXml, /w:bookmarkStart w:id="1" w:name="_Toc0001"/);
  assert.match(documentXml, /w:bookmarkStart w:id="6" w:name="_Toc0006"/, "书签 ID 按文档顺序递增");
});

test("短文（H1-H3 < 3）：无封面、无目录、正文从第 1 页开始", async () => {
  const blocks = [heading(1, "唯一标题", "_Toc0001"), paragraph(text("正文。"))];
  const { documentXml, result } = await render("short", astDocument(blocks));
  assert.equal(result.tocEntries.length, 1);
  assert.equal(count(documentXml, /w:pStyle w:val="DocTitle"/g), 0, "无封面标题");
  assert.equal(count(documentXml, /w:pStyle w:val="TocTitle"/g), 0, "无目录标题");
  assert.equal(count(documentXml, /TOC \\o/g), 0, "无 TOC 域");
  assert.equal(count(documentXml, /w:br w:type="page"/g), 0, "无分页符");
});

test("长文（H1-H3 >= 3）：封面 + 目录 + 分页骨架", async () => {
  const blocks = [
    heading(1, "第一章", "_Toc0001"),
    heading(2, "1.1", "_Toc0002"),
    heading(3, "1.1.1", "_Toc0003"),
  ];
  const { documentXml } = await render("long", astDocument(blocks, { title: "封面标题" }));
  assert.equal(count(documentXml, /w:pStyle w:val="DocTitle"/g), 1);
  assert.match(documentXml, /<w:t xml:space="preserve">封面标题<\/w:t>/);
  assert.equal(count(documentXml, /w:pStyle w:val="CoverRule"/g), 1);
  assert.equal(count(documentXml, /w:pStyle w:val="TocTitle"/g), 1);
  assert.equal(count(documentXml, /w:br w:type="page"/g), 2, "封面后 + 目录后各一次分页");
});

test("表格：固定布局 + 版心宽度 + 表头重复 + 行不跨页 + 等分列宽", async () => {
  const model = {
    align: ["left", null, "right"],
    header: [[text("序号")], [text("物种")], [text("数量")]],
    rows: [[[text("1")], [text("芦苇")], [text("12")]], [[text("2")], [text("菹草")]]],
  };
  const { documentXml, stylesXml } = await render("table", astDocument([{ kind: "table", model }]));
  assert.equal(count(documentXml, /w:tblLayout w:type="fixed"/g), 1);
  assert.match(documentXml, /<w:tblW w:w="9638" w:type="dxa"\/>/, "表格宽 = 版心宽（T18）");
  assert.equal(count(documentXml, /w:tblHeader/g), 1, "表头行重复标记");
  assert.equal(count(documentXml, /w:cantSplit/g), 3, "三行都不跨页");
  const gridCols = [...documentXml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((hit) => Number(hit[1]));
  assert.equal(gridCols.length, 3);
  assert.equal(gridCols.reduce((sum, value) => sum + value, 0), 9638, "列宽合计 = 版心宽");
  assert.equal(count(documentXml, /w:pStyle w:val="TableText"/g), 9, "每个单元格一个 TableText 段落（3 列 x 3 行，短行补齐空单元格）");
  assert.match(documentXml, /<w:jc w:val="left"\/>/, "列对齐来自 model.align");
  assert.match(stylesXml, /w:fill="EDEDED"/, "表头底纹来自模板样式（T19）");
  assert.match(stylesXml, /w:tblCellMar/, "单元格边距来自模板样式（T20）");
  assert.equal(count(documentXml, /w:pStyle w:val="TableGap"/g), 1, "表后空段（T21）");
});

test("代码块：单段连续底纹 + 行间 br + 长行完整保留", async () => {
  const filler = "0123456789abcdefghij".repeat(8);
  const longLine = 'const photo = { name: "x", filler: "' + filler + '", photo: "20261018_A2_003.jpg" };';
  const code = "function demo() {\n\tif (a) {" + longLine + "}\n}";
  const { documentXml, stylesXml } = await render("code", astDocument([{ kind: "code", lang: "js", text: code }]));
  assert.equal(count(documentXml, /w:pStyle w:val="CodeBlock"/g), 1, "整块一个段落（连续底纹）");
  assert.equal(count(documentXml, /<w:br\/>/g), 2, "3 行 -> 2 个换行");
  assert.equal(count(documentXml, /<w:tab\/>/g), 1, "制表符转 w:tab");
  assert.match(documentXml, /20261018_A2_003\.jpg/, "超长行内容完整保留");
  assert.match(stylesXml, /w:ascii="Consolas"/, "等宽字体来自模板（T07）");
  assert.match(stylesXml, /w:fill="F5F5F5"/, "浅底来自模板（T23）");
  assert.match(stylesXml, /<w:wordWrap w:val="true"\/>/, "允许字符级断行，长行不裁切");
});

test("列表：有序/无序编号引用模板 numbering，嵌套层级 0-2", async () => {
  const list = {
    kind: "list",
    ordered: true,
    start: 3,
    tight: true,
    items: [
      { children: [paragraph(text("第一项"))] },
      {
        children: [
          paragraph(text("第二项")),
          { kind: "list", ordered: false, start: 1, tight: true, items: [{ children: [paragraph(text("嵌套项"))] }] },
        ],
      },
    ],
  };
  const { documentXml, parts } = await render("list", astDocument([list]));
  const numberingXml = partText(parts, "word/numbering.xml");
  assert.match(documentXml, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="3"\/><\/w:numPr>/, "有序列表用新 numId");
  assert.match(numberingXml, /<w:num w:numId="3"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"\/>/, "start 用 startOverride，不改抽象编号");
  assert.match(documentXml, /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="1"\/><\/w:numPr>/, "嵌套无序列表 ilvl=1 + 模板 bullet numId=1");
  assert.equal(count(documentXml, /w:firstLine="0"/g), 3, "列表项首行缩进显式归零");
});

test("引用 / 分隔线 / 行内代码 / 链接 / 降级链接", async () => {
  const blocks = [
    { kind: "blockquote", depth: 1, children: [paragraph(text("引用段落"))] },
    { kind: "hr" },
    paragraph(
      { kind: "strong", children: [text("粗体")] },
      { kind: "em", children: [text("斜体")] },
      { kind: "code", text: "inline()" },
      { kind: "link", href: "https://example.com/a", children: [text("外链")] },
      { kind: "link", href: "相对/路径.md", degraded: true, children: [text("降级链接")] },
      { kind: "br" },
    ),
  ];
  const { documentXml, parts } = await render("inline", astDocument(blocks));
  assert.equal(count(documentXml, /w:pStyle w:val="Quote"/g), 1);
  assert.equal(count(documentXml, /w:pStyle w:val="HrLine"/g), 1);
  assert.match(documentXml, /<w:rStyle w:val="CharacterInlineCode"\/>/, "行内代码用字符样式");
  assert.equal(count(documentXml, /<w:hyperlink r:id="rId\d+" w:history="1">/g), 1, "只有 http 链接建关系");
  assert.match(documentXml, /<w:rStyle w:val="Hyperlink"\/>/, "链接文字用模板 Hyperlink 样式");
  assert.match(documentXml, /降级链接/, "降级链接保留文字");
  assert.equal(count(documentXml, /<w:br\/>/g), 1);
  const relsXml = partText(parts, "word/_rels/document.xml.rels");
  assert.match(relsXml, /Target="https:\/\/example\.com\/a" TargetMode="External"/);
  assert.match(relsXml, /Target="styles\.xml"/, "模板关系保留");
});

test("图片：内嵌 media + 版心缩放（不放大、保持比例）+ 缺图占位与来源行", async () => {
  const assets = [
    pngAsset("asset-0001", "figure-flow.png", 1200, 400, "流程图"),
    pngAsset("asset-0002", "tall-poster.png", 600, 1800, "竖版图"),
    pngAsset("asset-0003", "icon-dot.png", 96, 96, "小图"),
    missingAsset("asset-0004", "https://example.com/x.png", "远程图"),
  ];
  const blocks = [
    paragraph({ kind: "image", assetId: "asset-0001", alt: "流程图" }),
    paragraph({ kind: "image", assetId: "asset-0002", alt: "竖版图" }),
    paragraph({ kind: "image", assetId: "asset-0003", alt: "小图" }),
    paragraph({ kind: "image", assetId: "asset-0004", alt: "远程图" }),
  ];
  const { documentXml, parts } = await render("images", astDocument(blocks, { assets }));
  const media = [...parts.keys()].filter((name) => name.startsWith("word/media/")).sort();
  assert.deepEqual(media, ["word/media/image1.png", "word/media/image2.png", "word/media/image3.png"]);
  const extents = [...documentXml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
    .map((hit) => ({ cx: Number(hit[1]), cy: Number(hit[2]) }));
  assert.equal(extents.length, 3);
  assert.ok(extents[0].cx <= 6120000, "宽图不超版心宽 17cm");
  assert.ok(Math.abs(extents[0].cx / extents[0].cy - 3) < 0.06, "宽图 3:1 比例保持");
  assert.ok(extents[1].cy <= 8640000, "高图不超可用页高");
  assert.ok(Math.abs(extents[1].cy / extents[1].cx - 3) < 0.06, "高图 1:3 比例保持");
  assert.equal(extents[2].cx, 914400, "96px@96dpi = 1 英寸，不放大");
  assert.match(documentXml, /<w:t xml:space="preserve">\[图片：远程图\]<\/w:t>/, "缺图占位含 alt");
  assert.match(documentXml, /w:pStyle w:val="FooterText"/, "来源行复用 9pt 灰色样式");
  assert.match(documentXml, /https:\/\/example\.com\/x\.png/, "来源行含原始地址");
  assert.equal(count(documentXml, /<a:blip r:embed="rId\d+"\/>/g), 3, "三张图各一个图片关系");
});
