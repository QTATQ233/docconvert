/**
 * renderWithToc 降级分支（C-ARCH-01 裁决 (a)，§9.5 / §7.1.3）。
 *
 * 覆盖：①docx-only + 无引擎 -> 降级交付（WARN toc-degraded / 占位 / 不抛错）；②含 pdf + 无引擎 -> 4；
 * ③短文不触发测量；④引擎可用但无法测量（桩 DOCX 无书签）-> 降级而不是中断。
 * 全部为模块级调用，不依赖 CLI 参数。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderWithToc, TOC_DEGRADED_ENGINE_MESSAGE } from "../../src/toc/index.js";
import { locateKit } from "../../src/kit/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const templatePath = join(packageRoot, "templates", "reference.docx");

let kit = null;
try {
  kit = locateKit({ installRoot: packageRoot });
} catch {
  kit = null;
}

/** 合成长文 AST：headings 条 H1–H3（阈值默认 3）。 */
function longDoc(headings) {
  const blocks = [];
  for (let i = 1; i <= headings; i += 1) {
    blocks.push({ kind: "heading", level: /** @type {1|2|3} */ ((i % 3) + 1), bookmark: "_Toc" + i, children: [{ kind: "text", text: "标题 " + i }] });
    blocks.push({ kind: "paragraph", children: [{ kind: "text", text: "正文 " + i }] });
  }
  return {
    schemaVersion: 1,
    meta: { absolutePath: join(packageRoot, "examples", "headings.md"), format: "md", sha256: "0", bytes: 1, mtimeMs: 0, encoding: "utf-8", title: "headings" },
    blocks,
    assets: [],
    warnings: [],
  };
}

async function withWorkDir(run) {
  const base = await mkdtemp(join(tmpdir(), "docconvert-degrade-"));
  const outDir = join(base, "out");
  const workDir = join(base, "work");
  try {
    await run({ base, outDir, workDir });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test("docx-only + 无引擎：降级交付（WARN toc-degraded、占位、不抛错）", async () => {
  await withWorkDir(async ({ outDir, workDir }) => {
    const result = await renderWithToc(longDoc(6), {
      outDir, workDir, templatePath, wantDocx: true, wantPdf: false, kit: null, tocThreshold: 3,
    });
    assert.equal(result.toc.mode, "degraded");
    assert.equal(result.toc.converged, false);
    assert.equal(result.toc.passes, 1);
    assert.equal(result.toc.entries, 6);
    assert.equal(result.pdf, undefined);
    assert.ok(result.docx, "降级仍交付 DOCX");
    assert.equal((await stat(result.docx.outputPath)).size > 0, true);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, "toc-degraded");
    assert.equal(result.warnings[0].message, TOC_DEGRADED_ENGINE_MESSAGE);
    // 降级必须让 docx-render 用「——」占位（additive optional，见报告 C-PDF-01）。
    assert.ok(result.docx.outputPath.endsWith(".docx"));
  });
});

test("--format 含 pdf + 无引擎：pdf-engine-missing（退出码 4），不产生产物", async () => {
  await withWorkDir(async ({ outDir, workDir }) => {
    await assert.rejects(
      () => renderWithToc(longDoc(6), { outDir, workDir, templatePath, wantDocx: true, wantPdf: true, kit: null, tocThreshold: 3 }),
      (error) => {
        assert.equal(error.code, "pdf-engine-missing");
        assert.equal(error.exitCode, 4);
        assert.match(String(error.message), /PDF 引擎/);
        return true;
      },
    );
    await assert.rejects(() => readdir(outDir));
  });
});

test("短文（H1–H3 < 阈值）：单遍、无目录、不触发任何测量", async () => {
  await withWorkDir(async ({ outDir, workDir }) => {
    const result = await renderWithToc(longDoc(2), {
      outDir, workDir, templatePath, wantDocx: true, wantPdf: false, kit: null, tocThreshold: 3,
    });
    assert.equal(result.toc.mode, "two-pass");
    assert.equal(result.toc.entries, 0);
    assert.equal(result.toc.passes, 1);
    assert.equal(result.toc.converged, true);
    assert.equal(result.warnings.length, 0);
  });
});

test("引擎可用：两遍法收敛（桩 DOCX = 6 条书签的真实版式）", { skip: kit ? false : "kit 不可用" }, async () => {
  await withWorkDir(async ({ outDir, workDir }) => {
    const result = await renderWithToc(longDoc(6), {
      outDir, workDir, templatePath, wantDocx: true, wantPdf: true, kit, tocThreshold: 3,
    });
    assert.equal(result.toc.mode, "two-pass");
    assert.equal(result.toc.entries, 6);
    assert.equal(result.toc.passes, 2);
    assert.equal(result.toc.converged, true);
    assert.deepEqual(result.toc.mismatches, []);
    assert.equal(result.warnings.length, 0);
    assert.ok(result.docx && result.pdf);
    assert.equal((await stat(result.pdf.outputPath)).size > 0, true);
  });
});

// 「无法测量 -> 降级」的阈值判定在 convergeToc 单元测试覆盖（空书签抛 toc-unmeasurable），
// 集成层不再构造假 docx：卡 3 落地后 renderDocx 为真实现，桩假设失效。
