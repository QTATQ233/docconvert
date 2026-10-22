/**
 * examples/ 全量回归（architecture §3.3 验收；不改动 examples/ 下任何文件）。
 *
 * 运行：node --test --test-isolation=none test/markdown/examples.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseMarkdown } from "../../src/markdown/index.js";
import { flattenBlocks, inlineText, makeCtx } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../examples");
const LF = String.fromCharCode(10);
const BLOCK_KINDS = new Set(["heading", "paragraph", "list", "blockquote", "code", "table", "hr"]);

/** 递归列出 examples/ 下全部 .md（含 README、errors、conflict）。 */
function walkMarkdown(directory) {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out.sort();
}

function parseFile(filePath) {
  const ctx = makeCtx(filePath);
  const blocks = parseMarkdown(readFileSync(filePath, "utf8"), ctx);
  return { ctx, blocks, flat: flattenBlocks(blocks) };
}

function codesOf(ctx) {
  return [...new Set(ctx.warnings.map((w) => w.code))].sort();
}

test("examples 全部 .md：解析不崩溃、块类型合法、书签稳定唯一、结果可复现", () => {
  const files = walkMarkdown(examplesDir);
  assert.ok(files.length >= 9, "至少覆盖 examples 现有 9 个 .md 样本");
  for (const filePath of files) {
    const text = readFileSync(filePath, "utf8");
    const first = parseFile(filePath);
    for (const block of first.flat) {
      assert.ok(BLOCK_KINDS.has(block.kind), filePath + " 出现未登记块类型：" + block.kind);
    }
    const headings = first.flat.filter((b) => b.kind === "heading");
    const bookmarks = headings.map((h) => h.bookmark);
    assert.equal(new Set(bookmarks).size, bookmarks.length, filePath + " 书签不唯一");
    bookmarks.forEach((bookmark, index) => {
      assert.equal(bookmark, "_Toc" + String(index + 1).padStart(4, "0"), filePath + " 书签顺序跳号");
    });
    for (const heading of headings) {
      assert.ok([1, 2, 3, 4, 5, 6].includes(heading.level));
      assert.ok(inlineText(heading.children).length > 0, filePath + " 出现空标题");
    }
    const second = parseFile(filePath);
    assert.deepEqual(second.blocks, first.blocks, filePath + " 两次解析结果不一致");
    assert.deepEqual(second.ctx.warnings, first.ctx.warnings, filePath + " 两次告警不一致");
    if (text.trim() === "") {
      assert.equal(first.blocks.length, 0, filePath + " 空白输入应为空 AST");
    }
  }
});

test("headings.md：26 个标题（H1 4 / H2 7 / H3 14 / H4 1）、无告警、列表 6 项", () => {
  const { ctx, blocks, flat } = parseFile(join(examplesDir, "headings.md"));
  const headings = flat.filter((b) => b.kind === "heading");
  const byLevel = [1, 2, 3, 4].map((level) => headings.filter((h) => h.level === level).length);
  assert.deepEqual(byLevel, [4, 7, 14, 1]);
  assert.equal(inlineText(headings[0].children), "城市湿地公园观测手册");
  assert.equal(headings[0].bookmark, "_Toc0001");
  assert.equal(inlineText(headings[headings.length - 1].children), "归档目录示例");
  assert.equal(ctx.warnings.length, 0);
  const list = blocks.find((b) => b.kind === "list");
  assert.equal(list.items.length, 6);
  assert.equal(list.ordered, false);
});

test("table.md：两张 8 列表格（6 行 + 60 行）、对齐默认、无降级告警", () => {
  const { ctx, flat } = parseFile(join(examplesDir, "table.md"));
  const tables = flat.filter((b) => b.kind === "table");
  assert.equal(tables.length, 2);
  assert.equal(tables[0].model.header.length, 8);
  assert.deepEqual(tables[0].model.align, [null, null, null, null, null, null, null, null]);
  assert.equal(tables[0].model.rows.length, 6);
  assert.equal(tables[1].model.rows.length, 60);
  for (const row of tables[1].model.rows) assert.equal(row.length, 8);
  assert.equal(inlineText(tables[0].model.header[0]), "样区编号");
  assert.equal(codesOf(ctx).length, 0);
});

test("code.md：6 个语言标识、长行逐字保留、制表符保留、围栏内 # 不是标题", () => {
  const { flat } = parseFile(join(examplesDir, "code.md"));
  const codes = flat.filter((b) => b.kind === "code");
  assert.deepEqual(codes.map((c) => c.lang), ["js", "js", "ts", "json", "powershell", "text"]);

  const source = readFileSync(join(examplesDir, "code.md"), "utf8").split(/\r?\n/);
  const sourceLong = source.find((line) => line.includes("const observationRecord"));
  const parsedLong = codes.map((c) => c.text).flatMap((t) => t.split(LF)).find((line) => line.includes("const observationRecord"));
  assert.equal(parsedLong, sourceLong, "超长单行必须逐字保留");
  assert.ok(sourceLong.length > 200);

  const tabbed = codes.find((c) => c.lang === "text");
  assert.equal(tabbed.text.split(LF)[0], "序号" + String.fromCharCode(9) + "样区" + String.fromCharCode(9) + "数量" + String.fromCharCode(9) + "备注");

  const headingTexts = flat.filter((b) => b.kind === "heading").map((h) => inlineText(h.children));
  assert.ok(!headingTexts.some((t) => t.includes("统计每条样线")), "代码块内的 # 行不得成为标题");
});

test("image.md：4 张相对图片全部登记 AssetRef（PNG、尺寸正确、零告警）", () => {
  const { ctx, flat } = parseFile(join(examplesDir, "image.md"));
  const images = flat.flatMap((b) => (b.children || []).filter((c) => c.kind === "image"));
  assert.equal(images.length, 4);
  assert.equal(ctx.assets.length, 4);
  assert.equal(codesOf(ctx).length, 0);
  const expected = [
    ["assets/wide-banner.png", 1200, 400],
    ["assets/tall-poster.png", 600, 1800],
    ["assets/icon-dot.png", 96, 96],
    ["assets/figure-flow.png", 900, 520],
  ];
  images.forEach((image, index) => {
    const asset = ctx.assets.find((item) => item.id === image.assetId);
    assert.ok(asset, "图片节点必须引用已登记资产");
    assert.equal(asset.resolved, true);
    assert.equal(asset.mime, "image/png");
    assert.equal(asset.rawSrc, expected[index][0], "rawSrc 保留相对路径原文");
    assert.equal(asset.widthPx, expected[index][1]);
    assert.equal(asset.heightPx, expected[index][2]);
    assert.ok(asset.absolutePath.endsWith("assets" + String.fromCharCode(92) + expected[index][0].split("/")[1]) || asset.absolutePath.includes("assets"));
    assert.ok(image.alt.length > 0);
  });
});

test("cjk.md：引用 1 级 2 段、有序列表 3 项各带 2 项子列表、链接与删除线告警", () => {
  const { ctx, blocks, flat } = parseFile(join(examplesDir, "cjk.md"));
  const quote = flat.find((b) => b.kind === "blockquote");
  assert.ok(quote);
  assert.equal(quote.depth, 1);
  assert.equal(quote.children.length, 2);
  assert.ok(inlineText(quote.children[0].children).startsWith("观测数据的所有权"));

  const ordered = blocks.find((b) => b.kind === "list" && b.ordered);
  assert.ok(ordered, "存在有序列表");
  assert.equal(ordered.items.length, 3);
  for (const item of ordered.items) {
    const nested = item.children.find((b) => b.kind === "list");
    assert.ok(nested, "每个有序项都带子列表");
    assert.equal(nested.items.length, 2);
    assert.equal(nested.ordered, false);
  }

  const links = flat.flatMap((b) => (b.children || []).filter((c) => c.kind === "link"));
  assert.ok(links.some((link) => link.href === "https://example.org/wetland/observation?area=A2&season=2026Q4"));

  assert.deepEqual(codesOf(ctx), ["strikethrough-unsupported"]);
  const allText = flat.map((b) => (b.children ? inlineText(b.children) : "")).join(LF);
  assert.ok(allText.includes("~~已废弃的旧字段~~"), "删除线按字面保留");
});

test("long-50.md：134 个正文标题、18 张表、7 个代码块、三态告警齐全、10 秒内完成", () => {
  const started = Date.now();
  const { ctx, blocks, flat } = parseFile(join(examplesDir, "long-50.md"));
  const elapsed = Date.now() - started;

  const headings = flat.filter((b) => b.kind === "heading");
  const byLevel = [1, 2, 3].map((level) => headings.filter((h) => h.level === level).length);
  // 源码里还有 1 个 "# docconvert 默认配置…"，它位于 yaml 围栏内，按 REQ-MD-008 不是标题。
  assert.deepEqual(byLevel, [28, 101, 5]);
  assert.equal(headings.length, 134);

  const tables = flat.filter((b) => b.kind === "table");
  assert.equal(tables.length, 18);
  assert.equal(flat.filter((b) => b.kind === "code").length, 7);
  assert.ok(blocks.length > 300);

  const codes = codesOf(ctx);
  assert.ok(codes.includes("task-list-degraded"));
  assert.ok(codes.includes("inline-html-unsupported"));
  assert.ok(codes.includes("strikethrough-unsupported"));

  const taskItems = flat
    .filter((b) => b.kind === "list")
    .flatMap((list) => list.items)
    .map((item) => inlineText(item.children[0].children))
    .filter((text) => text.startsWith("[ ]"));
  assert.ok(taskItems.length >= 10, "任务列表项保留 [ ] 原文");

  const allText = flat.map((b) => (b.children ? inlineText(b.children) : "")).join(LF);
  assert.ok(allText.includes("<!-- 语料起点：research" + String.fromCharCode(92) + "marine.md -->"), "HTML 注释按字面保留");

  const headingTexts = headings.map((h) => inlineText(h.children));
  assert.ok(!headingTexts.some((text) => text.startsWith("docconvert 默认配置")), "围栏内的 # 行不是标题");
  assert.ok(elapsed < 10000, "长文档解析耗时 " + elapsed + " ms");
});

test("README / errors / conflict 样本：解析成功且表格结构正确", () => {
  const readme = parseFile(join(examplesDir, "README.md"));
  const readmeTables = readme.flat.filter((b) => b.kind === "table");
  assert.equal(readmeTables.length, 1);
  assert.equal(readmeTables[0].model.header.length, 4);
  assert.equal(readmeTables[0].model.rows.length, 10);

  const errors = parseFile(join(examplesDir, "errors", "README.md"));
  assert.ok(errors.flat.filter((b) => b.kind === "code").length >= 8);
  assert.equal(errors.ctx.warnings.length, 0);

  const conflict = parseFile(join(examplesDir, "conflict", "README.md"));
  assert.equal(conflict.flat.filter((b) => b.kind === "table").length, 1);
  assert.equal(conflict.flat.filter((b) => b.kind === "table")[0].model.header.length, 2);

  const readonly = parseFile(join(examplesDir, "errors", "readonly-target.md"));
  assert.equal(readonly.flat.filter((b) => b.kind === "heading").length, 1);
  assert.equal(readonly.ctx.warnings.length, 0);
});

test("errors/empty.md：0 字节样本解析为空数组（不抛异常）", () => {
  const { blocks } = parseFile(join(examplesDir, "errors", "empty.md"));
  assert.deepEqual(blocks, []);
});
