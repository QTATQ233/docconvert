/**
 * CLI 端到端测试（node:test）：真实子进程 + 真实文件系统 + 真实 kit。
 *
 * 子进程输出用文件重定向捕获（src/cli/spawn-capture.js）：本机沙箱禁止 Node 管道 stdio。
 * PDF 相关用例会真实调用 LibreOffice Kit（单文件约 2–3 s）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProcess } from "../../src/cli/spawn-capture.js";
import { readZipFile } from "../../src/cli/zip.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BIN = join(ROOT, "bin", "docconvert.js");
const FORBIDDEN = ["--font", "--margin", "--color", "--template", "--reference", "--theme", "--page-size", "--engine", "--jobs", "--log", "--encoding"];

async function runCliProcess(args, options = {}) {
  const result = await captureProcess(process.execPath, [BIN, ...args], {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    timeoutMs: 180000,
  });
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    timedOut: result.timedOut,
  };
}

async function workDir(t, prefix = "docconvert-e2e-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return dir;
}

async function files(dir) {
  return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function readLog(dir) {
  const text = await readFile(join(dir, "conversion-log.jsonl"), "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const REQUIRED_FILE_FIELDS = [
  "type", "schemaVersion", "program", "template", "pdfKit", "fonts", "command", "input",
  "outputs", "status", "errorCode", "warnings", "toc", "startedAt", "endedAt", "durationMs", "platform",
];

test("一条命令双产出：docx + pdf + 日志，stdout 只有进度/汇总（TC-LOG-01 / REQ-BATCH-006）", async (t) => {
  const out = await workDir(t);
  const result = await runCliProcess([join("test", "cli", "fixtures", "short.md"), "-o", out]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await files(out), ["conversion-log.jsonl", "short.docx", "short.pdf"]);

  // stdout 只允许 OK/FAIL/SKIP/SUMMARY/FAILED/OUTPUT；WARN/ERROR 必须走 stderr
  assert.ok(!/\b(WARN|ERROR)\b/.test(result.stdout), result.stdout);
  assert.equal(result.stderr.trim(), "");
  assert.match(result.stdout, /^OK /m);
  assert.match(result.stdout, /^SUMMARY total=1 ok=1 failed=0 skipped=0 elapsed=\d+\.\ds$/m);
  assert.match(result.stdout, /^OUTPUT /m);

  const records = await readLog(out);
  assert.equal(records.length, 2);
  const fileRecord = records[0];
  const runRecord = records[1];
  assert.equal(fileRecord.type, "file");
  for (const field of REQUIRED_FILE_FIELDS) assert.ok(field in fileRecord, field);
  assert.equal(fileRecord.status, "ok");
  assert.equal(fileRecord.toc.mode, "two-pass");
  assert.equal(fileRecord.pdfKit.version, "0.1.5");
  assert.equal(fileRecord.pdfKit.backend, "native");

  // 产物哈希由磁盘重算且为小写（TC-LOG-01 要求）
  for (const output of fileRecord.outputs) {
    assert.equal(output.sha256, await sha256(output.path), output.path);
    assert.equal(output.bytes, (await stat(output.path)).size);
    assert.equal(output.sha256, output.sha256.toLowerCase());
  }
  assert.deepEqual(fileRecord.outputs.map((item) => item.format).sort(), ["docx", "pdf"]);

  // run 记录与 SUMMARY 一致
  assert.equal(runRecord.type, "run");
  assert.deepEqual(runRecord.counts, { total: 1, ok: 1, failed: 0, skipped: 0 });
  assert.equal(runRecord.exitCode, 0);
  assert.equal(runRecord.tocMode, "two-pass");
  assert.equal(runRecord.outdir, out);
});

test("--format docx / --format pdf 各自只出对应格式，临时 docx 不落 outdir", async (t) => {
  const shortDoc = join("test", "cli", "fixtures", "short.md");
  const docxOut = await workDir(t);
  const docxRun = await runCliProcess([shortDoc, "-o", docxOut, "--format", "docx"]);
  assert.equal(docxRun.code, 0, docxRun.stderr);
  assert.deepEqual(await files(docxOut), ["conversion-log.jsonl", "short.docx"]);
  const docxLog = await readLog(docxOut);
  assert.equal(docxLog[0].pdfKit, null);
  assert.equal(docxLog[0].outputs.length, 1);

  const pdfOut = await workDir(t);
  const pdfRun = await runCliProcess([shortDoc, "-o", pdfOut, "--format", "pdf"]);
  assert.equal(pdfRun.code, 0, pdfRun.stderr);
  assert.deepEqual(await files(pdfOut), ["conversion-log.jsonl", "short.pdf"]);
});

test("--version 七行固定键序；--help 六要素且不含禁止参数（TC-CLI-01/02）", async () => {
  const version = await runCliProcess(["--version"]);
  assert.equal(version.code, 0);
  const versionLines = version.stdout.trim().split("\n");
  assert.equal(versionLines.length, 7);
  assert.deepEqual(versionLines.map((line) => line.split(":")[0]), ["docconvert", "node", "template", "pdf-kit", "pdf-engine", "toc", "fonts"]);
  assert.match(version.stdout, /^toc: two-pass$/m);
  assert.match(version.stdout, /^pdf-engine: 0\.1\.5 \(native\)$/m);
  assert.match(version.stdout, /^template: [0-9a-f]{12}$/m);

  const help = await runCliProcess(["--help"]);
  assert.equal(help.code, 0);
  for (const fragment of ["用法", "选项", "-o, --outdir", "--format", ".md .txt", "docconvert-out", "退出码", "docconvert a.md"]) {
    assert.ok(help.stdout.includes(fragment), fragment);
  }
  for (const flag of FORBIDDEN) assert.ok(!help.stdout.includes(flag), flag);
});

test("错误码实测：2（参数）/ 3（输入）/ 4（引擎）/ 无堆栈（TC-CLI-01/03）", async (t) => {
  const out = await workDir(t);

  const missing = await runCliProcess([join("examples", "errors", "does-not-exist.md"), "-o", out]);
  assert.equal(missing.code, 3);
  assert.match(missing.stderr, /^ERROR input-not-found: /m);
  assert.match(missing.stderr, /^hint: /m);
  assert.ok(!/^\s+at /m.test(missing.stderr), "不得打印堆栈");
  assert.equal(missing.stdout.includes("ERROR"), false);

  const unsupported = await runCliProcess([join("examples", "errors", "unsupported.txt.bin"), "-o", out]);
  assert.equal(unsupported.code, 3);
  assert.match(unsupported.stderr, /^ERROR unsupported-extension: /m);

  const empty = await runCliProcess([join("examples", "errors", "empty.md"), "-o", out]);
  assert.equal(empty.code, 3);
  assert.match(empty.stderr, /^ERROR empty-input: /m);

  const unknown = await runCliProcess(["examples/cjk.md", "--bogus"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /^ERROR usage-error: /m);

  const badFormat = await runCliProcess(["examples/cjk.md", "--format", "html"]);
  assert.equal(badFormat.code, 2);
  assert.match(badFormat.stderr, /^ERROR usage-error: /m);

  const outdirIsFile = await workDir(t);
  const blocker = join(outdirIsFile, "blocked.txt");
  await writeFile(blocker, "x", "utf8");
  const outdirError = await runCliProcess(["examples/cjk.md", "-o", blocker]);
  assert.equal(outdirError.code, 2);
  assert.match(outdirError.stderr, /^ERROR usage-error: /m);

  const badKit = await runCliProcess([join("examples", "cjk.md"), "-o", join(out, "badkit")], {
    env: { ...process.env, DOCONVERT_LIBREOFFICE_KIT: join(out, "no-such-kit") },
  });
  assert.equal(badKit.code, 4);
  assert.match(badKit.stderr, /^ERROR pdf-engine-missing: /m);
  assert.match(badKit.stderr, /DOCONVERT_LIBREOFFICE_KIT/);
  assert.match(badKit.stderr, /^hint: /m);

  // 编码不可识别：UTF-8 与 GB18030 严格解码都失败 → decode-error / 3
  const decodeDir = await workDir(t);
  const badBytes = join(decodeDir, "bad-encoding.md");
  await writeFile(badBytes, Buffer.from([0xff, 0xfe, 0xff, 0x00]));
  const decode = await runCliProcess([badBytes, "-o", join(decodeDir, "out")]);
  assert.equal(decode.code, 3);
  assert.match(decode.stderr, /^ERROR decode-error: /m);

  // 输出目录不可创建 → output-not-writable / 4
  const blocked = await workDir(t);
  const fileBlocker = join(blocked, "file.txt");
  await writeFile(fileBlocker, "x", "utf8");
  const notWritable = await runCliProcess([join("test", "cli", "fixtures", "short.md"), "-o", join(fileBlocker, "sub")]);
  assert.equal(notWritable.code, 4);
  assert.match(notWritable.stderr, /^ERROR output-not-writable: /m);
});

test("输出冲突预检：退出 2、不写任何产物（TC-BAT-02）", async (t) => {
  const out = await workDir(t);
  const conflictDir = join(ROOT, "test", "cli", "fixtures", "conflict");
  const result = await runCliProcess([conflictDir, "-o", join(out, "conflict-out")]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^ERROR output-conflict: /m);
  const target = join(out, "conflict-out");
  const entries = await readdir(target).catch(() => []);
  assert.deepEqual(entries, []);
});

test("批处理：--continue-on-error 继续处理、汇总正确、退出非 0（TC-BAT-01/02）", async (t) => {
  const out = await workDir(t);
  const batchDir = join(ROOT, "test", "cli", "fixtures", "batch");
  const result = await runCliProcess([batchDir, "-o", out, "--continue-on-error"]);
  assert.equal(result.code, 3);
  assert.match(result.stdout, /^SUMMARY total=3 ok=2 failed=1 skipped=0 elapsed=\d+\.\ds$/m);
  const names = await files(out);
  assert.ok(names.includes("a-good.docx"));
  assert.ok(names.includes("c-good.docx"));
  assert.ok(!names.includes("b-empty.docx"));
  const records = await readLog(out);
  const fileRecords = records.filter((record) => record.type === "file");
  assert.equal(fileRecords.length, 3);
  assert.equal(fileRecords.filter((record) => record.status === "ok").length, 2);
  const failed = fileRecords.find((record) => record.status === "failed");
  assert.equal(failed.errorCode, "empty-input");
  assert.equal(failed.toc.mode, "two-pass");
});

test("批处理：默认快速失败，未处理文件记 skipped（REQ-BATCH-003）", async (t) => {
  const out = await workDir(t);
  const batchDir = join(ROOT, "test", "cli", "fixtures", "batch");
  const result = await runCliProcess([batchDir, "-o", out]);
  assert.equal(result.code, 3);
  assert.match(result.stdout, /^SUMMARY total=3 ok=1 failed=1 skipped=1 elapsed=\d+\.\ds$/m);
  const records = await readLog(out);
  const skipped = records.filter((record) => record.type === "file" && record.status === "skipped");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].errorCode, null);
  assert.ok(!(await files(out)).includes("c-good.docx"));
});

test("缺少 PDF 引擎：both → 4 且无产物；docx-only → 0 且有 docx（REQ-DEP-001 / C-ARCH-01 (a)）", async (t) => {
  const emptyHome = await workDir(t, "docconvert-nokit-");
  const env = {
    ...process.env,
    LOCALAPPDATA: emptyHome,
    APPDATA: emptyHome,
    USERPROFILE: emptyHome,
    HOMEDRIVE: "",
    HOMEPATH: "",
    DOCONVERT_LIBREOFFICE_KIT: "",
  };

  const both = await workDir(t);
  const bothRun = await runCliProcess([join("examples", "cjk.md"), "-o", both], { env });
  assert.equal(bothRun.code, 4);
  assert.match(bothRun.stderr, /^ERROR pdf-engine-missing: /m);
  const bothProducts = (await files(both)).filter((name) => name.endsWith(".docx") || name.endsWith(".pdf"));
  assert.deepEqual(bothProducts, []);

  const docxOnly = await workDir(t);
  const docxRun = await runCliProcess([join("examples", "cjk.md"), "-o", docxOnly, "--format", "docx"], { env });
  assert.equal(docxRun.code, 0, docxRun.stderr);
  assert.deepEqual(await files(docxOnly), ["cjk.docx", "conversion-log.jsonl"]);
});

test("幂等：同样输入重复运行 docx SHA 不变，日志覆盖写（REQ-BATCH-009 / REQ-LOG-001）", async (t) => {
  const out = await workDir(t);
  const shortDoc = join("test", "cli", "fixtures", "short.md");
  const first = await runCliProcess([shortDoc, "-o", out, "--format", "docx"]);
  assert.equal(first.code, 0, first.stderr);
  const firstSha = await sha256(join(out, "short.docx"));
  const second = await runCliProcess([shortDoc, "-o", out, "--format", "docx"]);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(await sha256(join(out, "short.docx")), firstSha);
  const records = await readLog(out);
  assert.equal(records.filter((record) => record.type === "file").length, 1);
});

test("中文与空格路径全链路成功（REQ-PLAT-001）", async (t) => {
  const out = await workDir(t);
  const outDir = join(out, "中文 输出 目录");
  const input = join(ROOT, "test", "cli", "fixtures", "中文 空格", "示例 文档.md");
  const result = await runCliProcess([input, "-o", outDir]);
  assert.equal(result.code, 0, result.stderr);
  const names = await files(outDir);
  assert.ok(names.includes("示例 文档.docx"));
  assert.ok(names.includes("示例 文档.pdf"));
});

test("日志写盘失败：WARN 但产物保留、退出码不变（REQ-LOG-005 备注）", async (t) => {
  const out = await workDir(t);
  await mkdir(join(out, "conversion-log.jsonl"), { recursive: true });
  const result = await runCliProcess([join("test", "cli", "fixtures", "short.md"), "-o", out, "--format", "docx"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /^WARN log-write-failed: /m);
  const names = await files(out);
  assert.ok(names.includes("short.docx"));
});

test("长文 + 仅 docx + 引擎不可用：降级交付 docx、WARN toc-degraded、退出 0（C-ARCH-01 (a)）", async (t) => {
  const emptyHome = await workDir(t, "docconvert-nokit-");
  const out = await workDir(t);
  const env = {
    ...process.env,
    LOCALAPPDATA: emptyHome,
    APPDATA: emptyHome,
    USERPROFILE: emptyHome,
    HOMEDRIVE: "",
    HOMEPATH: "",
    DOCONVERT_LIBREOFFICE_KIT: "",
  };
  const result = await runCliProcess([join("examples", "headings.md"), "-o", out, "--format", "docx"], { env });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /^WARN toc-degraded: .+PDF 引擎不可用，目录页码以占位符显示/m);
  assert.ok(!/WARN|ERROR/.test(result.stdout), result.stdout);
  const names = await files(out);
  assert.ok(names.includes("headings.docx"));
  const records = await readLog(out);
  assert.equal(records[0].toc.mode, "degraded");
  assert.equal(records[0].status, "ok");
  assert.equal(records[1].tocMode, "degraded");
  assert.equal(records[1].exitCode, 0);

  // 降级态：目录页码列必须是占位符 '——'（不是默认 '00'），且 settings.xml 不含 updateFields。
  const zip = await readZipFile(join(out, "headings.docx"));
  const documentXml = zip.read("word/document.xml").toString("utf8");
  const tocParagraphs = (documentXml.match(/<w:pStyle w:val="TOC[123]"\/>/g) || []).length;
  const placeholderRuns = (documentXml.match(/<w:t[^>]*>——<\/w:t>/g) || []).length;
  assert.ok(tocParagraphs >= 3, "长文应写目录条目");
  // TOC 段落含 1 个标题行（无页码列），条目数以上一条 file 记录的 toc.entries 为准。
  assert.equal(placeholderRuns, records[0].toc.entries, "每个目录条目页码列都应是 '——'");
  assert.equal(/<w:t[^>]*>00<\/w:t>/.test(documentXml), false, "降级态不得写 '00' 占位");
  assert.equal(/<w:updateFields/.test(zip.read("word/settings.xml").toString("utf8")), false, "不得写 updateFields");
});

test("doctor --json：可解析且给出 kit 来源（architecture §3.7）", async () => {
  const result = await runCliProcess(["doctor", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.found, true);
  assert.equal(payload.version, "0.1.5");
  assert.ok(["env", "project", "global", "npx-cache"].includes(payload.source));
  assert.ok(Array.isArray(payload.candidates));
});
