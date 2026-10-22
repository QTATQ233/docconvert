#!/usr/bin/env node
/**
 * 模板生成器（开发期工具，不进运行时依赖图；architecture 4.6）。
 *
 * 唯一职责：把 config/default.yml 的 token 落成 templates/reference.docx。
 * 模板是版式的唯一来源——渲染器只写 w:pStyle 引用，一个数值都不持有；
 * 因此 architecture 4.2 的冻结 token（T01-T35）全部集中在本文件的 TOKEN 表里。
 *
 * 样式清单：architecture 4.3 的 15 个冻结样式 + 6 个辅助样式
 * （Hyperlink / HrLine / CoverRule / TocTitle / TableDoc / TableGap），
 * 辅助样式的作用是把「链接颜色、分隔线、封面装饰线、目录标题、表格边框与单元格边距、
 * 表后空段」这些版式值也关进模板，避免渲染器硬编码。
 *
 * 用法：
 *   node tools/build-template.js                 # 生成 templates/reference.docx
 *   node tools/build-template.js --out <path>    # 生成到指定路径（测试用）
 *
 * 可复现：ZIP 写入器固定时间戳/顺序/压缩参数，同一 config 两次生成字节一致。
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { zipWrite } from "../src/docx/zip.js";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = join(PACKAGE_ROOT, "templates", "reference.docx");

/**
 * 冻结 token（architecture 4.2；单位 twips / half-points）。
 * 这些数值不得出现在 src/docx/**，只能出现在模板里。
 */
const TOKEN = Object.freeze({
  pageA4: Object.freeze({ w: 11906, h: 16838 }),                                   // T01
  headingSpacing: Object.freeze({                                                    // T12-T15
    1: Object.freeze({ before: 360, after: 160, pageBreak: true }),
    2: Object.freeze({ before: 280, after: 120 }),
    3: Object.freeze({ before: 240, after: 80 }),
    4: Object.freeze({ before: 200, after: 80 }),
    5: Object.freeze({ before: 200, after: 80 }),
    6: Object.freeze({ before: 200, after: 80 }),
  }),
  headingLineSpacing: 240,        // 标题单倍行距
  tableBorderSize: 4,             // 表格细边框 0.5pt
  tableAfterGapTwips: 200,        // T21 表后空段前距（10pt，与 config 一致）
  codeIndentTwips: 142,           // T22 代码块左缩进 0.25cm
  codeLineSpacing: 240,           // T22 代码块单倍行距
  quoteIndentTwips: 284,          // T25 引用左缩进 0.5cm
  quoteBorderSize: 24,            // T25 引用左框线 3pt
  quoteBorderSpace: 8,
  tocIndentTwips: Object.freeze({ 1: 0, 2: 340, 3: 680 }),                          // T27
  coverRuleWidthTwips: 4535,      // T29 装饰线宽 8cm
  coverRuleBorderSize: 6,         // T29 装饰线 0.75pt
  hrBorderSize: 6,                // REQ-ELEM-21 分隔线 0.75pt
  hrSpaceTwips: 120,              // REQ-ELEM-21 前后各 6pt
  listIndentTwips: 419,           // T30 列表每级 0.74cm
  headerDistanceTwips: 851,
  footerDistanceTwips: 992,
  docGridLinePitch: 312,
  defaultTabStop: 420,
});

/** 1 cm = 567 twips。 */
const cmToTwips = (value) => Math.round(value * 567);
/** 1 pt = 2 half-points。 */
const ptToHalf = (value) => Math.round(value * 2);
/** 1 pt = 20 twips。 */
const ptToTwips = (value) => Math.round(value * 20);
/** 颜色值规范化（去掉 #，大写）。 */
const color = (value) => String(value).replace(/^#/, "").toUpperCase();

/**
 * 读取 config 并派生模板需要的几何量。
 * @returns {Promise<Record<string, any>>}
 */
async function readTokens() {
  const { config, flat } = await loadConfig({ packageRoot: PACKAGE_ROOT });
  /** @param {string} key */
  const need = (key) => {
    if (!flat.has(key)) throw new Error("config/default.yml 缺少键：" + key);
    return flat.get(key);
  };
  const size = String(need("page.size")).toUpperCase();
  if (size !== "A4") throw new Error("page.size 只支持 A4（T01），当前：" + size);

  const pageWidth = TOKEN.pageA4.w;
  const pageHeight = TOKEN.pageA4.h;
  const marginTop = cmToTwips(need("page.margins.top"));
  const marginBottom = cmToTwips(need("page.margins.bottom"));
  const marginLeft = cmToTwips(need("page.margins.left"));
  const marginRight = cmToTwips(need("page.margins.right"));
  const textWidth = pageWidth - marginLeft - marginRight;
  const textHeight = pageHeight - marginTop - marginBottom;
  const bodySizePt = Number(need("sizes.body"));
  const indentChars = Number(need("layout.bodyFirstLineIndentChars"));

  return {
    config,
    flat,
    pageWidth,
    pageHeight,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    textWidth,
    textHeight,
    coverTitleBefore: Math.round(textHeight / 3),
    bodySizeHalf: ptToHalf(bodySizePt),
    bodyLineSpacingTwips: Math.round(Number(need("layout.bodyLineSpacing")) * 240),
    bodyAfterTwips: 120,
    bodyFirstLineChars: Math.round(indentChars * 100),
    bodyFirstLineTwips: Math.round(indentChars * bodySizePt * 20),
    h1PageBreak: need("layout.h1PageBreak") === true,
    fontLatin: String(need("fonts.latin")),
    fontCjk: String(need("fonts.cjk")),
    fontMono: String(need("fonts.mono")),
    cjkFallback: need("fonts.cjkFallback"),
    latinFallback: need("fonts.latinFallback"),
    monoFallback: need("fonts.monoFallback"),
    sizeBody: ptToHalf(need("sizes.body")),
    sizeH1: ptToHalf(need("sizes.h1")),
    sizeH2: ptToHalf(need("sizes.h2")),
    sizeH3: ptToHalf(need("sizes.h3")),
    sizeH4: ptToHalf(need("sizes.h4")),
    sizeH5: ptToHalf(need("sizes.h5")),
    sizeH6: ptToHalf(need("sizes.h6")),
    sizeTable: ptToHalf(need("sizes.table")),
    sizeCode: ptToHalf(need("sizes.code")),
    sizeFooter: ptToHalf(need("sizes.footer")),
    sizeToc: ptToHalf(need("sizes.toc")),
    sizeCoverTitle: ptToHalf(need("sizes.coverTitle")),
    colorTableHeader: color(need("colors.tableHeaderFill")),
    colorCodeFill: color(need("colors.codeFill")),
    colorLink: color(need("colors.link")),
    colorFooter: color(need("colors.footerText")),
    tableWidth: textWidth,
    cellPadding: need("table.cellPaddingTwips"),
    tableAfterSpacePt: Number(need("table.afterSpacePt")),
  };
}

/**
 * 入口。
 * @param {string[]} argv
 */
async function main(argv) {
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 && argv[outIndex + 1] ? resolve(argv[outIndex + 1]) : DEFAULT_OUT;

  const t = await readTokens();
  const parts = collectParts(t);
  const buffer = zipWrite(parts);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex").toUpperCase();
  const stylesXml = buildStylesXml(t);
  console.log(JSON.stringify({
    ok: true,
    out: outPath,
    bytes: buffer.length,
    sha256,
    templateVersion: sha256.slice(0, 12).toLowerCase(),
    parts: parts.map((part) => part.name),
    styles: (stylesXml.match(/<w:style\b/g) || []).length,
    geometry: {
      pageTwips: [t.pageWidth, t.pageHeight],
      marginsTwips: [t.marginTop, t.marginBottom, t.marginLeft, t.marginRight],
      textWidthTwips: t.textWidth,
      textHeightTwips: t.textHeight,
    },
    fonts: { latin: t.fontLatin, cjk: t.fontCjk, mono: t.fontMono },
  }));
}

/**
 * 进程内生成模板（测试与 CI 复用；不写盘）。
 * @param {string[]} argv
 * @returns {Promise<{ buffer: Buffer, parts: Array<{name: string, data: string}>, tokens: Record<string, any>, sha256: string }>}
 */
export async function buildTemplate(argv = []) {
  void argv;
  const tokens = await readTokens();
  const parts = collectParts(tokens);
  const buffer = zipWrite(parts);
  const sha256 = createHash("sha256").update(buffer).digest("hex").toUpperCase();
  return { buffer, parts, tokens, sha256 };
}

/**
 * @param {Record<string, any>} t
 * @returns {Array<{ name: string, data: string }>}
 */
function collectParts(t) {
  return [
    { name: "[Content_Types].xml", data: buildContentTypes() },
    { name: "_rels/.rels", data: buildRootRels() },
    { name: "docProps/core.xml", data: buildCoreXml() },
    { name: "docProps/app.xml", data: buildAppXml() },
    { name: "word/document.xml", data: buildDocumentXml(t) },
    { name: "word/styles.xml", data: buildStylesXml(t) },
    { name: "word/settings.xml", data: buildSettingsXml() },
    { name: "word/fontTable.xml", data: buildFontTableXml(t) },
    { name: "word/numbering.xml", data: buildNumberingXml(t) },
    { name: "word/footer1.xml", data: buildFooterXml() },
    { name: "word/_rels/document.xml.rels", data: buildDocumentRels() },
  ];
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    console.error("ERROR build-template: " + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });
}

/* ------------------------------------------------------------------ 部件生成 */

/**
 * @param {Record<string, any>} t
 * @returns {string}
 */
function latinFonts(t) {
  return '<w:rFonts w:ascii="' + t.fontLatin + '" w:hAnsi="' + t.fontLatin + '" w:eastAsia="'
    + t.fontCjk + '" w:cs="' + t.fontLatin + '"/>';
}

/**
 * @param {Record<string, any>} t
 * @returns {string}
 */
function monoFonts(t) {
  return '<w:rFonts w:ascii="' + t.fontMono + '" w:hAnsi="' + t.fontMono + '" w:eastAsia="'
    + t.fontMono + '" w:cs="' + t.fontMono + '"/>';
}

/**
 * @param {{ id: string, name: string, basedOn?: string|null, next?: string|null, pPr?: string, rPr?: string }} spec
 * @returns {string}
 */
function paragraphStyle(spec) {
  const basedOn = spec.basedOn === undefined ? "Normal" : spec.basedOn;
  const next = spec.next === undefined ? "Normal" : spec.next;
  return '<w:style w:type="paragraph" w:styleId="' + spec.id + '"><w:name w:val="' + spec.name + '"/>'
    + (basedOn ? '<w:basedOn w:val="' + basedOn + '"/>' : "")
    + (next ? '<w:next w:val="' + next + '"/>' : "")
    + "<w:qFormat/>"
    + (spec.pPr ? "<w:pPr>" + spec.pPr + "</w:pPr>" : "")
    + (spec.rPr ? "<w:rPr>" + spec.rPr + "</w:rPr>" : "")
    + "</w:style>";
}

/**
 * @param {{ id: string, name: string, basedOn?: string, pPr?: string, rPr?: string }} spec
 * @returns {string}
 */
function characterStyle(spec) {
  return '<w:style w:type="character" w:styleId="' + spec.id + '"><w:name w:val="' + spec.name + '"/>'
    + (spec.basedOn ? '<w:basedOn w:val="' + spec.basedOn + '"/>' : "")
    + "<w:qFormat/>" + (spec.pPr ? "<w:pPr>" + spec.pPr + "</w:pPr>" : "")
    + (spec.rPr ? "<w:rPr>" + spec.rPr + "</w:rPr>" : "") + "</w:style>";
}

/**
 * word/styles.xml：architecture 4.3 的 15 个冻结样式 + 6 个辅助样式。
 * @param {Record<string, any>} t
 * @returns {string}
 */
function buildStylesXml(t) {
  const baseRPr = latinFonts(t) + '<w:sz w:val="' + t.bodySizeHalf + '"/><w:szCs w:val="' + t.bodySizeHalf + '"/>';
  const styles = [];

  // Normal：T08/T09/T10/T11
  styles.push(paragraphStyle({
    id: "Normal",
    name: "Normal",
    basedOn: null,
    pPr: '<w:widowControl/><w:spacing w:before="0" w:after="' + t.bodyAfterTwips + '" w:line="'
      + t.bodyLineSpacingTwips + '" w:lineRule="auto"/><w:ind w:firstLineChars="' + t.bodyFirstLineChars
      + '" w:firstLine="' + t.bodyFirstLineTwips + '"/><w:jc w:val="left"/>',
    rPr: baseRPr,
  }));

  // Heading1-6：T12-T16（加粗、左对齐、无缩进、单倍行距、keepNext、outlineLvl）
  const headingSizes = { 1: t.sizeH1, 2: t.sizeH2, 3: t.sizeH3, 4: t.sizeH4, 5: t.sizeH5, 6: t.sizeH6 };
  for (let level = 1; level <= 6; level += 1) {
    const spacing = TOKEN.headingSpacing[level];
    const pageBreak = level === 1 && t.h1PageBreak ? "<w:pageBreakBefore/>" : "";
    styles.push(paragraphStyle({
      id: "Heading" + level,
      name: "heading " + level,
      pPr: "<w:keepNext/><w:keepLines/>" + pageBreak
        + '<w:spacing w:before="' + spacing.before + '" w:after="' + spacing.after + '" w:line="'
        + TOKEN.headingLineSpacing + '" w:lineRule="auto"/>'
        + '<w:ind w:firstLine="0" w:firstLineChars="0"/><w:jc w:val="left"/>'
        + '<w:outlineLvl w:val="' + (level - 1) + '"/>',
      rPr: latinFonts(t) + "<w:b/><w:bCs/>" + (level === 6 ? "<w:i/>" : "")
        + '<w:sz w:val="' + headingSizes[level] + '"/><w:szCs w:val="' + headingSizes[level] + '"/>',
    }));
  }

  // DocTitle（T28）：封面标题，居中加粗；垂直位置约页面上三分之一（REQ-LAY-014）
  styles.push(paragraphStyle({
    id: "DocTitle",
    name: "docconvert cover title",
    pPr: '<w:spacing w:before="' + t.coverTitleBefore + '" w:after="240" w:line="240" w:lineRule="auto"/>'
      + '<w:ind w:firstLine="0" w:firstLineChars="0"/><w:jc w:val="center"/>',
    rPr: latinFonts(t) + "<w:b/><w:bCs/>" + '<w:sz w:val="' + t.sizeCoverTitle + '"/><w:szCs w:val="'
      + t.sizeCoverTitle + '"/>',
  }));

  // TocTitle（REQ-LAY-015）：目录页首「目录」二字，18pt 加粗居中，无 outlineLvl（不进目录/书签）
  styles.push(paragraphStyle({
    id: "TocTitle",
    name: "docconvert toc title",
    pPr: '<w:keepNext/><w:spacing w:before="0" w:after="360" w:line="240" w:lineRule="auto"/>'
      + '<w:ind w:firstLine="0" w:firstLineChars="0"/><w:jc w:val="center"/>',
    rPr: latinFonts(t) + "<w:b/><w:bCs/>" + '<w:sz w:val="36"/><w:szCs w:val="36"/>',
  }));

  // CoverRule（T29）：宽 8cm 居中的 0.75pt 装饰线
  const ruleSide = Math.floor((t.textWidth - TOKEN.coverRuleWidthTwips) / 2);
  styles.push(paragraphStyle({
    id: "CoverRule",
    name: "docconvert cover rule",
    pPr: '<w:pBdr><w:bottom w:val="single" w:sz="' + TOKEN.coverRuleBorderSize + '" w:space="1" w:color="auto"/></w:pBdr>'
      + '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
      + '<w:ind w:left="' + ruleSide + '" w:right="' + (t.textWidth - TOKEN.coverRuleWidthTwips - ruleSide)
      + '" w:firstLine="0" w:firstLineChars="0"/>',
    rPr: latinFonts(t),
  }));

  // HrLine（REQ-ELEM-21）：与文本同宽的水平细线，前后各 6pt
  styles.push(paragraphStyle({
    id: "HrLine",
    name: "docconvert horizontal rule",
    pPr: '<w:pBdr><w:bottom w:val="single" w:sz="' + TOKEN.hrBorderSize + '" w:space="1" w:color="auto"/></w:pBdr>'
      + '<w:spacing w:before="' + TOKEN.hrSpaceTwips + '" w:after="' + TOKEN.hrSpaceTwips
      + '" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0" w:firstLineChars="0"/>',
    rPr: latinFonts(t),
  }));

  // TOC1-3（T27）：点线引导 + 右对齐页码，H1 条目加粗，H2/H3 逐级缩进
  for (let level = 1; level <= 3; level += 1) {
    styles.push(paragraphStyle({
      id: "TOC" + level,
      name: "toc " + level,
      pPr: '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="' + t.textWidth + '"/></w:tabs>'
        + '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
        + '<w:ind w:left="' + TOKEN.tocIndentTwips[level] + '" w:firstLine="0" w:firstLineChars="0"/>',
      rPr: latinFonts(t) + (level === 1 ? "<w:b/>" : "") + '<w:sz w:val="' + t.sizeToc + '"/><w:szCs w:val="'
        + t.sizeToc + '"/>',
    }));
  }

  // CodeBlock（T22/T23）：等宽、浅底连续底纹、左缩进、允许字符级断行（长行不裁切）
  styles.push(paragraphStyle({
    id: "CodeBlock",
    name: "docconvert code block",
    pPr: '<w:shd w:val="clear" w:color="auto" w:fill="' + t.colorCodeFill + '"/>'
      + '<w:wordWrap w:val="true"/>'
      + '<w:spacing w:before="120" w:after="120" w:line="' + TOKEN.codeLineSpacing + '" w:lineRule="auto"/>'
      + '<w:ind w:left="' + TOKEN.codeIndentTwips + '" w:firstLine="0" w:firstLineChars="0"/>',
    rPr: monoFonts(t) + '<w:sz w:val="' + t.sizeCode + '"/><w:szCs w:val="' + t.sizeCode + '"/>',
  }));

  // TableText（T17）：单元格文字，单倍行距、段前后 0
  styles.push(paragraphStyle({
    id: "TableText",
    name: "docconvert table text",
    pPr: '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
      + '<w:ind w:firstLine="0" w:firstLineChars="0"/>',
    rPr: latinFonts(t) + '<w:sz w:val="' + t.sizeTable + '"/><w:szCs w:val="' + t.sizeTable + '"/>',
  }));

  // Quote（T25）：左竖线 3pt + 左缩进 0.5cm + 段前后 6pt
  styles.push(paragraphStyle({
    id: "Quote",
    name: "docconvert quote",
    pPr: '<w:pBdr><w:left w:val="single" w:sz="' + TOKEN.quoteBorderSize + '" w:space="'
      + TOKEN.quoteBorderSpace + '" w:color="auto"/></w:pBdr>'
      + '<w:spacing w:before="120" w:after="120" w:line="' + t.bodyLineSpacingTwips + '" w:lineRule="auto"/>'
      + '<w:ind w:left="' + TOKEN.quoteIndentTwips + '" w:firstLine="0" w:firstLineChars="0"/>',
    rPr: latinFonts(t) + '<w:sz w:val="' + t.bodySizeHalf + '"/><w:szCs w:val="' + t.bodySizeHalf + '"/>',
  }));

  // FooterText（T26）：9pt #808080 居中，PAGE 域用
  styles.push(paragraphStyle({
    id: "FooterText",
    name: "docconvert footer",
    pPr: '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
      + '<w:ind w:firstLine="0" w:firstLineChars="0"/><w:jc w:val="center"/>',
    rPr: latinFonts(t) + '<w:color w:val="' + t.colorFooter + '"/><w:sz w:val="' + t.sizeFooter
      + '"/><w:szCs w:val="' + t.sizeFooter + '"/>',
  }));

  // TableGap（T21）：表格后空段 10pt
  styles.push(paragraphStyle({
    id: "TableGap",
    name: "docconvert table gap",
    pPr: '<w:spacing w:before="' + TOKEN.tableAfterGapTwips + '" w:after="0" w:line="240" w:lineRule="auto"/>'
      + '<w:ind w:firstLine="0" w:firstLineChars="0"/>',
    rPr: latinFonts(t) + '<w:sz w:val="' + t.bodySizeHalf + '"/>',
  }));

  // CharacterInlineCode（T24）：行内代码 10.5pt 等宽、无底纹
  styles.push(characterStyle({
    id: "CharacterInlineCode",
    name: "docconvert inline code",
    rPr: monoFonts(t) + '<w:sz w:val="21"/><w:szCs w:val="21"/>',
  }));

  // Hyperlink（辅助）：链接颜色 + 下划线（REQ-ELEM-15 的视觉可辨识）
  styles.push(characterStyle({
    id: "Hyperlink",
    name: "docconvert hyperlink",
    rPr: '<w:color w:val="' + t.colorLink + '"/><w:u w:val="single"/>',
  }));

  // TableNormal（默认表格样式）+ TableDoc（T18/T19/T20：细边框、单元格边距、表头底纹加粗）
  const cellPadding = Array.isArray(t.cellPadding) ? t.cellPadding : [30, 60, 30, 60];
  const paddingXml = '<w:tblCellMar><w:top w:w="' + cellPadding[0] + '" w:type="dxa"/><w:left w:w="'
    + cellPadding[1] + '" w:type="dxa"/><w:bottom w:w="' + cellPadding[2] + '" w:type="dxa"/><w:right w:w="'
    + cellPadding[3] + '" w:type="dxa"/></w:tblCellMar>';
  const border = (side) => '<w:' + side + ' w:val="single" w:sz="' + TOKEN.tableBorderSize
    + '" w:space="0" w:color="auto"/>';
  styles.push('<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>'
    + '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/>' + paddingXml + "</w:tblPr></w:style>");
  styles.push('<w:style w:type="table" w:styleId="TableDoc"><w:name w:val="docconvert table"/>'
    + '<w:basedOn w:val="TableNormal"/>'
    + "<w:tblPr><w:tblBorders>"
    + border("top") + border("left") + border("bottom") + border("right") + border("insideH") + border("insideV")
    + "</w:tblBorders>" + paddingXml + "</w:tblPr>"
    + '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'
    + t.colorTableHeader + '"/></w:tcPr></w:tblStylePr>'
    + "</w:style>");

  const docDefaults = "<w:docDefaults><w:rPrDefault><w:rPr>" + latinFonts(t)
    + '<w:sz w:val="' + t.bodySizeHalf + '"/><w:szCs w:val="' + t.bodySizeHalf + '"/>'
    + '<w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:widowControl/><w:kinsoku w:val="true"/><w:overflowPunct w:val="true"/>'
    + '<w:autoSpaceDE w:val="true"/><w:autoSpaceDN w:val="true"/><w:adjustRightInd w:val="true"/>'
    + '<w:spacing w:after="' + t.bodyAfterTwips + '" w:line="' + t.bodyLineSpacingTwips + '" w:lineRule="auto"/>'
    + "</w:pPr></w:pPrDefault></w:docDefaults>";

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + docDefaults + styles.join("") + "</w:styles>";
}

/**
 * word/numbering.xml：bullet（abstractNum 0 / numId 1）+ decimal（abstractNum 1 / numId 2）。
 * @param {Record<string, any>} t
 * @returns {string}
 */
function buildNumberingXml(t) {
  const indent = TOKEN.listIndentTwips;
  const bullet = (level, text) => '<w:lvl w:ilvl="' + level + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/>'
    + '<w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/>'
    + '<w:pPr><w:ind w:left="' + indent * (level + 1) + '" w:hanging="' + indent + '"/></w:pPr>'
    + "<w:rPr>" + latinFonts(t) + "</w:rPr></w:lvl>";
  const ordered = (level, format, text, restart) => '<w:lvl w:ilvl="' + level + '"><w:start w:val="1"/>'
    + '<w:numFmt w:val="' + format + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/>'
    + '<w:pPr><w:ind w:left="' + indent * (level + 1) + '" w:hanging="' + indent + '"/></w:pPr>'
    + (restart ? "" : "") + "</w:lvl>";

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
    + bullet(0, "\u2022") + bullet(1, "\u25e6") + bullet(2, "\u25aa")
    + "</w:abstractNum>"
    + '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>'
    + ordered(0, "decimal", "%1.") + ordered(1, "lowerLetter", "%2)") + ordered(2, "lowerRoman", "%3.")
    + "</w:abstractNum>"
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'
    + "</w:numbering>";
}

/**
 * word/settings.xml（8.2）：无 w:updateFields、无 w:rsids。
 * @returns {string}
 */
function buildSettingsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:zoom w:percent="100"/>'
    + '<w:defaultTabStop w:val="' + TOKEN.defaultTabStop + '"/>'
    + '<w:characterSpacingControl w:val="compressPunctuation"/>'
    + '<w:compat><w:compatSetting w:name="compatibilityMode"'
    + ' w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
    + "</w:settings>";
}

/**
 * word/fontTable.xml：首选字体（回退链由预检探测，写进产物的只有首选名）。
 * @param {Record<string, any>} t
 * @returns {string}
 */
function buildFontTableXml(t) {
  const families = [
    [t.fontLatin, "swiss", "variable"],
    [t.fontCjk, "auto", "variable"],
    [t.fontMono, "modern", "fixed"],
  ];
  const names = new Set(families.map((item) => item[0]));
  const fallbacks = [...(t.latinFallback ?? []), ...(t.cjkFallback ?? []), ...(t.monoFallback ?? [])];
  const rows = families.map(([name, family, pitch]) => '<w:font w:name="' + name + '"><w:charset w:val="86"/>'
    + '<w:family w:val="' + family + '"/><w:pitch w:val="' + pitch + '"/></w:font>');
  for (const name of fallbacks) {
    if (typeof name !== "string" || names.has(name)) continue;
    names.add(name);
    rows.push('<w:font w:name="' + name + '"><w:charset w:val="86"/><w:family w:val="auto"/>'
      + '<w:pitch w:val="variable"/></w:font>');
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + rows.join("") + "</w:fonts>";
}

/**
 * word/footer1.xml（T26）：居中 PAGE 域；封面页由 sectPr 的 titlePg 抑制。
 * @returns {string}
 */
function buildFooterXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + "<w:p>" + '<w:pPr><w:pStyle w:val="FooterText"/></w:pPr>'
    + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + "<w:r><w:t>1</w:t></w:r>"
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    + "</w:p></w:ftr>";
}

/**
 * word/document.xml（REQ-TPL-002）：正文**没有任何文本节点**，只有页面设置。
 * @param {Record<string, any>} t
 * @returns {string}
 */
function buildDocumentXml(t) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>'
    + "<w:sectPr>"
    + '<w:footerReference w:type="default" r:id="rId3"/>'
    + '<w:pgSz w:w="' + t.pageWidth + '" w:h="' + t.pageHeight + '"/>'
    + '<w:pgMar w:top="' + t.marginTop + '" w:right="' + t.marginRight + '" w:bottom="' + t.marginBottom
    + '" w:left="' + t.marginLeft + '" w:header="' + TOKEN.headerDistanceTwips + '" w:footer="'
    + TOKEN.footerDistanceTwips + '" w:gutter="0"/>'
    + '<w:cols w:space="425"/>'
    + "<w:titlePg/>"
    + '<w:docGrid w:linePitch="' + TOKEN.docGridLinePitch + '"/>'
    + "</w:sectPr></w:body></w:document>";
}

/**
 * [Content_Types].xml：包含 png/jpeg 默认类型，渲染器内嵌图片时无需改写该部件。
 * @returns {string}
 */
function buildContentTypes() {
  const part = (name, type) => '<Override PartName="' + name + '" ContentType="' + type + '"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
    + '<Default Extension="jpg" ContentType="image/jpeg"/>'
    + part("/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")
    + part("/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml")
    + part("/word/settings.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml")
    + part("/word/fontTable.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml")
    + part("/word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml")
    + part("/word/footer1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml")
    + part("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml")
    + part("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml")
    + "</Types>";
}

/**
 * _rels/.rels。
 * @returns {string}
 */
function buildRootRels() {
  const rel = (id, type, target) => '<Relationship Id="' + id + '" Type="' + type + '" Target="' + target + '"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rel("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "word/document.xml")
    + rel("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")
    + rel("rId3", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", "docProps/app.xml")
    + "</Relationships>";
}

/**
 * word/_rels/document.xml.rels。
 * @returns {string}
 */
function buildDocumentRels() {
  const base = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  const rel = (id, type, target) => '<Relationship Id="' + id + '" Type="' + base + type + '" Target="' + target + '"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rel("rId1", "styles", "styles.xml")
    + rel("rId2", "settings", "settings.xml")
    + rel("rId3", "footer", "footer1.xml")
    + rel("rId4", "fontTable", "fontTable.xml")
    + rel("rId5", "numbering", "numbering.xml")
    + "</Relationships>";
}

/**
 * docProps/core.xml（8.2）：固定日期、creator=docconvert。
 * @returns {string}
 */
function buildCoreXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + "<dc:creator>docconvert</dc:creator><cp:revision>1</cp:revision>"
    + '<dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created>'
    + '<dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified>'
    + "</cp:coreProperties>";
}

/**
 * docProps/app.xml（8.2）：Application=docconvert，无 Company。
 * @returns {string}
 */
function buildAppXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n"
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
    + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + "<Application>docconvert</Application><AppVersion>0.1.0</AppVersion></Properties>";
}
