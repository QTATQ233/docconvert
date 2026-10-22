/**
 * TC-TOC-02（P0）：分页漂移 -> 重试一次 -> 显式告警。模块级测试（D-003：禁止 CLI/环境后门）。
 *
 * 运行：node --test --test-isolation=none test/toc/
 * 覆盖：run1 收敛 / run2 首轮漂移后重试一次收敛 / run3 持续漂移 -> converged=false + 告警码 /
 *       C1 页数不稳 / C3 页码不符 / planTocNumbers 过滤 level<=2 与条数不一致抛错。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { convergeToc, planTocNumbers, verifyTocConvergence, tocNotConvergedWarning, TOC_NOT_CONVERGED_MESSAGE } from "../../src/toc/index.js";

/**
 * 合成 outline（level 为 0-based：H1=0 / H2=1 / H3=2）。
 * @param {number[]} pages
 * @param {{ pageCount?: number, extraLevel?: number }} [options]
 * @returns {import("../../src/contracts/index.js").PdfOutline}
 */
function outlineOf(pages, options = {}) {
  const entries = pages.map((page, index) => ({
    order: index + 1,
    level: options.extraLevel === undefined ? index % 3 : options.extraLevel,
    title: "标题 " + String(index + 1),
    page,
  }));
  return { pageCount: options.pageCount ?? Math.max(...pages, 1), entries };
}

/**
 * @param {number} count
 * @returns {Array<import("../../src/contracts/index.js").TocEntry>}
 */
function entriesOf(count) {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    level: /** @type {1|2|3} */ ((index % 3) + 1),
    text: "标题 " + String(index + 1),
    bookmark: "_Toc" + String(index + 1),
  }));
}

test("run1 两遍一致 -> converged=true、retries=0、恰好调用 measure 两次", async () => {
  const pages = [4, 4, 6, 9, 9];
  const entries = entriesOf(pages.length);
  const calls = [];
  const measure = async (numbers) => {
    calls.push(numbers);
    return { outline: outlineOf(pages, { pageCount: 9 }) };
  };
  const result = await convergeToc(measure, entries);
  assert.equal(result.converged, true);
  assert.equal(result.retries, 0);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], null);
  assert.deepEqual(calls[1], pages);
  assert.deepEqual(result.numbers, pages);
});

test("run2 首轮漂移 -> 只重试一次（总调用 3 次）后收敛", async () => {
  const pass1 = [4, 4, 6, 9];
  const drifted = [4, 5, 6, 9]; // 首轮回填后分页漂移：第 2 条落到第 5 页
  const retried = [4, 5, 6, 9]; // 用 drifted 重算页码后再次导出，分页与页码一致
  const entries = entriesOf(pass1.length);
  const calls = [];
  const measure = async (numbers) => {
    calls.push(numbers);
    if (calls.length === 1) return { outline: outlineOf(pass1, { pageCount: 9 }) };
    if (calls.length === 2) return { outline: outlineOf(drifted, { pageCount: 10 }) };
    return { outline: outlineOf(retried, { pageCount: 10 }) };
  };
  const result = await convergeToc(measure, entries);
  assert.equal(calls.length, 3, "最多重试一次：1 次测量 + 1 次回填 + 1 次重试");
  assert.equal(result.converged, true);
  assert.equal(result.retries, 1);
  assert.deepEqual(result.numbers, drifted, "重试使用第二次 outline 重新计算的页码");
});

test("run3 持续漂移 -> converged=false、mismatches 非空、告警码 toc-not-converged、退出码语义不抛错", async () => {
  const entries = entriesOf(3);
  let calls = 0;
  const measure = async () => {
    calls += 1;
    // 每轮都偏移 1 页，永不收敛。
    return { outline: outlineOf([4 + calls, 4 + calls, 6 + calls], { pageCount: 10 }) };
  };
  const result = await convergeToc(measure, entries);
  assert.equal(calls, 3, "首轮 + 回填 + 重试一次后放弃");
  assert.equal(result.converged, false);
  assert.equal(result.retries, 1);
  assert.ok(result.mismatches.length > 0);
  const warning = tocNotConvergedWarning(result.mismatches, entries);
  assert.equal(warning.code, "toc-not-converged");
  assert.ok(warning.message.startsWith(TOC_NOT_CONVERGED_MESSAGE));
  assert.match(warning.message, /第 1 条 /);
});

test("C1 页数不稳 -> converged=false（即使页码对得上）", () => {
  const a = outlineOf([4, 6], { pageCount: 8 });
  const b = outlineOf([4, 6], { pageCount: 9 });
  const check = verifyTocConvergence(a, b, [4, 6]);
  assert.equal(check.pageCountStable, false);
  assert.equal(check.converged, false);
});

test("C2 书签页序漂移 -> converged=false 且记录差异", () => {
  const a = outlineOf([4, 6, 8]);
  const b = outlineOf([4, 7, 8]);
  const check = verifyTocConvergence(a, b, [4, 6, 8]);
  assert.equal(check.converged, false);
  assert.equal(check.mismatches.length, 1);
  assert.deepEqual(check.mismatches[0], { index: 2, expected: 6, actual: 7, title: "标题 2" });
});

test("C3 回填页码与实测不符 -> converged=false", () => {
  const a = outlineOf([4, 6]);
  const b = outlineOf([4, 6]);
  const check = verifyTocConvergence(a, b, [4, 5]);
  assert.equal(check.converged, false);
  assert.deepEqual(check.mismatches.map((item) => item.index), [2]);
});

test("planTocNumbers 只取 level<=2（H4-H6 不进目录）", () => {
  const outline = {
    pageCount: 5,
    entries: [
      { order: 1, level: 0, title: "H1", page: 1 },
      { order: 2, level: 1, title: "H2", page: 2 },
      { order: 3, level: 2, title: "H3", page: 3 },
      { order: 4, level: 3, title: "H4 只进书签", page: 4 },
      { order: 5, level: 4, title: "H5 只进书签", page: 5 },
    ],
  };
  const entries = entriesOf(3);
  assert.deepEqual(planTocNumbers(outline, entries), [1, 2, 3]);
});

test("C4 条目数不一致 -> 抛 convert-failed（detail.kind=toc-count-mismatch）", () => {
  const outline = outlineOf([1, 2, 3]);
  assert.throws(
    () => planTocNumbers(outline, entriesOf(2)),
    (error) => {
      assert.equal(error.code, "convert-failed");
      assert.equal(error.detail.kind, "toc-count-mismatch");
      assert.equal(error.exitCode, 5);
      return true;
    },
  );
});

test("无书签（空 outline）-> 抛 convert-failed（可降级到 toc-degraded）", async () => {
  const entries = entriesOf(2);
  await assert.rejects(
    () => convergeToc(async () => ({ outline: { pageCount: 1, entries: [] } }), entries),
    (error) => {
      assert.equal(error.code, "convert-failed");
      assert.equal(error.detail.kind, "toc-unmeasurable");
      return true;
    },
  );
});
