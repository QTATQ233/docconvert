#!/usr/bin/env node
/**
 * 阶段 2.0 失败路径补充验证（不经 CLI，直接验证模块的错误映射）：
 *   E1 renderPdf：非法 DOCX → kit 返回失败 → DocconvertError(convert-failed, exitCode 5)
 *   E2 renderPdf：引擎 unavailable 映射为 pdf-engine-missing（用损坏的 cli 路径无法伪造，改为未提供 kit）
 *   E3 writeConversionLog：目标父路径是文件 → 抛错（由 CLI 捕获为 WARN log-write-failed）
 *
 * 用法：node test/shell/check-error-paths.mjs
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DocconvertError } from "../../src/contracts/errors.js";
import { locateKit } from "../../src/kit/index.js";
import { renderPdf } from "../../src/pdf/index.js";
import { writeConversionLog } from "../../src/log/index.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    passed += 1;
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name} — ${error && error.message ? error.message : error}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const workDir = await mkdtemp(join(tmpdir(), "docconvert-errpaths-"));

try {
  await check("E1 非法 DOCX → convert-failed / 退出码 5", async () => {
    const kit = locateKit({ installRoot: ROOT });
    const badDocx = join(workDir, "not-a-docx.docx");
    await writeFile(badDocx, "这不是 DOCX，只是一个文本文件。\n", "utf8");
    try {
      await renderPdf(badDocx, join(workDir, "out.pdf"), { kit, workDir, timeoutMs: 60000 });
      throw new Error("本应抛错但返回了结果");
    } catch (error) {
      assert(error instanceof DocconvertError, "错误类型不是 DocconvertError");
      assert(error.code === "convert-failed", `错误码=${error.code}`);
      assert(error.exitCode === 5, `退出码=${error.exitCode}`);
      return `code=${error.code}, exit=${error.exitCode}, kitCode=${error.detail?.kitCode}`;
    }
  });

  await check("E2 未提供 kit → pdf-engine-missing / 退出码 4", async () => {
    try {
      await renderPdf(join(workDir, "x.docx"), join(workDir, "x.pdf"), { kit: null, workDir });
      throw new Error("本应抛错但返回了结果");
    } catch (error) {
      assert(error instanceof DocconvertError, "错误类型不是 DocconvertError");
      assert(error.code === "pdf-engine-missing" && error.exitCode === 4, `code=${error.code}, exit=${error.exitCode}`);
      return `code=${error.code}, exit=${error.exitCode}`;
    }
  });

  await check("E3 日志写入失败会抛错（不静默）", async () => {
    const blocker = join(workDir, "blocker");
    await mkdir(blocker, { recursive: true });
    const fileAsParent = join(blocker, "file.txt");
    await writeFile(fileAsParent, "x", "utf8");
    try {
      await writeConversionLog([{ type: "run" }], join(fileAsParent, "conversion-log.jsonl"));
      throw new Error("本应抛错但返回了结果");
    } catch (error) {
      assert(!(error instanceof Error && error.message === "本应抛错但返回了结果"), "写入意外成功");
      return "writeConversionLog 抛错，供 cli 转 WARN log-write-failed";
    }
  });
} finally {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n# 结果：PASS ${passed} / FAIL ${failed}`);
if (failed > 0) process.exitCode = 1;
