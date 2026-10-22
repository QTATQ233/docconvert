import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../../src/cli/index.js";
import { DocconvertError } from "../../src/contracts/errors.js";

/** @param {string[]} argv */
function errOf(argv) {
  try {
    parseArgs(argv);
  } catch (error) {
    return error;
  }
  throw new Error("本应抛错但解析成功");
}

test("parseArgs：缺省值（both / 非递归 / 不继续 / 无 outdir）", () => {
  const options = parseArgs(["a.md"]);
  assert.deepEqual(options.inputs, ["a.md"]);
  assert.deepEqual(options.formats, ["docx", "pdf"]);
  assert.equal(options.outDir, "");
  assert.equal(options.recursive, false);
  assert.equal(options.continueOnError, false);
  assert.equal(options.help, false);
  assert.equal(options.version, false);
});

test("parseArgs：全部允许选项", () => {
  const options = parseArgs(["-o", "out dir", "-r", "--format", "docx", "--continue-on-error", "a.md", "b.txt"]);
  assert.deepEqual(options.inputs, ["a.md", "b.txt"]);
  assert.equal(options.outDir, "out dir");
  assert.equal(options.recursive, true);
  assert.deepEqual(options.formats, ["docx"]);
  assert.equal(options.continueOnError, true);
});

test("parseArgs：--format pdf/both 与重复选项最后一个生效（REQ-CLI-008）", () => {
  assert.deepEqual(parseArgs(["--format", "pdf", "a.md"]).formats, ["pdf"]);
  assert.deepEqual(parseArgs(["--format", "docx", "--format", "both", "a.md"]).formats, ["docx", "pdf"]);
});

test("parseArgs：-- 之后按位置参数处理", () => {
  const options = parseArgs(["--", "--not-an-option.md"]);
  assert.deepEqual(options.inputs, ["--not-an-option.md"]);
});

test("parseArgs：--outdir= / --format= 内联取值", () => {
  const options = parseArgs(["--outdir=out/x", "--format=both", "a.md"]);
  assert.equal(options.outDir, "out/x");
  assert.deepEqual(options.formats, ["docx", "pdf"]);
});

test("parseArgs：--help / --version 允许无输入且退出 0", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-V"]).version, true);
});

test("parseArgs：未知选项 → usage-error / 2", () => {
  const error = errOf(["--bogus", "a.md"]);
  assert.ok(error instanceof DocconvertError);
  assert.equal(error.code, "usage-error");
  assert.equal(error.exitCode, 2);
});

test("parseArgs：禁止的覆盖类参数一律 usage-error / 2（REQ-CLI-003）", () => {
  for (const flag of ["--font", "--margin", "--color", "--template", "--reference", "--theme", "--page-size", "--engine", "--jobs", "--log", "--encoding"]) {
    const error = errOf(["a.md", flag, "x"]);
    assert.equal(error.code, "usage-error", flag);
    assert.equal(error.exitCode, 2, flag);
  }
});

test("parseArgs：缺输入 / 非法 --format / -o 缺值 → usage-error / 2", () => {
  assert.equal(errOf([]).code, "usage-error");
  assert.equal(errOf(["a.md", "--format", "html"]).code, "usage-error");
  assert.equal(errOf(["a.md", "-o"]).code, "usage-error");
  assert.equal(errOf(["a.md", "-o", ""]).code, "usage-error");
});
