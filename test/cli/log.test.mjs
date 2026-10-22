import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFileRecord, buildRunRecord, writeConversionLog } from "../../src/log/index.js";

const REQUIRED_FILE_FIELDS = [
  "type", "schemaVersion", "program", "template", "pdfKit", "fonts", "command", "input",
  "outputs", "status", "errorCode", "warnings", "toc", "startedAt", "endedAt", "durationMs", "platform",
];

function sampleFileRecord() {
  return buildFileRecord({
    program: { name: "docconvert", version: "0.1.0" },
    template: { version: "ddb535e0a366" },
    pdfKit: { version: "0.1.5", engine: "0.1.5", backend: "native" },
    fonts: { latin: "Calibri", cjk: "微软雅黑", mono: "Consolas" },
    command: ["a.md", "-o", "out"],
    input: { path: "C:/x/a.md", bytes: 12, sha256: "ABCDEF", encoding: "utf-8", extension: ".md" },
    outputs: [{ format: "docx", path: "C:/x/out/a.docx", bytes: 100, sha256: "abc", durationMs: 5 }],
    status: "ok",
    errorCode: null,
    warnings: [{ code: "image-degraded", line: 3, message: "图片不可用" }],
    toc: { mode: "two-pass", entries: 2, passes: 1, converged: true },
    startedAt: "2026-10-22T09:00:00.000+08:00",
    endedAt: "2026-10-22T09:00:01.000+08:00",
    durationMs: 1000,
    platform: { os: "win32", arch: "x64", node: "v24.19.0" },
  });
}

test("buildFileRecord：§10.1 的 17 个字段齐全", () => {
  const record = sampleFileRecord();
  for (const field of REQUIRED_FILE_FIELDS) assert.ok(field in record, field);
  assert.equal(record.type, "file");
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.pdfKit.backend, "native");
  assert.deepEqual(record.outputs[0].sha256, "abc");
  assert.deepEqual(record.warnings[0], { code: "image-degraded", line: 3, message: "图片不可用" });
  assert.equal(record.toc.mode, "two-pass");
});

test("buildFileRecord：pdfKit 允许为 null（不产 PDF）", () => {
  const record = buildFileRecord({
    program: { name: "docconvert", version: "0.1.0" },
    template: { version: "ddb535e0a366" },
    pdfKit: null,
    fonts: { latin: "Calibri", cjk: "微软雅黑", mono: "Consolas" },
    command: ["a.md"],
    input: { path: "/a.md", bytes: 1, sha256: "x", encoding: "utf-8", extension: ".md" },
    outputs: [],
    status: "failed",
    errorCode: "empty-input",
    warnings: [],
    toc: { mode: "two-pass", entries: 0, passes: 1, converged: true },
    startedAt: "x",
    endedAt: "x",
    durationMs: 0,
    platform: { os: "win32", arch: "x64", node: "v24.19.0" },
  });
  assert.equal(record.pdfKit, null);
  assert.equal(record.status, "failed");
});

test("buildRunRecord：counts/exitCode/outdir/tocMode 齐备", () => {
  const record = buildRunRecord({
    program: { name: "docconvert", version: "0.1.0" },
    template: { version: "ddb535e0a366" },
    pdfKit: null,
    fonts: { latin: "Calibri", cjk: "微软雅黑", mono: "Consolas" },
    platform: { os: "win32", arch: "x64", node: "v24.19.0" },
    command: ["a.md"],
    startedAt: "2026-10-22T09:00:00.000+08:00",
    endedAt: "2026-10-22T09:00:01.000+08:00",
    durationMs: 1000,
    counts: { total: 2, ok: 1, failed: 1, skipped: 0 },
    exitCode: 5,
    outdir: "C:/out",
    tocMode: "two-pass",
  });
  assert.equal(record.type, "run");
  assert.deepEqual(record.counts, { total: 2, ok: 1, failed: 1, skipped: 0 });
  assert.equal(record.exitCode, 5);
  assert.equal(record.outdir, "C:/out");
  assert.equal(record.tocMode, "two-pass");
});

test("writeConversionLog：UTF-8 无 BOM、LF、每行一个 JSON；覆盖写（REQ-LOG-001）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "docconvert-log-"));
  const logPath = join(dir, "conversion-log.jsonl");
  try {
    await writeConversionLog([sampleFileRecord(), buildRunRecord({
      program: { name: "docconvert", version: "0.1.0" },
      template: { version: "ddb535e0a366" },
      pdfKit: null,
      fonts: { latin: "Calibri", cjk: "微软雅黑", mono: "Consolas" },
      platform: { os: "win32", arch: "x64", node: "v24.19.0" },
      command: ["a.md"],
      startedAt: "x", endedAt: "x", durationMs: 1,
      counts: { total: 1, ok: 1, failed: 0, skipped: 0 },
      exitCode: 0, outdir: "C:/out", tocMode: "two-pass",
    })], logPath);

    const buffer = await readFile(logPath);
    assert.notEqual(buffer[0], 0xef, "不得写 BOM");
    const text = buffer.toString("utf8");
    assert.ok(!text.includes("\r"), "不得使用 CRLF");
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).type, "file");
    assert.equal(JSON.parse(lines[1]).type, "run");

    // 第二次只写一条 run → 旧记录不得残留（truncate 语义）
    await writeConversionLog([{
      type: "run", schemaVersion: 1,
    }], logPath);
    const after = (await readFile(logPath, "utf8")).trim().split("\n");
    assert.equal(after.length, 1);
    assert.equal(JSON.parse(after[0]).type, "run");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeConversionLog：写入失败必须抛错（由 CLI 转 WARN，不得静默）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "docconvert-logfail-"));
  try {
    const blocker = join(dir, "file.txt");
    await writeFile(blocker, "x", "utf8");
    await assert.rejects(() => writeConversionLog([{ type: "run" }], join(blocker, "conversion-log.jsonl")));
    assert.ok((await stat(blocker)).isFile(), "阻塞文件未被破坏");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
