/**
 * txt-structurer 单测（requirements §2.3.1–§2.3.4 / architecture §3.4）
 *
 * 覆盖：无标题 / 全列表 / 混合 / 空文件 / 超长段落 / §2.3.4 的三个写死示例 /
 * 中文序号不识别 / 连续空行 / CRLF / Tab 缩进 / 层级钳制 / 确定性 / 零改写。
 *
 * 运行：node --test test/preprocess/
 */
import test from "node:test";
import assert from "node:assert/strict";

import { joinSoftLines, joinSoftPair } from "../../src/markdown/soft-join.js";
import { displayWidth, structureText, WARNING_MESSAGES } from "../../src/txt/index.js";

/** 内联节点取文本（Block.children 只有 text 节点）。 */
function textOf(inlines) {
  return (inlines ?? []).map((node) => node.text ?? "").join("");
}

/** 把 Block 规约成可比较的形状（丢弃 bookmark 的具体值，单独断言）。 */
function shape(block) {
  if (block.kind === "heading") return { kind: "heading", level: block.level, text: textOf(block.children) };
  if (block.kind === "paragraph") return { kind: "paragraph", text: textOf(block.children) };
  if (block.kind === "hr") return { kind: "hr" };
  if (block.kind === "list") {
    return {
      kind: "list",
      ordered: block.ordered,
      start: block.start,
      tight: block.tight,
      items: block.items.map((item) => item.children.map(shape)),
    };
  }
  return { kind: block.kind };
}

/** @param {Array<object>} blocks */
function shapes(blocks) {
  return blocks.map(shape);
}

/** 带告警收集 + bookmark 计数器的 ctx。 */
function makeCtx() {
  /** @type {Array<{ code: string, message: string, line?: number }>} */
  const warnings = [];
  let bookmarks = 0;
  return {
    warnings,
    ctx: {
      warn: (warning) => warnings.push(warning),
      nextBookmark: () => {
        bookmarks += 1;
        return "_Toc" + String(bookmarks).padStart(4, "0");
      },
    },
  };
}

/** 无 ctx 调用（独立单测路径）。 */
function parse(text) {
  return structureText(text);
}

/** 从块序列里取出所有可见文本（含列表项）。 */
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

// ---------------------------------------------------------------- 示例 1/2/3

const DEMO1 = ["钓鱼笔记", "", "今天在近岸矶钓，黑鲷口很轻。", "改用小钩细线之后，中鱼率明显提高。", ""].join("\n");

const DEMO2 = [
  "海钓准备",
  "========",
  "",
  "- 潮汐表",
  "  查涨落潮，避开大潮转流。",
  "- 装备",
  "  1. 矶竿",
  "  2. 纺车轮",
  "",
  "---",
  "",
  "以上为初稿。",
  "",
].join("\n");

const DEMO3 = [
  "会议记录",
  "========",
  "",
  "以下内容为从聊天记录粘贴：",
  "",
  "| 议题 | 结论 |",
  "| --- | --- |",
  "> 待补充",
  "![截图](shot.png)",
  "",
].join("\n");

test("示例 1：首行标题 + CJK 段落拼接（§2.3.4 逐字一致）", () => {
  assert.deepEqual(shapes(parse(DEMO1)), [
    { kind: "heading", level: 1, text: "钓鱼笔记" },
    { kind: "paragraph", text: "今天在近岸矶钓，黑鲷口很轻。改用小钩细线之后，中鱼率明显提高。" },
  ]);
});

test("示例 2：Setext 标题 + 列表嵌套 + 分隔线（§2.3.4 逐字一致）", () => {
  assert.deepEqual(shapes(parse(DEMO2)), [
    { kind: "heading", level: 1, text: "海钓准备" },
    {
      kind: "list",
      ordered: false,
      start: 1,
      tight: true,
      items: [
        [{ kind: "paragraph", text: "潮汐表查涨落潮，避开大潮转流。" }],
        [
          { kind: "paragraph", text: "装备" },
          {
            kind: "list",
            ordered: true,
            start: 1,
            tight: true,
            items: [
              [{ kind: "paragraph", text: "矶竿" }],
              [{ kind: "paragraph", text: "纺车轮" }],
            ],
          },
        ],
      ],
    },
    { kind: "hr" },
    { kind: "paragraph", text: "以上为初稿。" },
  ]);
});

test("示例 3：无法识别内容整体降级为段落（逐字保留、无告警）", () => {
  const { ctx, warnings } = makeCtx();
  const blocks = structureText(DEMO3, ctx);
  assert.deepEqual(shapes(blocks), [
    { kind: "heading", level: 1, text: "会议记录" },
    { kind: "paragraph", text: "以下内容为从聊天记录粘贴：" },
    { kind: "paragraph", text: "| 议题 | 结论 | | --- | --- | > 待补充 ![截图](shot.png)" },
  ]);
  assert.deepEqual(warnings, [], ".txt 的定义行为不产生 Markdown 类告警（requirements §5.1 注）");
});

// ---------------------------------------------------------------- 边界 1：无标题

test("无标题：全部降级为段落 + no-heading-detected，不插入标题段落", () => {
  const { ctx, warnings } = makeCtx();
  const blocks = structureText("第一段第一行\n第一段第二行\n\n第二段。\n", ctx);
  assert.deepEqual(shapes(blocks), [
    { kind: "paragraph", text: "第一段第一行第一段第二行" },
    { kind: "paragraph", text: "第二段。" },
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "no-heading-detected");
  assert.equal(warnings[0].message, WARNING_MESSAGES["no-heading-detected"]);
  assert.equal(warnings[0].line, undefined, "整篇性质告警不带行号");
});

test("有标题时不发 no-heading-detected", () => {
  const { ctx, warnings } = makeCtx();
  structureText("标题\n\n正文\n", ctx);
  assert.equal(warnings.filter((warning) => warning.code === "no-heading-detected").length, 0);
});

// ---------------------------------------------------------------- 边界 2：全列表

test("全列表：无序项与层级、列表结束规则", () => {
  const blocks = parse(["- 甲", "- 乙", "  - 乙一", "  - 乙二", "- 丙", ""].join("\n"));
  assert.deepEqual(shapes(blocks), [
    {
      kind: "list",
      ordered: false,
      start: 1,
      tight: true,
      items: [
        [{ kind: "paragraph", text: "甲" }],
        [
          { kind: "paragraph", text: "乙" },
          {
            kind: "list",
            ordered: false,
            start: 1,
            tight: true,
            items: [
              [{ kind: "paragraph", text: "乙一" }],
              [{ kind: "paragraph", text: "乙二" }],
            ],
          },
        ],
        [{ kind: "paragraph", text: "丙" }],
      ],
    },
  ]);
});

test("全列表：无序/有序切换、有序编号保持原文", () => {
  const blocks = parse(["- 甲", "1. 乙", "2. 丙", "5. 丁", ""].join("\n"));
  assert.deepEqual(shapes(blocks), [
    { kind: "list", ordered: false, start: 1, tight: true, items: [[{ kind: "paragraph", text: "甲" }]] },
    {
      kind: "list",
      ordered: true,
      start: 1,
      tight: true,
      items: [
        [{ kind: "paragraph", text: "乙" }],
        [{ kind: "paragraph", text: "丙" }],
      ],
    },
    { kind: "list", ordered: true, start: 5, tight: true, items: [[{ kind: "paragraph", text: "丁" }]] },
  ]);
});

test("全列表：括号数字与顿号数字都识别为有序列表（空行后仍是列表项 → 列表继续）", () => {
  const blocks = parse(["（1）甲", "（2）乙", "", "3、 丙", "4、 丁", ""].join("\n"));
  assert.deepEqual(shapes(blocks), [
    {
      kind: "list",
      ordered: true,
      start: 1,
      tight: false,
      items: [
        [{ kind: "paragraph", text: "甲" }],
        [{ kind: "paragraph", text: "乙" }],
        [{ kind: "paragraph", text: "丙" }],
        [{ kind: "paragraph", text: "丁" }],
      ],
    },
  ]);
});

test("列表空行后仍是列表项时列表继续并标为非紧凑（tight=false）", () => {
  const blocks = parse(["- 甲", "", "- 乙", ""].join("\n"));
  assert.deepEqual(shapes(blocks), [
    {
      kind: "list",
      ordered: false,
      start: 1,
      tight: false,
      items: [
        [{ kind: "paragraph", text: "甲" }],
        [{ kind: "paragraph", text: "乙" }],
      ],
    },
  ]);
});

test("列表层级超过 3 级：并入第 3 级并告警 list-depth-clamped（带行号）", () => {
  const { ctx, warnings } = makeCtx();
  const blocks = structureText(["- 一级", "        1. 深缩进", ""].join("\n"), ctx);
  const list = blocks[0];
  assert.equal(list.kind, "list");
  const nested = list.items[0].children[1];
  assert.equal(nested.kind, "list", "缩进 8 空格 → 原始层级 5 → 钳到第 3 级，挂在第 1 项下");
  assert.deepEqual(nested.items[0].children[0], { kind: "paragraph", children: [{ kind: "text", text: "深缩进" }] });
  assert.equal(warnings.filter((warning) => warning.code === "list-depth-clamped").length, 1);
  assert.equal(warnings[0].message, WARNING_MESSAGES["list-depth-clamped"]);
  assert.equal(warnings[0].line, 2);
});

test("列表项续行：缩进 ≥ 标记缩进+2 时按 CJK 规则拼接；缩进不足则结束列表", () => {
  const blocks = parse(["- 甲", "  续行一", "  续行二", "普通段落", ""].join("\n"));
  assert.deepEqual(shapes(blocks), [
    { kind: "list", ordered: false, start: 1, tight: true, items: [[{ kind: "paragraph", text: "甲续行一续行二" }]] },
    { kind: "paragraph", text: "普通段落" },
  ]);
});

// ---------------------------------------------------------------- 边界 3：混合

test("混合：标题/分隔线/列表/段落/引用样式原文", () => {
  const source = [
    "文档标题",
    "",
    "## 二级标题",
    "",
    "第一段。",
    "",
    "***",
    "",
    "1. 一",
    "2. 二",
    "",
    "> 引用样式的行按段落逐字保留",
    "",
  ].join("\n");
  assert.deepEqual(shapes(parse(source)), [
    { kind: "heading", level: 1, text: "文档标题" },
    { kind: "paragraph", text: "## 二级标题" },
    { kind: "paragraph", text: "第一段。" },
    { kind: "hr" },
    { kind: "list", ordered: true, start: 1, tight: true, items: [[{ kind: "paragraph", text: "一" }], [{ kind: "paragraph", text: "二" }]] },
    { kind: "paragraph", text: "> 引用样式的行按段落逐字保留" },
  ]);
});

test("中文序号（一、/（一）/第一章）不识别为标题或列表（仅首行标题规则不能套在它们身上）", () => {
  const blocks = parse(["标题行", "", "一、上季度观测小结", "", "（一）小项", "第一章 总则", ""].join("\n"));
  assert.equal(blocks.filter((block) => block.kind === "heading").length, 1, "只有首行标题是 H1");
  assert.equal(blocks.filter((block) => block.kind === "list").length, 0);
  assert.deepEqual(allTexts(blocks), ["标题行", "一、上季度观测小结", "（一）小项第一章 总则"]);
});

// ---------------------------------------------------------------- 边界 4：空文件

test("空文件 / 仅空白：无块 + no-heading-detected", () => {
  const { ctx, warnings } = makeCtx();
  assert.deepEqual(structureText("", ctx), []);
  assert.deepEqual(structureText("   \n\t\n\n", ctx), []);
  assert.equal(warnings.filter((warning) => warning.code === "no-heading-detected").length, 2);
});

test("连续 3 个空行不产生空段落", () => {
  // 首行以句末标点结尾 → 不命中首行标题规则，避免把 "甲" 变成 H1 干扰本用例
  const blocks = parse("甲。\n\n\n\n乙\n");
  assert.deepEqual(shapes(blocks), [
    { kind: "paragraph", text: "甲。" },
    { kind: "paragraph", text: "乙" },
  ]);
});

// ---------------------------------------------------------------- 边界 5：超长段落

test("超长段落：单行 5000 字不被截断、不成多段", () => {
  const long = "观测".repeat(2500);
  const blocks = parse(long + "\n");
  assert.equal(blocks.length, 1);
  assert.equal(textOf(blocks[0].children), long);
});

test("超长段落：500 行合并为 1 段且 CJK 直接相连", () => {
  const lines = Array.from({ length: 500 }, (_, index) => "第" + index + "行中文");
  const blocks = parse(lines.join("\n") + "\n");
  assert.equal(blocks.length, 1);
  const text = textOf(blocks[0].children);
  assert.equal(text.startsWith("第0行中文"), true);
  assert.equal(text.includes("中文第1行中文"), true, "CJK 相邻不加空格");
  assert.equal(text.split("行").length, 501);
});

test("超长段落：5600 字符的段落仍可解析且字符数不变（零改写）", () => {
  const long = "A".repeat(2800) + "。".repeat(1400) + "B".repeat(1400);
  const text = textOf(parse(long + "\n")[0].children);
  assert.equal(text.length, long.length);
  assert.equal(text, long);
});

// ---------------------------------------------------------------- 行拼接规则

test("共用拼接 joinSoftPair（REQ-MD-002 / REQ-TXT-002 同一函数）：CJK/全角相邻不加空格，否则恰一个空格", () => {
  assert.equal(joinSoftPair("中文", "下一行"), "中文下一行");
  assert.equal(joinSoftPair("中文。", "下一行"), "中文。下一行");
  assert.equal(joinSoftPair("abc", "def"), "abc def");
  assert.equal(joinSoftPair("中文", "abc"), "中文 abc");
  assert.equal(joinSoftPair("abc", "中文"), "abc 中文");
  assert.equal(joinSoftPair("", "中文"), "中文");
});

test("共用拼接 joinSoftLines：逐行裁剪并以 CJK 规则拼接", () => {
  assert.equal(joinSoftLines(["  第一行  ", "第二行  "]), "第一行第二行");
  assert.equal(joinSoftLines(["line one", "line two"]), "line one line two");
  assert.equal(joinSoftLines(["", "   ", "x"]), "x");
});

test("displayWidth：CJK 记 2 列、ASCII 记 1 列", () => {
  assert.equal(displayWidth("钓鱼笔记"), 8);
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中a"), 3);
});

// ---------------------------------------------------------------- 归一与确定

test("CRLF / CR 输入与 LF 结果一致", () => {
  const lf = parse("标题\n\n甲\n乙\n");
  assert.deepEqual(parse("标题\r\n\r\n甲\r\n乙\r\n"), lf);
  assert.deepEqual(parse("标题\r\r甲\r乙\r"), lf);
});

test("Tab 在缩进判定中按 4 空格：tab + 数字项成为第 3 级", () => {
  const blocks = parse(["- 父项", "\t1. 子项", ""].join("\n"));
  const nested = blocks[0].items[0].children[1];
  assert.equal(nested.kind, "list", "Tab → 4 空格 → 层级 1+floor(4/2)=3");
  assert.equal(nested.ordered, true);
  assert.equal(nested.start, 1);
  assert.deepEqual(nested.items[0].children[0], { kind: "paragraph", children: [{ kind: "text", text: "子项" }] });
});

test("首行标题宽度 > 60 列时不识别为标题", () => {
  const long = "标".repeat(31); // 62 列
  const blocks = parse(long + "\n\n正文\n");
  assert.equal(blocks[0].kind, "paragraph");
});

test("首行以句末标点结尾时不识别为标题", () => {
  const blocks = parse("这是一句话。\n\n正文\n");
  assert.equal(blocks[0].kind, "paragraph");
});

test("纯符号行 --- 在文首按分隔线处理（不被误判为 H1）", () => {
  assert.deepEqual(shapes(parse("---\n\n正文\n")), [
    { kind: "hr" },
    { kind: "paragraph", text: "正文" },
  ]);
});

test("bookmark 按标题出现顺序单调递增，_Toc0001 起（4 位十进制）", () => {
  const blocks = parse(["甲", "===", "", "乙", "---", "", "丙", "===", ""].join("\n"));
  const headings = blocks.filter((block) => block.kind === "heading");
  assert.deepEqual(headings.map((heading) => heading.bookmark), ["_Toc0001", "_Toc0002", "_Toc0003"]);
  assert.deepEqual(headings.map((heading) => heading.level), [1, 2, 1]);
  assert.deepEqual(headings.map((heading) => textOf(heading.children)), ["甲", "乙", "丙"]);
});

test("同输入两次输出完全一致（确定性）", () => {
  const source = [DEMO1, DEMO2, DEMO3, "- 甲", "  乙", ""].join("\n");
  assert.deepEqual(shape(parse(source)[0]), shape(parse(source)[0]));
  assert.equal(JSON.stringify(parse(source)), JSON.stringify(parse(source)));
});

test("零改写：非空白字符序列与原文一致（无列表标记的输入）", () => {
  const source = [DEMO1, "全角：，（）。！？", "半角: , ( ) . ! ?", "　", ""].join("\n");
  const emitted = allTexts(parse(source)).join("");
  assert.equal(emitted.replace(/\s+/g, ""), source.replace(/\s+/g, ""));
});
