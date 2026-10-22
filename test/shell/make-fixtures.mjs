#!/usr/bin/env node
/**
 * 生成阶段 2.0 空壳接线所需的最小 OOXML 文件（无第三方依赖）：
 *   test/shell/fixtures/minimal.docx  —— 桩 docx-render 复制的最小合法 DOCX
 *
 * 内置模板 **不在此生成**：它由 tools/build-template.js 产出（23 个样式，见 architecture §4.3）。
 *
 * ZIP 为 store（不压缩）+ 固定时间戳，保证同一输入生成同一字节（可复现）。
 * 用法：node test/shell/make-fixtures.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** CRC-32（IEEE 802.3，PNG/ZIP 用）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 生成 store 方式的 ZIP。
 * @param {Array<{ name: string, data: Buffer }>} entries
 * @returns {Buffer}
 */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 名称
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10); // time 00:00:00
    local.writeUInt16LE(0x0021, 12); // date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, entry.data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x0021, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, name]));

    offset += local.length + name.length + entry.data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
`;

const CONTENT_TYPES = (extraOverrides = "") => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${extraOverrides}</Types>
`;

const SECT_PR = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1134" w:bottom="1247" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>`;

const DOCUMENT_MINIMAL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>空壳接线最小文档</w:t></w:r></w:p>
    <w:p><w:r><w:t>本文件是阶段 2.0 的桩产物，用于验证 CLI → 桩 preprocess → 桩 docx → 真实 kit → PDF 的管线连通性。</w:t></w:r></w:p>
    ${SECT_PR}
  </w:body>
</w:document>
`;

/**
 * @param {string} id
 * @param {string} name
 * @param {boolean} [isHeading]
 * @returns {string}
 */
function styleParagraph(id, name, isHeading = false) {
  const outline = isHeading ? `<w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/>` : "";
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:qFormat/>${outline ? `<w:pPr>${outline}</w:pPr>` : ""}</w:style>`;
}

const STYLE_IDS = [
  ["Normal", "Normal", false],
  ["Heading1", "heading 1", true],
  ["Heading2", "heading 2", true],
  ["Heading3", "heading 3", true],
  ["Heading4", "heading 4", true],
  ["Heading5", "heading 5", true],
  ["Heading6", "heading 6", true],
  ["DocTitle", "DocTitle", false],
  ["TOC1", "TOC 1", false],
  ["TOC2", "TOC 2", false],
  ["TOC3", "TOC 3", false],
  ["CodeBlock", "CodeBlock", false],
  ["TableText", "TableText", false],
  ["Quote", "Quote", false],
  ["FooterText", "FooterText", false],
];

const STYLES_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${STYLE_IDS.map(([id, name, isHeading]) => styleParagraph(id, name, isHeading)).join("\n  ")}
  <w:style w:type="character" w:styleId="CharacterInlineCode"><w:name w:val="CharacterInlineCode"/></w:style>
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>
`;

const STYLES_MINIMAL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
</w:styles>
`;

await mkdir(join(ROOT, "test", "shell", "fixtures"), { recursive: true });

const minimalDocx = buildZip([
  { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES(), "utf8") },
  { name: "_rels/.rels", data: Buffer.from(RELS, "utf8") },
  { name: "word/document.xml", data: Buffer.from(DOCUMENT_MINIMAL, "utf8") },
  { name: "word/styles.xml", data: Buffer.from(STYLES_MINIMAL, "utf8") },
]);
await writeFile(join(ROOT, "test", "shell", "fixtures", "minimal.docx"), minimalDocx);

// 纪律：本脚本**不得**写 templates/reference.docx。
// 阶段 2.0 曾在此生成 16 样式的临时占位模板，它会覆盖 tools/build-template.js 产出的真实模板，
// 使之后所有转换报 template-missing（missing-styles）并污染仓库工作树。模板统一由构建期工具生成。
console.log(`fixtures: minimal.docx=${minimalDocx.length} B（内置模板不在此生成，见 tools/build-template.js）`);
