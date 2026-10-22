import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_KEYS,
  REQUIRED_STYLE_IDS,
  flattenConfig,
  loadConfig,
  parseYamlSubset,
  valueAt,
  verifyTemplateConsistency,
} from "../../src/config/index.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("YAML 子集：嵌套映射、标量、行内数组、注释", () => {
  const parsed = parseYamlSubset([
    "# 注释行被忽略",
    "page:",
    "  size: A4",
    "  margins:",
    "    top: 2.2",
    "fonts:",
    "  cjk: 微软雅黑",
    "  latinFallback: [Carlito, Arial]",
    "layout:",
    "  h1PageBreak: true",
    "  longdocHeadingThreshold: 3",
    "colors:",
    '  link: "0563C1"   # 行尾注释',
  ].join("\n"));
  assert.equal(parsed.page.size, "A4");
  assert.equal(parsed.page.margins.top, 2.2);
  assert.equal(parsed.fonts.cjk, "微软雅黑");
  assert.deepEqual(parsed.fonts.latinFallback, ["Carlito", "Arial"]);
  assert.equal(parsed.layout.h1PageBreak, true);
  assert.equal(parsed.layout.longdocHeadingThreshold, 3);
  assert.equal(parsed.colors.link, "0563C1");

  const flat = flattenConfig(parsed);
  assert.equal(flat.get("page.margins.top"), 2.2);
  assert.equal(valueAt(parsed, "page.margins.top"), 2.2);
  assert.equal(valueAt(parsed, "missing.key"), undefined);
});

test("随包 config/default.yml：白名单键齐全且取值符合 §4.4", async () => {
  const { config, flat } = await loadConfig({ packageRoot: PACKAGE_ROOT });
  assert.equal(valueAt(config, "page.size"), "A4");
  assert.equal(valueAt(config, "sizes.body"), 12);
  assert.equal(valueAt(config, "sizes.table"), 8.5);
  assert.equal(valueAt(config, "layout.longdocHeadingThreshold"), 3);
  assert.equal(valueAt(config, "output.dirName"), "docconvert-out");
  assert.equal(valueAt(config, "log.fileName"), "conversion-log.jsonl");
  assert.deepEqual(valueAt(config, "table.cellPaddingTwips"), [30, 60, 30, 60]);
  for (const key of flat.keys()) assert.ok(ALLOWED_KEYS.has(key), key);
});

test("白名单外的键 → template-missing（REQ-TPL-005）", async () => {
  const root = await mkdtemp(join(tmpdir(), "docconvert-cfg-"));
  try {
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config", "default.yml"), "page:\n  size: A4\n  bogusKey: 1\n", "utf8");
    await assert.rejects(() => loadConfig({ packageRoot: root }), (error) => {
      assert.equal(error.code, "template-missing");
      assert.equal(error.exitCode, 4);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("黑名单值 → template-missing（REQ-TPL-006）", async () => {
  const root = await mkdtemp(join(tmpdir(), "docconvert-cfg-"));
  try {
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config", "default.yml"), "colors:\n  link: \"https://example.invalid/x\"\n", "utf8");
    await assert.rejects(() => loadConfig({ packageRoot: root }), (error) => {
      assert.equal(error.code, "template-missing");
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("配置缺失 → template-missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "docconvert-cfg-"));
  try {
    await assert.rejects(() => loadConfig({ packageRoot: root }), (error) => {
      assert.equal(error.code, "template-missing");
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("双源一致性：模板 w:sz 与 config pt×2 比对（§4.6）", async () => {
  const { config } = await loadConfig({ packageRoot: PACKAGE_ROOT });
  const styles = new Map([
    ["Normal", { sz: 24 }],
    ["Heading1", { sz: 36 }],
    ["Heading2", { sz: 99 }],
  ]);
  const result = verifyTemplateConsistency({ config, styles });
  assert.equal(result.compared, 3);
  assert.equal(result.mismatches.length, 1);
  assert.deepEqual(result.mismatches[0], { styleId: "Heading2", key: "sizes.h2", expected: 30, actual: 99 });
});

test("架构 §4.3 要求的 16 个样式 ID 已登记", () => {
  assert.equal(REQUIRED_STYLE_IDS.length, 16);
  for (const id of ["Normal", "Heading1", "Heading6", "DocTitle", "TOC1", "TOC3", "CodeBlock", "TableText", "Quote", "FooterText", "CharacterInlineCode"]) {
    assert.ok(REQUIRED_STYLE_IDS.includes(id), id);
  }
});
