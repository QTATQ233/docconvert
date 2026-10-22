/**
 * input-preprocess + 资产登记 单测（architecture §3.2 / §3.1.2；requirements §2.1、§5）
 *
 * 覆盖：编码（UTF-8 / UTF-8-BOM / GB18030 / decode-error）、扩展名分派、空输入、
 * 路径错误、CRLF 归一、SHA-256、meta 形状、标题回退、AssetRef 解析与降级、
 * examples/notes.txt 结构化合理性（TC-TX-01 的模块级依据）、确定性。
 *
 * 运行：node --test test/preprocess/
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { preprocess } from "../../src/preprocess/index.js";
import { createAssetRegistry } from "../../src/preprocess/assets.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCONVERT_ROOT = resolve(HERE, "..", "..");
const EXAMPLES = join(DOCONVERT_ROOT, "examples");
const TMP_ROOT = join(HERE, ".tmp");

/** @type {string[]} */
const created = [];

before(async () => {
  await mkdir(TMP_ROOT, { recursive: true });
});

after(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

/**
 * 在临时目录里落一个输入文件，返回绝对路径。
 * @param {string} name 相对 TMP_ROOT 的文件名
 * @param {string | Buffer} content
 * @returns {Promise<string>}
 */
async function input(name, content) {
  const directory = await mkdtemp(join(TMP_ROOT, "case-"));
  const absolutePath = join(directory, name);
  await writeFile(absolutePath, content);
  return absolutePath;
}

/** 内联节点取文本。 */
function textOf(inlines) {
  return (inlines ?? []).map((node) => node.text ?? "").join("");
}

/** 块序列取全部可见文本。 */
function allTexts(blocks) {
  /** @type {string[]} */
  const out = [];
  const walk = (list) => {
    for (const block of list) {
      if (block.kind === "heading" || block.kind === "paragraph") out.push(textOf(block.children));
      else if (block.kind === "list") for (const item of block.items) walk(item.children);
    }
  };
  walk(blocks);
  return out;
}

/**
 * 断言抛出 DocconvertError（含 code / exitCode）。
 * @param {Promise<unknown>} promise
 * @param {string} code
 * @param {number} exitCode
 */
async function rejects(promise, code, exitCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "DocconvertError", "必须是 DocconvertError");
    assert.equal(error.code, code);
    assert.equal(error.exitCode, exitCode);
    return true;
  });
}

// ---------------------------------------------------------------- meta / 分派

test("UTF-8 .md：format/sha256/bytes/encoding/title 形状正确且可确定", async () => {
  const source = "# 标题\n\n正文段落。\n";
  const absolutePath = await input("demo.md", source);
  const document = await preprocess(absolutePath);

  assert.equal(document.schemaVersion, 1);
  assert.deepEqual(Object.keys(document.meta).sort(), [
    "absolutePath", "bytes", "encoding", "format", "mtimeMs", "sha256", "title",
  ]);
  assert.equal(document.meta.absolutePath, absolutePath);
  assert.equal(document.meta.format, "md");
  assert.equal(document.meta.encoding, "utf-8");
  assert.equal(document.meta.bytes, Buffer.byteLength(source));
  assert.equal(
    document.meta.sha256,
    createHash("sha256").update(Buffer.from(source, "utf8")).digest("hex").toUpperCase(),
    "SHA-256 为原始字节、大写十六进制",
  );
  assert.match(document.meta.sha256, /^[0-9A-F]{64}$/);
  assert.ok(document.meta.mtimeMs > 0);
  assert.equal(typeof document.meta.title, "string");
  assert.ok(document.meta.title.includes("标题"), "标题取自首个 H1");

  assert.ok(Array.isArray(document.blocks) && document.blocks.length >= 2);
  assert.equal(document.blocks[0].kind, "heading");
  assert.ok(allTexts(document.blocks).some((text) => text.includes("正文段落")));
  assert.deepEqual(document.assets, []);
  assert.ok(Array.isArray(document.warnings));

  const again = await preprocess(absolutePath);
  assert.deepEqual(again, document, "同输入两次输出完全一致");
});

test(".txt 分派 + 首行标题 + 中文序号不当标题 + 无 Markdown 告警", async () => {
  const source = [
    "会议纪要标题",
    "",
    "一、上季度小结",
    "",
    "- 甲项",
    "- 乙项",
    "",
    "1. 第一件事",
    "2. 第二件事",
    "",
  ].join("\n");
  const document = await preprocess(await input("minutes.txt", source));

  assert.equal(document.meta.format, "txt");
  assert.equal(document.meta.title, "会议纪要标题");
  const headings = document.blocks.filter((block) => block.kind === "heading");
  assert.equal(headings.length, 1);
  assert.equal(headings[0].bookmark, "_Toc0001");
  assert.equal(headings[0].level, 1);

  const lists = document.blocks.filter((block) => block.kind === "list");
  assert.equal(lists.length, 2);
  assert.equal(lists[0].items.length, 2);
  assert.equal(lists[0].ordered, false);
  assert.equal(lists[1].items.length, 2);
  assert.equal(lists[1].ordered, true);
  assert.equal(lists[1].start, 1);
  assert.deepEqual(document.warnings, [], "降级不产生 Markdown 类告警（requirements §5.1 注）");
});

test("扩展名大小写不敏感：.MD / .Txt 都能转换", async () => {
  const md = await preprocess(await input("A.MD", "# 大写扩展名\n\n正文\n"));
  assert.equal(md.meta.format, "md");
  const txt = await preprocess(await input("b.Txt", "标题行\n\n正文段落\n"));
  assert.equal(txt.meta.format, "txt");
  assert.equal(txt.meta.title, "标题行");
});

test("不支持的扩展名：.rst / .markdown 明确拒绝（unsupported-extension，退出码 3）", async () => {
  await rejects(preprocess(await input("c.rst", "标题\n\n正文\n")), "unsupported-extension", 3);
  await rejects(preprocess(await input("d.markdown", "# 标题\n")), "unsupported-extension", 3);
});

test("非绝对路径 → internal-error（相对路径解析属 cli 职责）", async () => {
  await rejects(preprocess("examples/notes.txt"), "internal-error", 1);
});

test("路径不存在 → input-not-found（退出码 3）", async () => {
  await rejects(preprocess(join(TMP_ROOT, "no-such-file.md")), "input-not-found", 3);
});

test("目录输入被明确拒绝，不静默通过", async () => {
  await assert.rejects(preprocess(EXAMPLES), (error) => {
    assert.equal(error.name, "DocconvertError");
    assert.equal(error.exitCode, 3);
    return true;
  });
});

// ---------------------------------------------------------------- 编码

test("UTF-8 BOM：剥离后 encoding=utf-8-bom，正文不含 BOM 字符", async () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# 标题\n\n正文\n", "utf8")]);
  const document = await preprocess(await input("bom.md", bytes));
  assert.equal(document.meta.encoding, "utf-8-bom");
  assert.equal(document.meta.title, "标题");
  assert.equal(JSON.stringify(document.blocks).includes("\uFEFF"), false, "BOM 不得进入正文");
});

test("GB18030 中文输入可解码（REQ-IN-002）", async () => {
  // "中文\n你\n" 的 GB18030 字节；两行连续非空 → 同一段落（首行标题规则不命中）
  const bytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0xc4, 0xe3, 0x0a]);
  const document = await preprocess(await input("gbk.txt", bytes));
  assert.equal(document.meta.encoding, "gb18030");
  assert.deepEqual(allTexts(document.blocks), ["中文你"]);
  assert.equal(document.meta.title, "gbk", "无 H1 时回退文件名");
  assert.deepEqual(document.warnings.map((warning) => warning.code), ["no-heading-detected"]);
});

test("两种编码都失败的字节 → decode-error（退出码 3）", async () => {
  const absolutePath = await input("broken.txt", Buffer.from([0xff, 0xff, 0xff]));
  await rejects(preprocess(absolutePath), "decode-error", 3);
});

// ---------------------------------------------------------------- 空输入

test("0 字节 → empty-input（退出码 3，无产物）", async () => {
  await rejects(preprocess(await input("empty.md", Buffer.alloc(0))), "empty-input", 3);
});

test("只有空白字符 → empty-input", async () => {
  await rejects(preprocess(await input("blank.txt", " \n\t\n\r\n")), "empty-input", 3);
});

// ---------------------------------------------------------------- 换行归一

test("CRLF/CR 归一为 LF，且正文不残留 \\r", async () => {
  const document = await preprocess(await input("crlf.md", "# A\r\n\r\n段落一\r\n段落二\r\n"));
  const serialized = JSON.stringify(document.blocks);
  assert.equal(serialized.includes("\\r"), false);
  assert.ok(allTexts(document.blocks).includes("段落一段落二"), "CJK 相邻直接相连（REQ-TXT-002）");
});

test("meta.title：无 H1 时取文件名去扩展名，且 no-heading-detected 只出现 1 次", async () => {
  // 首行后紧跟非空行 → 首行标题规则不命中，全文无标题
  const document = await preprocess(await input("无标题 文档.txt", "第一段\n第二段\n\n第三段\n"));
  assert.equal(document.meta.title, "无标题 文档");
  assert.equal(
    document.warnings.filter((warning) => warning.code === "no-heading-detected").length,
    1,
  );
  assert.equal(document.blocks.some((block) => block.kind === "heading"), false);
});

// ---------------------------------------------------------------- examples/notes.txt

test("examples/notes.txt：H1 唯一、中文序号为段落、3 个列表块、10 个段落、零丢失", async () => {
  const document = await preprocess(join(EXAMPLES, "notes.txt"));
  assert.equal(document.meta.format, "txt");
  assert.equal(document.meta.title, "城市湿地公园志愿者例会纪要");

  const headings = document.blocks.filter((block) => block.kind === "heading");
  assert.equal(headings.length, 1, "中文序号小节不得被误判为标题（TC-TX-01 期望 4）");
  assert.equal(headings[0].level, 1);
  assert.equal(textOf(headings[0].children), "城市湿地公园志愿者例会纪要");

  const lists = document.blocks.filter((block) => block.kind === "list");
  assert.equal(lists.length, 3);
  assert.deepEqual(lists.map((list) => [list.ordered, list.items.length]), [[false, 4], [true, 4], [false, 3]]);
  assert.deepEqual(lists.map((list) => list.start), [1, 1, 1]);

  const paragraphs = document.blocks.filter((block) => block.kind === "paragraph");
  assert.equal(paragraphs.length, 10, "空行分段生效，不允许整篇变成一段（TC-TX-01 期望 2）");
  assert.ok(paragraphs.some((paragraph) => textOf(paragraph.children).startsWith("一、上季度观测小结")));

  // 零丢失：去掉列表标记与全部空白后字符序列一致（REQ-TXT-003）
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(join(EXAMPLES, "notes.txt"), "utf8");
  const withoutMarkers = source
    .split(/\r?\n/)
    .map((line) => line.replace(/^[ ]*(?:[-*+•·][ ]+|\d{1,2}[.)、][ ]+|[（(]\d{1,2}[）)][ ]*)/u, ""))
    .join("");
  assert.equal(
    allTexts(document.blocks).join("").replace(/\s+/gu, ""),
    withoutMarkers.replace(/\s+/gu, ""),
  );

  assert.deepEqual(document.warnings, [], "纯 .txt 降级不产生告警");
  assert.deepEqual(await preprocess(join(EXAMPLES, "notes.txt")), document, "两次解析结果一致");
});

// ---------------------------------------------------------------- 资产登记

test("AssetRef：相对 PNG 解析成功（尺寸/绝对路径/id 顺序）", async () => {
  const assets = [];
  const registry = createAssetRegistry(EXAMPLES, assets);

  const icon = registry.resolveAsset("assets/icon-dot.png");
  assert.equal(icon.id, "asset-0001");
  assert.equal(icon.rawSrc, "assets/icon-dot.png");
  assert.equal(icon.mime, "image/png");
  assert.equal(icon.resolved, true);
  assert.equal(icon.widthPx, 96);
  assert.equal(icon.heightPx, 96);
  assert.equal(icon.absolutePath, join(EXAMPLES, "assets", "icon-dot.png"));
  assert.equal(icon.alt, "");
  assert.equal(assets.length, 1);

  const banner = registry.resolveAsset("assets/wide-banner.png");
  assert.equal(banner.id, "asset-0002");
  assert.deepEqual([banner.widthPx, banner.heightPx], [1200, 400]);

  const same = registry.resolveAsset("assets/icon-dot.png");
  assert.equal(same, icon, "同一 rawSrc 复用同一 AssetRef（按首次出现顺序）");
  assert.equal(assets.length, 2);

  icon.alt = "小尺寸图标";
  assert.equal(assets[0].alt, "小尺寸图标", "parser 可回填 alt");
});

test("AssetRef：缺失文件 / 远程 / data: / 绝对路径 / SVG 一律降级为 resolved=false", async () => {
  const assets = [];
  const registry = createAssetRegistry(EXAMPLES, assets);
  const cases = [
    "assets/no-such-file.png",
    "https://example.org/a.png",
    "data:image/png;base64,iVBORw0KGgo=",
    join(EXAMPLES, "assets", "icon-dot.png"),
    "assets/figure.svg",
    "../outside.png",
  ];
  for (const rawSrc of cases) {
    const ref = registry.resolveAsset(rawSrc);
    assert.equal(ref.resolved, false, rawSrc + " 必须降级");
    assert.equal("absolutePath" in ref, false, rawSrc + " 不得写 absolutePath");
    assert.equal("widthPx" in ref, false);
  }
  assert.equal(assets.length, cases.length);
});

test("AssetRef：JPEG 尺寸解析与「扩展名与文件头不符」降级", async () => {
  const directory = await mkdtemp(join(TMP_ROOT, "assets-"));
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x60,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
  await writeFile(join(directory, "photo.jpg"), jpeg);
  await writeFile(join(directory, "fake.png"), "not an image at all");

  const assets = [];
  const registry = createAssetRegistry(directory, assets);
  const photo = registry.resolveAsset("photo.jpg");
  assert.equal(photo.mime, "image/jpeg");
  assert.equal(photo.resolved, true);
  assert.deepEqual([photo.widthPx, photo.heightPx], [96, 64]);

  const fake = registry.resolveAsset("fake.png");
  assert.equal(fake.resolved, false, "PNG 扩展名但文件头不符 → 降级（不内嵌坏图）");
});

test("AssetRef：examples/notes.txt 不含图片，assets 为空", async () => {
  const document = await preprocess(join(EXAMPLES, "notes.txt"));
  assert.deepEqual(document.assets, []);
});

// ---------------------------------------------------------------- 告警形状


// ---------------------------------------------------------------- examples/ 全量集成

/**
 * 递归列出 examples/ 下的输入文件（.md/.txt/.bin），跳过图片资产。
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listExampleInputs(directory) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listExampleInputs(absolutePath));
    else if (/\.(md|txt|bin)$/i.test(entry.name)) files.push(absolutePath);
  }
  return files.sort();
}

test("examples/ 全量：可预处理的都成功且确定、路径不进入 AST、错误样本报正确码", async () => {
  const inputs = await listExampleInputs(EXAMPLES);
  assert.ok(inputs.length >= 14, "examples 输入样本应齐全（11 md + 2 txt + 1 bin），实际 " + inputs.length);

  let converted = 0;
  for (const absolutePath of inputs) {
    const name = absolutePath.slice(EXAMPLES.length + 1).replace(/\\/g, "/");
    if (/\.bin$/i.test(absolutePath)) {
      await assert.rejects(preprocess(absolutePath), (error) => {
        assert.equal(error.code, "unsupported-extension", name);
        return true;
      });
      continue;
    }
    if (name === "errors/empty.md") {
      await assert.rejects(preprocess(absolutePath), (error) => {
        assert.equal(error.code, "empty-input", name);
        return true;
      });
      continue;
    }
    const document = await preprocess(absolutePath);
    assert.ok(["md", "txt"].includes(document.meta.format), name + " 格式判定");
    assert.ok(document.blocks.length > 0, name + " 必须有块");
    assert.equal(JSON.stringify(document.blocks).includes(DOCONVERT_ROOT), false, name + " AST 不得含源绝对路径（REQ-REP-003）");
    assert.equal(JSON.stringify(document.assets).includes('"resolved":true') && document.assets.some((asset) => asset.resolved) === true, document.assets.some((asset) => asset.resolved), name + " 资产字段自洽");
    const again = await preprocess(absolutePath);
    assert.deepEqual(again, document, name + " 两次预处理结果一致");
    converted += 1;
  }
  assert.ok(converted >= 12, "成功预处理的样本数（14 − bin − empty.md）：" + converted);
});

test("examples/image.md 的相对图片全部解析成功（相对当前 md 所在目录）", async () => {
  const document = await preprocess(join(EXAMPLES, "image.md"));
  assert.equal(document.meta.format, "md");
  const imageBlocks = JSON.stringify(document.blocks).match(/"kind":"image"/g) ?? [];
  assert.ok(imageBlocks.length >= 4, "image.md 应解析出 4 个 image 节点，实际 " + imageBlocks.length);
  assert.equal(document.assets.length, 4);
  for (const asset of document.assets) {
    assert.equal(asset.resolved, true, asset.rawSrc + " 应可解析");
    assert.equal(["image/png", "image/jpeg"].includes(asset.mime), true);
    assert.ok(asset.widthPx > 0 && asset.heightPx > 0, asset.rawSrc + " 应带像素尺寸");
    assert.ok(asset.absolutePath.startsWith(join(EXAMPLES, "assets")), asset.rawSrc + " 绝对路径应在 examples/assets 下");
  }
  assert.deepEqual(document.assets.map((asset) => asset.id), ["asset-0001", "asset-0002", "asset-0003", "asset-0004"]);
  assert.deepEqual(document.warnings.map((warning) => warning.code), [], "全部图片可内嵌 → 无 image-degraded");
});

test("告警记录只含 code/message（+可选 line），文案取 requirements §5.2", async () => {
  const document = await preprocess(await input("warn.txt", "- 一级\n        1. 深缩进\n"));
  const clamped = document.warnings.filter((warning) => warning.code === "list-depth-clamped");
  assert.equal(clamped.length, 1);
  assert.deepEqual(Object.keys(clamped[0]).sort(), ["code", "line", "message"]);
  assert.equal(clamped[0].message, "列表超过 3 级，已并入第 3 级");
  assert.equal(clamped[0].line, 2);
  assert.equal(document.meta.title, "warn", "无标题回退文件名");
});
