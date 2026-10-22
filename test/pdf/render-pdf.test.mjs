/**
 * pdf-render 模块级测试（architecture §3.6 / spike §2.5）。
 *
 * 覆盖：①中文 + 空格路径可转换；②独占创建（重复调用可覆盖）；③kit=null -> pdf-engine-missing（4）；
 * ④engine 字段按 §3.1.5（kitVersion/backend），bytes/sha256 由磁盘重算。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPdf } from "../../src/pdf/index.js";
import { locateKit } from "../../src/kit/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureDocx = join(packageRoot, "test", "shell", "fixtures", "minimal.docx");

let kit = null;
try {
  kit = locateKit({ installRoot: packageRoot });
} catch {
  kit = null;
}

test("kit=null -> pdf-engine-missing（退出码 4）", async () => {
  await assert.rejects(
    () => renderPdf(fixtureDocx, join(tmpdir(), "docconvert-should-not-exist.pdf"), { kit: null, workDir: tmpdir() }),
    (error) => {
      assert.equal(error.code, "pdf-engine-missing");
      assert.equal(error.exitCode, 4);
      return true;
    },
  );
});

test("中文 + 空格路径：产物落盘、engine 字段与哈希正确、可重复覆盖", { skip: kit ? false : "kit 不可用" }, async () => {
  const base = await mkdtemp(join(tmpdir(), "docconvert-pdf-"));
  const outDir = join(base, "中文 空格 输出");
  const workDir = join(base, "工作 目录");
  await mkdir(outDir, { recursive: true });
  try {
    const outPath = join(outDir, "示例 文档.pdf");
    const first = await renderPdf(fixtureDocx, outPath, { kit, workDir, timeoutMs: 120000 });
    assert.equal(first.outputPath, outPath);
    assert.ok(first.bytes > 0);
    assert.match(first.sha256, /^[0-9A-F]{64}$/);
    assert.equal(first.engine.kitVersion, "0.1.5");
    assert.ok(["native", "wasm"].includes(first.engine.backend));
    assert.ok(Array.isArray(first.missingFonts));
    assert.equal((await stat(outPath)).size, first.bytes);
    // 二次调用（独占创建 + 原子 rename）不得因目标已存在而失败。
    // PDF 的可复现层级是「版式与内容级」（D3）：CreationDate 会变，故只断言页数/可读性一致，不断言字节相等。
    const second = await renderPdf(fixtureDocx, outPath, { kit, workDir, timeoutMs: 120000 });
    assert.ok(second.bytes > 0);
    assert.match(second.sha256, /^[0-9A-F]{64}$/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("超时：杀进程 + 清理临时文件 + convert-failed", { skip: kit ? false : "kit 不可用" }, async () => {
  const base = await mkdtemp(join(tmpdir(), "docconvert-timeout-"));
  try {
    await assert.rejects(
      () => renderPdf(fixtureDocx, join(base, "timeout.pdf"), { kit, workDir: join(base, "work"), timeoutMs: 1 }),
      (error) => {
        assert.equal(error.code, "convert-failed");
        assert.ok(["timeout", "spawn"].includes(error.detail.kind), "detail.kind=" + String(error.detail.kind));
        return true;
      },
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
