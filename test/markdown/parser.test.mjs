/**
 * markdown-parser 单元测试（architecture §3.3 / requirements §2.2、§5）。
 *
 * 运行：node --test --test-isolation=none test/markdown/
 */
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseMarkdown } from "../../src/markdown/index.js";
import { joinSoftLines, joinSoftPair } from "../../src/markdown/soft-join.js";
import { flattenBlocks, inlineText, makeCtx } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../examples");
const newCtx = () => makeCtx(resolve(examplesDir, "synthetic.md"));
const LF = String.fromCharCode(10);

test("ATX 标题：级别、闭合式、#标签 不识别", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("# 一级" + LF + LF + "### 三级 ###" + LF + LF + "#标签" + LF + LF + "#### 四级", ctx);
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[0].level, 1);
  assert.equal(inlineText(blocks[0].children), "一级");
  assert.equal(blocks[1].level, 3);
  assert.equal(inlineText(blocks[1].children), "三级");
  assert.equal(blocks[2].kind, "paragraph");
  assert.equal(inlineText(blocks[2].children), "#标签");
  assert.equal(blocks[3].level, 4);
});

test("Setext 标题：=== 与 ---", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("标题一" + LF + "===" + LF + LF + "标题二" + LF + "---", ctx);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[0].level, 1);
  assert.equal(inlineText(blocks[0].children), "标题一");
  assert.equal(blocks[1].level, 2);
  assert.equal(inlineText(blocks[1].children), "标题二");
});

test("书签：_TocNNNN 按出现顺序、唯一", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("# A" + LF + LF + "## B" + LF + LF + "> ### C", ctx);
  const headings = flattenBlocks(blocks).filter((b) => b.kind === "heading");
  assert.deepEqual(headings.map((h) => h.bookmark), ["_Toc0001", "_Toc0002", "_Toc0003"]);
  assert.equal(headings[2].level, 3, "引用内的标题照常生成 heading 节点");
});

test("段落软换行：CJK 直连、英文一个空格、全角标点直连", () => {
  assert.equal(inlineText(parseMarkdown("第一行末字" + LF + "符第二行首", newCtx())[0].children), "第一行末字符第二行首");
  assert.equal(inlineText(parseMarkdown("first line" + LF + "second line", newCtx())[0].children), "first line second line");
  assert.equal(inlineText(parseMarkdown("中文，" + LF + "下一行", newCtx())[0].children), "中文，下一行");
  assert.equal(joinSoftPair("中", "文"), "中文");
  assert.equal(joinSoftPair("a", "b"), "a b");
  assert.equal(joinSoftLines(["  第一行  ", "", "  第二行 "]), "第一行第二行");
});

test("硬换行：行尾两空格与行尾反斜杠都产出 br", () => {
  const bySpaces = parseMarkdown("第一行  " + LF + "第二行", newCtx())[0];
  assert.deepEqual(bySpaces.children.map((c) => c.kind), ["text", "br", "text"]);
  assert.equal(bySpaces.children[0].text, "第一行");
  assert.equal(bySpaces.children[2].text, "第二行");

  const backslash = String.fromCharCode(92);
  const byBackslash = parseMarkdown("第一行" + backslash + LF + "第二行", newCtx())[0];
  assert.deepEqual(byBackslash.children.map((c) => c.kind), ["text", "br", "text"]);
  assert.equal(byBackslash.children[0].text, "第一行", "反斜杠本身不显示");
});

test("列表：无序/有序、起始编号、嵌套三层", () => {
  const ctx = newCtx();
  const ordered = parseMarkdown("3. 三" + LF + "4. 四", ctx)[0];
  assert.equal(ordered.kind, "list");
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.start, 3);
  assert.equal(ordered.items.length, 2);

  const nested = parseMarkdown("- 一" + LF + "  - 二" + LF + "    - 三", ctx)[0];
  assert.equal(nested.ordered, false);
  const levelTwo = nested.items[0].children.find((b) => b.kind === "list");
  assert.ok(levelTwo, "第二层列表存在");
  const levelThree = levelTwo.items[0].children.find((b) => b.kind === "list");
  assert.ok(levelThree, "第三层列表存在");
  assert.equal(inlineText(levelThree.items[0].children[0].children), "三");
});

test("列表超过 3 级：并入第 3 级并告警", () => {
  const ctx = newCtx();
  const text = "- 一" + LF + "  - 二" + LF + "    - 三" + LF + "      - 四";
  const blocks = parseMarkdown(text, ctx);
  assert.ok(ctx.warnings.some((w) => w.code === "list-depth-clamped"));
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((b) => b.kind === "paragraph").map((b) => inlineText(b.children));
  assert.ok(paragraphs.includes("四"), "第四级文字保留");
  const lists = flat.filter((b) => b.kind === "list");
  assert.equal(lists.length, 3, "只保留 3 层 list 节点");
});

test("任务列表：[ ]/[x] 字面保留并告警", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("- [ ] 未完成项" + LF + "- [x] 已完成项", ctx);
  assert.equal(blocks[0].kind, "list");
  const texts = blocks[0].items.map((item) => inlineText(item.children[0].children));
  assert.deepEqual(texts, ["[ ] 未完成项", "[x] 已完成项"]);
  assert.equal(ctx.warnings.filter((w) => w.code === "task-list-degraded").length, 2);
});

test("表格：对齐映射与单元格切分", () => {
  const ctx = newCtx();
  const text = "| 左 | 中 | 右 | 默认 |" + LF + "| :-- | :-: | --: | --- |" + LF + "| a | b | c | d |";
  const table = parseMarkdown(text, ctx)[0];
  assert.equal(table.kind, "table");
  assert.deepEqual(table.model.align, ["left", "center", "right", null]);
  assert.equal(table.model.header.length, 4);
  assert.equal(inlineText(table.model.header[0]), "左");
  assert.equal(table.model.rows.length, 1);
  assert.deepEqual(table.model.rows[0].map((cell) => inlineText(cell)), ["a", "b", "c", "d"]);
  assert.equal(ctx.warnings.length, 0);
});

test("表格：行列不齐补齐/合并并告警", () => {
  const ctx = newCtx();
  const text =
    "| a | b | c |" + LF + "| --- | --- | --- |" + LF + "| 1 | 2 |" + LF + "| 1 | 2 | 3 | 4 |";
  const table = parseMarkdown(text, ctx)[0];
  assert.equal(table.kind, "table");
  assert.deepEqual(table.model.rows[0].map((cell) => inlineText(cell)), ["1", "2", ""]);
  assert.deepEqual(table.model.rows[1].map((cell) => inlineText(cell)), ["1", "2", "3 / 4"]);
  const ragged = ctx.warnings.filter((w) => w.code === "table-ragged");
  assert.equal(ragged.length, 2);
  assert.match(ragged[0].message, /表头 3 列，本行 2 列/);
});

test("表格：缺分隔行整块降级为段落", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("| a | b |" + LF + "| 1 | 2 |", ctx);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "paragraph");
  const text = inlineText(blocks[0].children);
  assert.ok(text.includes("| a | b |"));
  assert.ok(text.includes("| 1 | 2 |"));
  assert.ok(ctx.warnings.some((w) => w.code === "table-malformed"));
});

test("表格：分隔行列数与表头不一致也降级", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("| a | b |" + LF + "| --- |" + LF + "| 1 | 2 |", ctx);
  assert.equal(blocks[0].kind, "paragraph");
  assert.ok(ctx.warnings.some((w) => w.code === "table-malformed"));
});

test("围栏代码块：内容不解析、长行与制表符原样", () => {
  const ctx = newCtx();
  const longLine = 'const value = "' + "x".repeat(300) + '";';
  const text = "\`\`\`js" + LF + "const a = 1;" + LF + "# 不是标题" + LF + longLine + LF + "\`\`\`";
  const blocks = parseMarkdown(text, ctx);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "code");
  assert.equal(blocks[0].lang, "js");
  const lines = blocks[0].text.split(LF);
  assert.equal(lines[1], "# 不是标题");
  assert.equal(lines[2], longLine, "长代码行原样保留");
  assert.equal(flattenBlocks(blocks).filter((b) => b.kind === "heading").length, 0);

  const tabbed = parseMarkdown("\`\`\`text" + LF + "序号" + String.fromCharCode(9) + "样区" + LF + "\`\`\`", newCtx())[0];
  assert.equal(tabbed.text, "序号" + String.fromCharCode(9) + "样区");
});

test("围栏代码块：未闭合时到文末全是代码", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("\`\`\`" + LF + "abc" + LF + "def", ctx);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "code");
  assert.equal(blocks[0].text, "abc" + LF + "def");
});

test("引用：单级、两级、超深并入第 2 级", () => {
  const single = parseMarkdown("> 一级引用", newCtx())[0];
  assert.equal(single.kind, "blockquote");
  assert.equal(single.depth, 1);

  const two = parseMarkdown("> 一级引用" + LF + ">" + LF + "> > 二级引用", newCtx())[0];
  assert.equal(two.depth, 2);
  assert.deepEqual(two.children.map((b) => inlineText(b.children)), ["一级引用", "二级引用"]);

  const ctx = newCtx();
  const clamped = parseMarkdown(">>> 第三级", ctx)[0];
  assert.equal(clamped.depth, 2);
  assert.equal(inlineText(clamped.children[0].children), "第三级");
  assert.ok(ctx.warnings.some((w) => w.code === "quote-depth-clamped"));
});

test("分隔线：*** / - - - / ___", () => {
  const blocks = parseMarkdown("***" + LF + LF + "- - -" + LF + LF + "___", newCtx());
  assert.deepEqual(blocks.map((b) => b.kind), ["hr", "hr", "hr"]);
});

test("链接：http、mailto、自动链接", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("[湿地平台](https://example.org/a?b=1) 与 <https://example.org/x> 与 [邮件](mailto:a@b.c)", ctx);
  const links = blocks[0].children.filter((c) => c.kind === "link");
  assert.equal(links.length, 3);
  assert.equal(links[0].href, "https://example.org/a?b=1");
  assert.equal(inlineText(links[0].children), "湿地平台");
  assert.equal(links[1].href, "https://example.org/x");
  assert.equal(inlineText(links[1].children), "https://example.org/x");
  assert.equal(links[2].href, "mailto:a@b.c");
  assert.equal(ctx.warnings.length, 0, "受支持目标不告警");
});

test("链接降级：相对路径显示（目标）并告警", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("见 [说明](./other.md) 与 [锚点](#sec)", ctx);
  const links = blocks[0].children.filter((c) => c.kind === "link");
  assert.equal(links.length, 2);
  assert.equal(links[0].degraded, true);
  assert.equal(inlineText(links[0].children), "说明（./other.md）");
  assert.equal(inlineText(links[1].children), "锚点（#sec）");
  assert.equal(ctx.warnings.filter((w) => w.code === "link-target-degraded").length, 2);
});

test("裸 URL 不自动识别为链接", () => {
  const blocks = parseMarkdown("参考 https://example.org/x 结束", newCtx());
  assert.equal(blocks[0].children.filter((c) => c.kind === "link").length, 0);
  assert.equal(inlineText(blocks[0].children), "参考 https://example.org/x 结束");
});

test("图片：相对 PNG 解析为 AssetRef", () => {
  const ctx = makeCtx(resolve(examplesDir, "image.md"));
  const blocks = parseMarkdown("![小图标](assets/icon-dot.png)", ctx);
  const image = blocks[0].children.find((c) => c.kind === "image");
  assert.ok(image);
  assert.equal(image.alt, "小图标");
  assert.equal(image.assetId, ctx.assets[0].id);
  assert.equal(ctx.assets[0].resolved, true);
  assert.equal(ctx.assets[0].mime, "image/png");
  assert.equal(ctx.assets[0].widthPx, 96);
  assert.equal(ctx.assets[0].heightPx, 96);
  assert.equal(ctx.warnings.length, 0);
});

test("图片降级：远程/绝对路径登记为未解析并告警", () => {
  const ctx = makeCtx(resolve(examplesDir, "image.md"));
  const blocks = parseMarkdown("![远程](https://example.org/a.png) 与 ![绝对](/tmp/a.png)", ctx);
  const images = blocks[0].children.filter((c) => c.kind === "image");
  assert.equal(images.length, 2);
  assert.equal(ctx.assets.length, 2);
  assert.equal(ctx.assets[0].resolved, false);
  assert.equal(ctx.assets[1].resolved, false);
  assert.equal(ctx.warnings.filter((w) => w.code === "image-degraded").length, 2);
});

test("强调、行内代码与反斜杠转义", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("**加粗** 文字 *斜体* 与 \`--to docx,pdf\`", ctx);
  const kinds = blocks[0].children.map((c) => c.kind);
  assert.deepEqual(kinds, ["strong", "text", "em", "text", "code"]);
  assert.equal(inlineText(blocks[0].children[0].children), "加粗");
  assert.equal(blocks[0].children[4].text, "--to docx,pdf");

  const nested = parseMarkdown("**外*内*外**", newCtx())[0];
  assert.equal(nested.children[0].kind, "strong");
  assert.ok(nested.children[0].children.some((c) => c.kind === "em"));

  const escaped = inlineText(parseMarkdown("\\*不是斜体\\*", newCtx())[0].children);
  assert.equal(escaped, "*不是斜体*");
  assert.equal(parseMarkdown("\\*不是斜体\\*", newCtx())[0].children.filter((c) => c.kind === "em").length, 0);
});

test("删除线/公式/脚注/内联 HTML 字面保留并告警", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown(
    "~~旧字段~~ 与 $E=mc^2$ 与 正文[^1] 与 <span>注</span> 与 <!-- 注释 -->",
    ctx
  );
  const text = inlineText(blocks[0].children);
  assert.ok(text.includes("~~旧字段~~"));
  assert.ok(text.includes("$E=mc^2$"));
  assert.ok(text.includes("[^1]"));
  assert.ok(text.includes("<span>注</span>"));
  assert.ok(text.includes("<!-- 注释 -->"));
  const codes = new Set(ctx.warnings.map((w) => w.code));
  assert.ok(codes.has("strikethrough-unsupported"));
  assert.ok(codes.has("formula-unsupported"));
  assert.ok(codes.has("footnote-unsupported"));
  // <span> 开/闭标签各 1 条 + HTML 注释 1 条 = 3
  assert.equal(ctx.warnings.filter((w) => w.code === "inline-html-unsupported").length, 3);
  for (const warning of ctx.warnings) {
    assert.ok(Number.isInteger(warning.line) && warning.line > 0, "告警必须带行号");
    assert.ok(typeof warning.message === "string" && warning.message.length > 0);
  }
});

test("脚注定义行原样保留并告警", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("[^1]: 定义内容", ctx);
  assert.equal(blocks[0].kind, "paragraph");
  assert.equal(inlineText(blocks[0].children), "[^1]: 定义内容");
  assert.ok(ctx.warnings.some((w) => w.code === "footnote-unsupported"));
});

test("未闭合语法按字面保留，不中断整篇", () => {
  assert.equal(inlineText(parseMarkdown("**未闭合粗体", newCtx())[0].children), "**未闭合粗体");
  assert.equal(inlineText(parseMarkdown("\`未闭合代码", newCtx())[0].children), "\`未闭合代码");
  assert.equal(inlineText(parseMarkdown("[未闭合链接](x", newCtx())[0].children), "[未闭合链接](x");
  const blocks = parseMarkdown("**未闭合粗体" + LF + LF + "后续正常段落", newCtx());
  assert.equal(blocks.length, 2);
  assert.equal(inlineText(blocks[1].children), "后续正常段落");
});

test("front matter：首行分隔线 + 其余原样成段 + 告警", () => {
  const ctx = newCtx();
  const text = "---" + LF + "title: 示例" + LF + "date: 2026-10-22" + LF + "---" + LF + "正文段落";
  const blocks = parseMarkdown(text, ctx);
  assert.equal(blocks[0].kind, "hr");
  const body = blocks.slice(1).map((b) => (b.kind === "paragraph" ? inlineText(b.children) : "<" + b.kind + ">"));
  assert.ok(body.join(" | ").includes("title: 示例"));
  assert.ok(body.join(" | ").includes("2026-10-22"));
  assert.equal(body[body.length - 1], "正文段落");
  const warning = ctx.warnings.find((w) => w.code === "front-matter-not-recognized");
  assert.ok(warning);
  assert.equal(warning.line, 1);
});

test("缩进代码块降级为段落并告警", () => {
  const ctx = newCtx();
  const blocks = parseMarkdown("    代码第一行" + LF + "    代码第二行", ctx);
  assert.equal(blocks[0].kind, "paragraph");
  const text = inlineText(blocks[0].children);
  assert.ok(text.includes("代码第一行"));
  assert.ok(!text.startsWith(" "), "前导空白丢弃");
  assert.ok(ctx.warnings.some((w) => w.code === "indented-code-unsupported"));
});

test("空输入与纯空白输入返回空数组", () => {
  assert.deepEqual(parseMarkdown("", newCtx()), []);
  assert.deepEqual(parseMarkdown("   " + LF + LF + "  ", newCtx()), []);
});

test("缺省 ctx 也能工作（无 warn/resolveAsset/nextBookmark）", () => {
  const blocks = parseMarkdown("# 标题" + LF + LF + "正文");
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[0].bookmark, "_Toc0001");
  assert.equal(inlineText(blocks[1].children), "正文");
});

test("畸形输入永不抛异常", () => {
  const nasty = [
    "\`\`\`",
    "~~~",
    ">",
    ">>>",
    "|",
    "| |",
    "| a | b |",
    "- ",
    "* ",
    "***",
    "![",
    "![x](",
    "[",
    "[]()",
    "<",
    "<!--",
    "~~",
    "$",
    String.fromCharCode(92),
    "**",
    "_",
    "- - -",
    "1. ",
    "    ",
    "\`",
  ];
  for (const sample of nasty) {
    const blocks = parseMarkdown(sample, newCtx());
    assert.ok(Array.isArray(blocks), "输入应可解析：" + JSON.stringify(sample));
  }
});

test("同一输入两次解析结果完全一致（可复现）", () => {
  const text =
    "# 标题" + LF + LF + "正文第一行" + LF + "正文第二行" + LF + LF + "- 项目" + LF + "  - 子项" + LF + LF +
    "| a | b |" + LF + "| --- | --- |" + LF + "| 1 | 2 |" + LF + LF + "\`\`\`js" + LF + "x" + LF + "\`\`\`";
  const first = parseMarkdown(text, makeCtx(resolve(examplesDir, "synthetic.md")));
  const second = parseMarkdown(text, makeCtx(resolve(examplesDir, "synthetic.md")));
  assert.deepEqual(first, second);
});
