/**
 * AST -> OOXML 片段（architecture 3.1 / 3.5 / 4）。
 *
 * 纪律：本文件不出现任何字号、颜色、边距、缩进数值。所有版式值来自模板样式
 * （w:pStyle 引用）；只写结构性直接属性：numPr、tblW/tblLayout、书签、域代码、
 * 图片 extent、单元格垂直对齐与列对齐。表格宽度与图片上限由模板 sectPr 推出的版心决定。
 *
 * @module docx/render
 */
import { TOC_DEPTH } from "../contracts/index.js";
import { escAttr, inlineText, pxToEmu, textXml } from "./xml.js";

/** 样式 ID（与 architecture 4.3 + 模板辅助样式一一对应）。 */
export const STYLE = Object.freeze({
  heading: (level) => "Heading" + level,
  title: "DocTitle",
  tocTitle: "TocTitle",
  toc: (level) => "TOC" + Math.min(Math.max(level, 1), 3),
  coverRule: "CoverRule",
  hr: "HrLine",
  code: "CodeBlock",
  table: "TableDoc",
  tableText: "TableText",
  tableGap: "TableGap",
  quote: "Quote",
  footer: "FooterText",
  inlineCode: "CharacterInlineCode",
  hyperlink: "Hyperlink",
});

const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const HYPERLINK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n";
const NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(" ");

/** 图片降级来源行的显示上限（requirements REQ-ELEM-19：超 80 字符截断）。 */
const SOURCE_DISPLAY_LIMIT = 80;

/**
 * 渲染上下文：自带计数器与 rel/编号累加器，保证同一次渲染内 ID 按文档顺序递增。
 * @param {{ template: object, assets: Map<string, object>, tocEntries: Array<object>, tocNumbers: Array<number>|null, tocPlaceholder?: string, longDoc: boolean, title: string }} input
 * @returns {Record<string, any>}
 */
export function createContext(input) {
  const relByKey = new Map();
  /** @type {Record<string, any>} */
  const ctx = {
    template: input.template,
    geometry: input.template.geometry,
    sectionXml: input.template.sectionXml,
    assets: input.assets,
    tocEntries: input.tocEntries,
    tocNumbers: input.tocNumbers,
    tocPlaceholder: typeof input.tocPlaceholder === "string" && input.tocPlaceholder !== "" ? input.tocPlaceholder : "00",
    longDoc: input.longDoc,
    title: input.title,
    bulletNumId: input.template.numbering.bulletNumId,
    counters: { bookmarkId: 0, docPrId: 0 },
    rels: [],
    numberingExtra: [],
    nextNumId: input.template.numbering.maxNumId + 1,
  };

  ctx.addRel = (target, kind) => {
    const key = kind + "|" + target;
    const cached = relByKey.get(key);
    if (cached) return cached;
    const id = "rId" + (ctx.template.maxRelId + ctx.rels.length + 1);
    ctx.rels.push({
      id,
      type: kind === "image" ? IMAGE_REL_TYPE : HYPERLINK_REL_TYPE,
      target,
      targetMode: kind === "image" ? null : "External",
    });
    relByKey.set(key, id);
    return id;
  };

  ctx.addOrderedList = (start) => {
    const numId = ctx.nextNumId;
    ctx.nextNumId += 1;
    const abstractId = ctx.template.numbering.decimalAbstractId;
    const override = start === 1
      ? ""
      : '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="' + start + '"/></w:lvlOverride>';
    ctx.numberingExtra.push(
      '<w:num w:numId="' + numId + '"><w:abstractNumId w:val="' + abstractId + '"/>' + override + "</w:num>",
    );
    return numId;
  };

  return ctx;
}

/**
 * 生成 word/document.xml。
 * @param {object} doc
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
export function buildDocumentXml(doc, ctx) {
  const body = [];
  if (ctx.longDoc) {
    body.push(renderCover(ctx));
    body.push(renderToc(ctx));
  }
  for (const block of doc.blocks ?? []) body.push(renderBlock(block, ctx, {}));
  body.push(ctx.sectionXml);
  return XML_DECL + "<w:document " + NAMESPACES + "><w:body>" + body.join("") + "</w:body></w:document>";
}

/**
 * 生成 word/_rels/document.xml.rels（模板关系 + 本文追加的图片/外链）。
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
export function buildDocumentRels(ctx) {
  const rows = [];
  const all = [...ctx.template.rels, ...ctx.rels];
  for (const rel of all) {
    rows.push(
      '<Relationship Id="' + escAttr(rel.id) + '" Type="' + escAttr(rel.type) + '" Target="'
      + escAttr(rel.target) + '"' + (rel.targetMode ? ' TargetMode="' + escAttr(rel.targetMode) + '"' : "") + "/>",
    );
  }
  return XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rows.join("") + "</Relationships>";
}

/**
 * 把本次渲染产生的有序列表定义追加到模板 numbering.xml（只追加 w:num，不动抽象编号）。
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
export function buildNumberingXml(ctx) {
  const base = ctx.template.numbering.xml;
  if (ctx.numberingExtra.length === 0) return base;
  return base.replace("</w:numbering>", ctx.numberingExtra.join("") + "</w:numbering>");
}

/* ------------------------------------------------------------------ 结构块 */

/**
 * @param {object} block
 * @param {Record<string, any>} ctx
 * @param {{ ilvl?: number, numId?: number, quote?: boolean }} env
 * @returns {string}
 */
function renderBlock(block, ctx, env) {
  const kind = block && block.kind;
  if (kind === "heading") return renderHeading(block, ctx);
  if (kind === "paragraph") return renderParagraph(block, ctx, env);
  if (kind === "list") return renderList(block, ctx, env);
  if (kind === "blockquote") return renderBlockquote(block, ctx, env);
  if (kind === "code") return renderCode(block);
  if (kind === "table") return renderTable(block, ctx);
  if (kind === "hr") return "<w:p>" + pPr([pStyle(STYLE.hr)]) + "</w:p>";
  return renderParagraph({ children: (block && block.children) || [] }, ctx, env);
}

/**
 * 标题：只写 pStyle（大纲级别在模板样式的 w:outlineLvl 上）+ 书签锚点。
 * @param {object} block
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
function renderHeading(block, ctx) {
  const level = Math.min(Math.max(Number(block.level) || 1, 1), 6);
  const bookmark = typeof block.bookmark === "string" ? block.bookmark : "";
  let start = "";
  let end = "";
  if (bookmark !== "") {
    ctx.counters.bookmarkId += 1;
    const id = ctx.counters.bookmarkId;
    start = '<w:bookmarkStart w:id="' + id + '" w:name="' + escAttr(bookmark) + '"/>';
    end = '<w:bookmarkEnd w:id="' + id + '"/>';
  }
  return "<w:p>" + pPr([pStyle(STYLE.heading(level))]) + start
    + renderInlines(block.children, ctx, {}) + end + "</w:p>";
}

/**
 * 段落：图片独占段走居中 + 降级占位分支；列表项带 numPr。
 * @param {object} block
 * @param {Record<string, any>} ctx
 * @param {{ ilvl?: number, numId?: number, quote?: boolean }} env
 * @returns {string}
 */
function renderParagraph(block, ctx, env) {
  const children = block.children ?? [];
  const images = children.filter((child) => child && child.kind === "image");
  const hasVisibleText = children.some(
    (child) => child && child.kind !== "image" && !(child.kind === "text" && String(child.text ?? "") === ""),
  );
  if (images.length > 0 && !hasVisibleText && !env.numId && !env.quote) {
    // REQ-ELEM-18：图片独占一段、居中；REQ-ELEM-19：缺图出占位 + 来源行。
    return images.map((image) => renderImageParagraph(image, ctx)).join("");
  }
  const styleId = env.quote ? STYLE.quote : null;
  return "<w:p>" + paragraphProperties(styleId, env) + renderInlines(children, ctx, {}) + "</w:p>";
}

/**
 * 列表：每级缩进由模板 numbering 定义；有序列表按 start 追加 w:num（只含 startOverride）。
 * @param {object} block
 * @param {Record<string, any>} ctx
 * @param {{ ilvl?: number, numId?: number, quote?: boolean }} env
 * @returns {string}
 */
function renderList(block, ctx, env) {
  const level = Math.min(Math.max(Number(env.ilvl) || 0, 0), 2);
  const start = Number(block.start);
  const numId = block.ordered
    ? ctx.addOrderedList(Number.isFinite(start) && start >= 1 ? Math.trunc(start) : 1)
    : ctx.bulletNumId;
  const parts = [];
  for (const item of block.items ?? []) {
    for (const child of item.children ?? []) {
      if (child && child.kind === "list") {
        parts.push(renderList(child, ctx, { ...env, ilvl: Math.min(level + 1, 2) }));
      } else {
        parts.push(renderBlock(child, ctx, { ...env, ilvl: level, numId }));
      }
    }
  }
  return parts.join("");
}

/**
 * 引用：段落套 Quote 样式（左竖线 + 左缩进）；引用内标题保持标题样式（REQ-MD-008）。
 * @param {object} block
 * @param {Record<string, any>} ctx
 * @param {{ ilvl?: number, numId?: number, quote?: boolean }} env
 * @returns {string}
 */
function renderBlockquote(block, ctx, env) {
  const parts = [];
  for (const child of block.children ?? []) {
    if (child && child.kind === "heading") {
      parts.push(renderHeading(child, ctx));
    } else {
      parts.push(renderBlock(child, ctx, { ...env, quote: true }));
    }
  }
  return parts.join("");
}

/**
 * 代码块：整段一个 CodeBlock 段落（连续底纹），行间 w:br、制表符 w:tab、
 * 保留行首空格；超长行由排版引擎按字符换行，不裁切（REQ-ELEM/TC-CD-01）。
 * @param {object} block
 * @returns {string}
 */
function renderCode(block) {
  const text = String(block.text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const runs = [];
  lines.forEach((line, index) => {
    if (index > 0) runs.push("<w:r><w:br/></w:r>");
    if (line === "") return;
    const segments = line.split("\t");
    segments.forEach((segment, segmentIndex) => {
      if (segmentIndex > 0) runs.push("<w:r><w:tab/></w:r>");
      if (segment !== "") runs.push('<w:r><w:t xml:space="preserve">' + textXml(segment) + "</w:t></w:r>");
    });
  });
  return "<w:p>" + pPr([pStyle(STYLE.code)]) + runs.join("") + "</w:p>";
}

/**
 * 表格：固定布局 + 版心宽度 + 表头跨页重复 + 行不跨页（T18/T19）。
 * @param {object} block
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
function renderTable(block, ctx) {
  const model = (block && block.model) || {};
  const header = Array.isArray(model.header) ? model.header : [];
  const rows = Array.isArray(model.rows) ? model.rows : [];
  const columns = Math.max(header.length, ...rows.map((row) => (Array.isArray(row) ? row.length : 0)), 1);
  const widths = columnWidths(ctx.geometry.textWidthTwips, columns);
  const align = Array.isArray(model.align) ? model.align : [];
  const grid = widths.map((width) => '<w:gridCol w:w="' + width + '"/>').join("");
  const tableProperties = "<w:tblPr>"
    + '<w:tblStyle w:val="' + STYLE.table + '"/>'
    + '<w:tblW w:w="' + ctx.geometry.textWidthTwips + '" w:type="dxa"/>'
    + '<w:jc w:val="center"/>'
    + '<w:tblLayout w:type="fixed"/>'
    + '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0"'
    + ' w:noHBand="0" w:noVBand="1"/>'
    + "</w:tblPr>";
  const parts = ["<w:tbl>" + tableProperties + "<w:tblGrid>" + grid + "</w:tblGrid>"];
  if (header.length > 0) parts.push(renderTableRow(header, widths, align, ctx, true));
  for (const row of rows) parts.push(renderTableRow(Array.isArray(row) ? row : [], widths, align, ctx, false));
  parts.push("</w:tbl>");
  parts.push("<w:p>" + pPr([pStyle(STYLE.tableGap)]) + "</w:p>");
  return parts.join("");
}

/**
 * @param {Array<Array<object>>} cells
 * @param {Array<number>} widths
 * @param {Array<string|null>} align
 * @param {Record<string, any>} ctx
 * @param {boolean} isHeader
 * @returns {string}
 */
function renderTableRow(cells, widths, align, ctx, isHeader) {
  const trPr = "<w:trPr><w:cantSplit/>" + (isHeader ? "<w:tblHeader/>" : "") + "</w:trPr>";
  const parts = ["<w:tr>" + trPr];
  for (let index = 0; index < widths.length; index += 1) {
    const cell = Array.isArray(cells[index]) ? cells[index] : [];
    const value = align[index];
    const justification = value === "center" || value === "right" || value === "left"
      ? '<w:jc w:val="' + value + '"/>'
      : "";
    parts.push(
      "<w:tc><w:tcPr>"
      + '<w:tcW w:w="' + widths[index] + '" w:type="dxa"/>'
      + '<w:vAlign w:val="center"/>'
      + "</w:tcPr><w:p>"
      + pPr([pStyle(STYLE.tableText), justification])
      + renderInlines(cell, ctx, {})
      + "</w:p></w:tc>",
    );
  }
  parts.push("</w:tr>");
  return parts.join("");
}

/**
 * 等分列宽，余数给前几列（确定性；总宽严格等于版心宽）。
 * @param {number} totalWidth
 * @param {number} columns
 * @returns {Array<number>}
 */
function columnWidths(totalWidth, columns) {
  const base = Math.floor(totalWidth / columns);
  const remainder = totalWidth - base * columns;
  const widths = [];
  for (let index = 0; index < columns; index += 1) widths.push(base + (index < remainder ? 1 : 0));
  return widths;
}

/* ------------------------------------------------------------------ 封面/目录 */

/**
 * 封面（仅长文）：DocTitle 标题 + CoverRule 装饰线 + 分页。
 * REQ-LAY-014：不含日期/作者/路径/页脚/附加文字。
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
function renderCover(ctx) {
  const title = ctx.title === undefined || ctx.title === null ? "" : String(ctx.title);
  return "<w:p>" + pPr([pStyle(STYLE.title)])
    + '<w:r><w:t xml:space="preserve">' + textXml(title) + "</w:t></w:r></w:p>"
    + "<w:p>" + pPr([pStyle(STYLE.coverRule)]) + "</w:p>"
    + pageBreak();
}

/**
 * 目录（仅长文）：目录标题 + TOC 域 + 完整缓存条目（点线引导 + 右对齐页码）+ 分页。
 * tocNumbers === null -> 页码列写占位串（默认 "00"；TOC 降级时由调用方传 "——"，见 §7.3.3 G2）；
 * 数组 -> 回填真实页码（第二遍）。
 * 不写 w:updateFields、域也不标 dirty（E2 裁决）。
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
function renderToc(ctx) {
  const parts = [];
  parts.push("<w:p>" + pPr([pStyle(STYLE.tocTitle)])
    + '<w:r><w:t xml:space="preserve">目录</w:t></w:r></w:p>');
  parts.push(
    "<w:p>" + pPr([pStyle(STYLE.toc(1))])
    + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-' + TOC_DEPTH + '" \\h \\z \\u </w:instrText></w:r>'
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + "</w:p>",
  );
  ctx.tocEntries.forEach((entry, index) => {
    const page = ctx.tocNumbers ? String(ctx.tocNumbers[index]) : ctx.tocPlaceholder;
    parts.push(
      "<w:p>" + pPr([pStyle(STYLE.toc(entry.level))])
      + '<w:hyperlink w:anchor="' + escAttr(entry.bookmark) + '" w:history="1">'
      + '<w:r><w:t xml:space="preserve">' + textXml(entry.text) + "</w:t></w:r>"
      + "<w:r><w:tab/></w:r>"
      + '<w:r><w:t xml:space="preserve">' + page + "</w:t></w:r>"
      + "</w:hyperlink></w:p>",
    );
  });
  parts.push("<w:p>" + pPr([pStyle(STYLE.toc(1))]) + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  parts.push(pageBreak());
  return parts.join("");
}

/**
 * @returns {string}
 */
function pageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

/* ------------------------------------------------------------------ 内联 */

/**
 * @param {Array<object>} inlines
 * @param {Record<string, any>} ctx
 * @param {{ bold?: boolean, italic?: boolean, strike?: boolean, style?: string }} flags
 * @returns {string}
 */
function renderInlines(inlines, ctx, flags) {
  const parts = [];
  for (const inline of inlines ?? []) {
    if (!inline) continue;
    switch (inline.kind) {
      case "text":
        parts.push(textRun(flags, inline.text));
        break;
      case "strong":
        parts.push(renderInlines(inline.children, ctx, { ...flags, bold: true }));
        break;
      case "em":
        parts.push(renderInlines(inline.children, ctx, { ...flags, italic: true }));
        break;
      case "del":
        parts.push(renderInlines(inline.children, ctx, { ...flags, strike: true }));
        break;
      case "code":
        parts.push(textRun({ ...flags, style: STYLE.inlineCode }, inline.text));
        break;
      case "link":
        parts.push(renderLink(inline, ctx, flags));
        break;
      case "image":
        parts.push(renderImageInline(inline, ctx));
        break;
      case "br":
        parts.push("<w:r><w:br/></w:r>");
        break;
      default:
        if (typeof inline.text === "string") parts.push(textRun(flags, inline.text));
        break;
    }
  }
  return parts.join("");
}

/**
 * REQ-ELEM-15：http/https/mailto 建外链（模板 Hyperlink 字符样式）；
 * REQ-ELEM-16：降级链接只留文字、无下划线、不建关系。
 * @param {object} inline
 * @param {Record<string, any>} ctx
 * @param {{ bold?: boolean, italic?: boolean, strike?: boolean, style?: string }} flags
 * @returns {string}
 */
function renderLink(inline, ctx, flags) {
  const href = typeof inline.href === "string" ? inline.href : "";
  const external = inline.degraded !== true && /^(https?|mailto):/i.test(href);
  if (!external) return renderInlines(inline.children, ctx, flags);
  const relId = ctx.addRel(href, "hyperlink");
  return '<w:hyperlink r:id="' + relId + '" w:history="1">'
    + renderInlines(inline.children, ctx, { ...flags, style: STYLE.hyperlink }) + "</w:hyperlink>";
}

/**
 * 行内图片：已解析则内嵌，未解析退化为 [图片：alt] 文本。
 * @param {object} inline
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
function renderImageInline(inline, ctx) {
  const asset = ctx.assets.get(inline.assetId);
  if (!asset || !asset.resolved) return textRun({}, imagePlaceholderText(inline, asset));
  return imageRun(inline, asset, ctx);
}

/**
 * 独占一段的图片：居中；缺图时出占位段 + 9pt 灰色来源行（复用 FooterText 样式）。
 * @param {object} inline
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
function renderImageParagraph(inline, ctx) {
  const asset = ctx.assets.get(inline.assetId);
  if (!asset || !asset.resolved) {
    return "<w:p>" + pPr(['<w:jc w:val="center"/>']) + textRun({}, imagePlaceholderText(inline, asset))
      + "</w:p>" + renderImageSource(inline, asset);
  }
  return "<w:p>" + pPr(['<w:jc w:val="center"/>']) + imageRun(inline, asset, ctx) + "</w:p>";
}

/**
 * REQ-ELEM-19：alt 为空时写 [图片]，否则 [图片：alt]。
 * @param {object} inline
 * @param {object|undefined} asset
 * @returns {string}
 */
function imagePlaceholderText(inline, asset) {
  const alt = String((asset && asset.alt) || inline.alt || "").trim();
  return alt === "" ? "[图片]" : "[图片：" + alt + "]";
}

/**
 * 降级图片的下一行：来源（URL 或原路径），超 80 字符截断并加省略号。
 * @param {object} inline
 * @param {object|undefined} asset
 * @returns {string}
 */
function renderImageSource(inline, asset) {
  const raw = String((asset && asset.rawSrc) || inline.rawSrc || inline.alt || "").trim();
  if (raw === "") return "";
  const shown = raw.length > SOURCE_DISPLAY_LIMIT ? raw.slice(0, SOURCE_DISPLAY_LIMIT) + "…" : raw;
  return "<w:p>" + pPr([pStyle(STYLE.footer)]) + textRun({}, shown) + "</w:p>";
}

/**
 * 内嵌图片：px@96dpi 换算 EMU，按版心宽高上限等比缩小（不放大）。
 * @param {object} inline
 * @param {object} asset
 * @param {Record<string, any>} ctx
 * @returns {string}
 */
function imageRun(inline, asset, ctx) {
  const relId = ctx.addRel("media/" + asset.mediaName, "image");
  const widthPx = Number(asset.widthPx);
  const heightPx = Number(asset.heightPx);
  let cx = Number.isFinite(widthPx) && widthPx > 0 ? pxToEmu(widthPx) : ctx.geometry.imageMaxWidthEmu;
  let cy = Number.isFinite(heightPx) && heightPx > 0 ? pxToEmu(heightPx) : ctx.geometry.imageMaxHeightEmu;
  const maxWidth = ctx.geometry.imageMaxWidthEmu;
  const maxHeight = ctx.geometry.imageMaxHeightEmu;
  if (cx > maxWidth || cy > maxHeight) {
    const scale = Math.min(maxWidth / cx, maxHeight / cy);
    cx = Math.min(Math.round(cx * scale), maxWidth);
    cy = Math.min(Math.round(cy * scale), maxHeight);
  }
  ctx.counters.docPrId += 1;
  const id = ctx.counters.docPrId;
  const name = "docconvert-image-" + id;
  return "<w:r><w:drawing>"
    + '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + '<wp:extent cx="' + cx + '" cy="' + cy + '"/>'
    + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
    + '<wp:docPr id="' + id + '" name="' + name + '"/>'
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + "<a:graphic>"
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + "<pic:pic>"
    + '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + "</pic:pic></a:graphicData></a:graphic>"
    + "</wp:inline></w:drawing></w:r>";
}

/**
 * @param {{ bold?: boolean, italic?: boolean, strike?: boolean, style?: string }} flags
 * @param {string} text
 * @returns {string}
 */
function textRun(flags, text) {
  const value = String(text ?? "");
  if (value === "") return "";
  const rPr = [];
  if (flags.style) rPr.push('<w:rStyle w:val="' + flags.style + '"/>');
  if (flags.bold) rPr.push("<w:b/>");
  if (flags.italic) rPr.push("<w:i/>");
  if (flags.strike) rPr.push("<w:strike/>");
  const rPrXml = rPr.length > 0 ? "<w:rPr>" + rPr.join("") + "</w:rPr>" : "";
  return "<w:r>" + rPrXml + '<w:t xml:space="preserve">' + textXml(value) + "</w:t></w:r>";
}

/* ------------------------------------------------------------------ 段落属性 */

/**
 * 段落属性按 OOXML 顺序：pStyle -> numPr -> ind（列表项首行缩进显式归零）。
 * @param {string|null} styleId
 * @param {{ ilvl?: number, numId?: number, quote?: boolean }} env
 * @returns {string}
 */
function paragraphProperties(styleId, env) {
  const parts = [];
  if (styleId) parts.push(pStyle(styleId));
  if (env.numId) {
    const level = Math.min(Math.max(Number(env.ilvl) || 0, 0), 2);
    parts.push('<w:numPr><w:ilvl w:val="' + level + '"/><w:numId w:val="' + env.numId + '"/></w:numPr>');
    parts.push('<w:ind w:firstLine="0" w:firstLineChars="0"/>');
  }
  return pPr(parts);
}

/**
 * @param {string} styleId
 * @returns {string}
 */
function pStyle(styleId) {
  return '<w:pStyle w:val="' + styleId + '"/>';
}

/**
 * @param {Array<string>} children
 * @returns {string}
 */
function pPr(children) {
  const inner = children.filter(Boolean).join("");
  return inner === "" ? "" : "<w:pPr>" + inner + "</w:pPr>";
}

/** 内联文本扁平化（目录条目文本）。 */
export { inlineText };
