#!/usr/bin/env node
/**
 * 阶段 2.0 空壳接线验收脚本（可重复运行）。
 *
 * 覆盖任务卡的 7 条验收 + skeleton-wiring.md 的失败路径：
 *   1  both 全链路（产物 + 日志 + SHA-256 真实性）
 *   2  --format docx / --format pdf 各自只出对应格式
 *   3  输入不存在 → 3；输出冲突 → 2；引擎缺失（both）→ 4
 *   4  DOCONVERT_LIBREOFFICE_KIT 指向不存在路径 → 4 + 可操作 hint
 *   5  中文与空格路径全链路
 *   6  --continue-on-error 3 输入 1 失败 → 继续、汇总、退出非 0
 *   7  --version 7 行 + 日志字段完整
 *   附 --help 不含禁止参数、doctor 可解析、默认快速失败记 skipped
 *
 * 用法：node test/shell/run-acceptance.mjs
 * 不用管道：本机沙箱禁止 Node 打开命名管道，子进程输出经文件捕获（见 src/cli/spawn-capture.js）。
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProcess } from "../../src/cli/spawn-capture.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT_ROOT = join(ROOT, "test", "shell", "out");
const BIN = join(ROOT, "bin", "docconvert.js");

let passed = 0;
let failed = 0;
const results = [];
/** 人类可读转录（脚本自己写 UTF-8，避免 shell 重定向的编码差异）。 */
const transcript = [];
const rawLog = console.log.bind(console);
console.log = (...args) => {
  const line = args.map(String).join(" ");
  transcript.push(line);
  rawLog(...args);
};

function ok(name, detail) {
  passed += 1;
  results.push({ name, status: "PASS", detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}
function bad(name, detail) {
  failed += 1;
  results.push({ name, status: "FAIL", detail });
  console.log(`FAIL ${name} — ${detail}`);
}
function expect(condition, name, detail) {
  if (condition) ok(name, detail);
  else bad(name, detail);
}

async function sh(args, options = {}) {
  const command = [BIN, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ");
  const result = await captureProcess(process.execPath, [BIN, ...args], {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    timeoutMs: 180000,
  });
  return {
    command: `node ${command}`,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    error: result.error,
  };
}

async function resetOut(name) {
  const dir = join(OUT_ROOT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

async function files(dir) {
  return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
}

/** 递归列出目录内所有文件（相对路径，POSIX 分隔符）。 */
async function filesDeep(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await filesDeep(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex").toUpperCase();
}

async function readLog(dir) {
  const text = await readFile(join(dir, "conversion-log.jsonl"), "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const FILE_REQUIRED = [
  "type", "schemaVersion", "program", "template", "pdfKit", "fonts", "command", "input",
  "outputs", "status", "errorCode", "warnings", "toc", "startedAt", "endedAt", "durationMs", "platform",
];

async function main() {
  await mkdir(OUT_ROOT, { recursive: true });
  console.log(`# docconvert 阶段 2.0 空壳接线验收（cwd=${ROOT}）\n`);

  // ---- 1) both 全链路 ----
  {
    const dir = await resetOut("case1-both");
    const run = await sh([join("examples", "cjk.md"), "-o", dir]);
    expect(run.code === 0, "1.1 both 退出码 0", `exit=${run.code}`);
    const list = await files(dir);
    expect(list.includes("cjk.docx") && list.includes("cjk.pdf") && list.includes("conversion-log.jsonl"),
      "1.2 两个产物 + 日志均存在", list.join(", "));
    const records = await readLog(dir);
    expect(records.length === 2 && records[1].type === "run", "1.3 日志 2 条：file + run");
    const fileRecord = records[0];
    expect(FILE_REQUIRED.every((key) => key in fileRecord), "1.4 file 记录字段完整", FILE_REQUIRED.filter((k) => !(k in fileRecord)).join(",") || "17/17");
    const docxOut = fileRecord.outputs.find((o) => o.format === "docx");
    const pdfOut = fileRecord.outputs.find((o) => o.format === "pdf");
    // 日志中的产物 sha256 为小写（TC-LOG-01）；比较时统一小写。
    expect(docxOut && pdfOut
      && docxOut.sha256.toLowerCase() === (await sha256(join(dir, "cjk.docx"))).toLowerCase()
      && pdfOut.sha256.toLowerCase() === (await sha256(join(dir, "cjk.pdf"))).toLowerCase(),
    "1.5 产物 SHA-256 与磁盘一致");
    const pdfHead = (await readFile(join(dir, "cjk.pdf"))).subarray(0, 5).toString("latin1");
    expect(pdfHead === "%PDF-", "1.5b 产物是有效 PDF（%PDF- 头）", pdfHead);
    const inputSha = await sha256(join(ROOT, "examples", "cjk.md"));
    expect(fileRecord.input.sha256.toLowerCase() === inputSha.toLowerCase()
      && fileRecord.input.bytes === (await stat(join(ROOT, "examples", "cjk.md"))).size,
    "1.6 输入 SHA-256/bytes 与磁盘一致");
    expect(/^SUMMARY total=1 ok=1 failed=0 skipped=0 elapsed=\d+\.\ds$/m.test(run.stdout), "1.7 SUMMARY 行格式", run.stdout.split("\n").find((l) => l.startsWith("SUMMARY")));
    expect(run.stdout.includes(`OUTPUT ${dir}`), "1.8 OUTPUT 行");
    // 成功路径：stdout 不得混入 WARN/ERROR；stderr 允许 WARN（解析器的降级告警按 D-001 走 stderr），但不得有 ERROR。
    expect(!/\b(WARN|ERROR)\b/.test(run.stdout) && !/^ERROR /m.test(run.stderr),
      "1.9 stdout 不混入 WARN/ERROR、stderr 无 ERROR（允许 WARN）",
      `stdout-hits=${(run.stdout.match(/\b(WARN|ERROR)\b/g) || []).length}, stderr-error=${/^ERROR /m.test(run.stderr)}`);
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  files=${list.join(", ")}\n`);
  }

  // ---- 2) 单格式 ----
  {
    const dir = await resetOut("case2-docx");
    const run = await sh([join("examples", "headings.md"), "-o", dir, "--format", "docx"]);
    const list = await files(dir);
    expect(run.code === 0 && list.includes("headings.docx") && !list.includes("headings.pdf"),
      "2.1 --format docx 只出 docx", `exit=${run.code}, files=${list.join(", ")}`);
    const records = await readLog(dir);
    expect(records[0].pdfKit === null && records[0].outputs.length === 1 && records[0].outputs[0].format === "docx",
      "2.1b docx-only 日志 pdfKit=null、outputs 仅 docx");
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  files=${list.join(", ")}\n`);
  }
  {
    const dir = await resetOut("case2-pdf");
    const run = await sh([join("examples", "headings.md"), "-o", dir, "--format", "pdf"]);
    const list = await files(dir);
    expect(run.code === 0 && list.includes("headings.pdf") && !list.includes("headings.docx"),
      "2.2 --format pdf 只出 pdf（临时 docx 不落 outdir）", `exit=${run.code}, files=${list.join(", ")}`);
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  files=${list.join(", ")}\n`);
  }

  // ---- 2c) docx-only 不依赖 PDF 引擎（REQ-DEP-001 衔接）----
  {
    const dir = await resetOut("case2c-docx-nokit");
    const run = await sh([join("examples", "cjk.md"), "-o", dir, "--format", "docx"], {
      env: { DOCONVERT_LIBREOFFICE_KIT: join(OUT_ROOT, "no-such-kit-dir") },
    });
    const list = await files(dir);
    expect(run.code === 0 && list.includes("cjk.docx") && !list.includes("cjk.pdf"),
      "2c.1 --format docx 且引擎不可解析 → 仍成功、无 pdf", `exit=${run.code}, files=${list.join(", ")}`);
    console.log(`  CMD ${run.command}  (env: DOCONVERT_LIBREOFFICE_KIT=<不存在>)\n  exit=${run.code}\n  files=${list.join(", ")}\n`);
  }
  {
    const dir = await resetOut("case2c-pdf-nokit");
    const run = await sh([join("examples", "cjk.md"), "-o", dir, "--format", "pdf"], {
      env: { DOCONVERT_LIBREOFFICE_KIT: join(OUT_ROOT, "no-such-kit-dir") },
    });
    expect(run.code === 4 && run.stderr.includes("ERROR pdf-engine-missing"),
      "2c.2 --format pdf 且引擎不可解析 → 4", `exit=${run.code}`);
  }

  // ---- 3) 输入不存在 / 输出冲突 / 引擎缺失 ----
  {
    const run = await sh([join("examples", "does-not-exist.md"), "-o", join(OUT_ROOT, "case3")]);
    expect(run.code === 3 && run.stderr.includes("ERROR input-not-found"), "3.1 输入不存在 → 3 + input-not-found", `exit=${run.code}`);
    expect(!/^\s+at /m.test(run.stderr), "3.1b 错误输出无调用堆栈（REQ-CLI-006）");
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  stderr=${run.stderr.trim().split("\n")[0]}\n`);
  }
  {
    const dir = await resetOut("case3-conflict");
    const conflictDir = join(ROOT, "test", "shell", "fixtures", "conflict");
    const run = await sh([conflictDir, "-o", dir]);
    const list = await files(dir);
    expect(run.code === 2 && run.stderr.includes("ERROR output-conflict") && list.length === 0,
      "3.2 输出冲突 → 2 + 无产物", `exit=${run.code}, files=${list.length}`);
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  stderr=${run.stderr.trim().split("\n")[0]}\n`);
  }
  {
    // 引擎缺失：把 npx 缓存与 home 指向空目录，且不设 DOCONVERT_LIBREOFFICE_KIT
    const emptyHome = join(OUT_ROOT, "empty-home");
    await rm(emptyHome, { recursive: true, force: true });
    await mkdir(emptyHome, { recursive: true });
    const scrub = {
      LOCALAPPDATA: emptyHome,
      APPDATA: emptyHome,
      USERPROFILE: emptyHome,
      HOMEDRIVE: "",
      HOMEPATH: "",
      DOCONVERT_LIBREOFFICE_KIT: "",
    };
    const dir = await resetOut("case3-nokit");
    const run = await sh([join("examples", "cjk.md"), "-o", dir], { env: scrub });
    const list = await files(dir);
    expect(run.code === 4 && run.stderr.includes("ERROR pdf-engine-missing") && run.stderr.includes("hint:"),
      "3.3 both + 引擎缺失 → 4 + hint", `exit=${run.code}`);
    expect(list.filter((f) => f.endsWith(".docx") || f.endsWith(".pdf")).length === 0,
      "3.4 引擎缺失时 outdir 无 docx/pdf 产物", `files=${list.join(", ") || "(空)"}`);
    console.log(`  CMD ${run.command}  (env: LOCALAPPDATA/USERPROFILE→空目录)\n  exit=${run.code}\n  stderr=\n${run.stderr.trim()}\n`);
  }

  // ---- 4) env 指向不存在路径 ----
  {
    const dir = await resetOut("case4-badkit");
    const bogus = join(OUT_ROOT, "no-such-kit-dir");
    const run = await sh([join("examples", "cjk.md"), "-o", dir], { env: { DOCONVERT_LIBREOFFICE_KIT: bogus } });
    expect(run.code === 4 && run.stderr.includes("DOCONVERT_LIBREOFFICE_KIT") && /hint: /.test(run.stderr),
      "4.1 DOCONVERT_LIBREOFFICE_KIT 无效 → 4 + 可操作提示", `exit=${run.code}`);
    console.log(`  CMD ${run.command}  (env: DOCONVERT_LIBREOFFICE_KIT=<不存在>)\n  exit=${run.code}\n  stderr=\n${run.stderr.trim()}\n`);
  }

  // ---- 5) 中文与空格路径 ----
  {
    const dir = await resetOut(join("case5-中文 输出 目录"));
    const inputDir = join(ROOT, "test", "shell", "fixtures", "中文 空格");
    const run = await sh([join(inputDir, "示例 文档.md"), "-o", dir]);
    const list = await files(dir);
    expect(run.code === 0 && list.includes("示例 文档.docx") && list.includes("示例 文档.pdf"),
      "5.1 中文与空格路径全链路成功", `exit=${run.code}, files=${list.join(", ")}`);
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  files=${list.join(", ")}\n`);
  }

  // ---- 6) --continue-on-error：3 输入 1 失败 ----
  {
    const dir = await resetOut("case6-batch");
    const batchDir = join(ROOT, "test", "shell", "fixtures", "batch");
    const run = await sh([batchDir, "-o", dir, "--continue-on-error"]);
    const records = await readLog(dir);
    const fileRecords = records.filter((r) => r.type === "file");
    const summary = run.stdout.split("\n").find((l) => l.startsWith("SUMMARY")) ?? "";
    expect(run.code === 3, "6.1 有失败 → 退出非 0（取首个失败类别码 3）", `exit=${run.code}`);
    expect(/^SUMMARY total=3 ok=2 failed=1 skipped=0 elapsed=\d+\.\ds$/.test(summary), "6.2 汇总 total=3 ok=2 failed=1 skipped=0", summary);
    expect(fileRecords.length === 3 && fileRecords.filter((r) => r.status === "ok").length === 2
      && fileRecords.some((r) => r.status === "failed" && r.errorCode === "empty-input"),
      "6.3 日志记录 3 条：2 ok + 1 failed(empty-input)");
    const list = await files(dir);
    expect(list.includes("good-one.docx") && list.includes("good-two.pdf") && !list.includes("bad-empty.docx"),
      "6.4 成功产物保留，失败文件无产物", list.join(", "));
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  ${summary}\n  files=${list.join(", ")}\n`);
  }

  // ---- 6b) 默认快速失败：未处理记 skipped（第 2 个失败 → 第 3 个 skipped）----
  {
    const dir = await resetOut("case6-fastfail");
    const batchDir = join(ROOT, "test", "shell", "fixtures", "batch-fastfail");
    const run = await sh([batchDir, "-o", dir]);
    const records = await readLog(dir);
    const summary = run.stdout.split("\n").find((l) => l.startsWith("SUMMARY")) ?? "";
    const list = await files(dir);
    expect(run.code === 3 && /^SUMMARY total=3 ok=1 failed=1 skipped=1 /m.test(summary),
      "6b.1 无 --continue-on-error → 快速失败，其余记 skipped", summary);
    expect(records.filter((r) => r.status === "skipped").length === 1 && list.includes("a-good.docx") && !list.includes("c-good.docx"),
      "6b.2 已成功产物保留、未处理无产物", list.join(", "));
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  ${summary}\n  files=${list.join(", ")}\n`);
  }

  // ---- 6c) 默认输出目录（不带 -o）----
  {
    const inputDir = join(OUT_ROOT, "case6-default-input");
    await rm(inputDir, { recursive: true, force: true });
    await mkdir(inputDir, { recursive: true });
    await writeFile(join(inputDir, "默认输出.md"), "# 默认输出目录\n\n验证输入所在目录下的 docconvert-out/ 自动创建。\n", "utf8");
    const run = await sh([join(inputDir, "默认输出.md")]);
    const outDir = join(inputDir, "docconvert-out");
    const list = await files(outDir).catch(() => []);
    expect(run.code === 0 && list.includes("默认输出.docx") && list.includes("conversion-log.jsonl"),
      "6c.1 缺省输出目录 = 输入所在目录/docconvert-out/", `exit=${run.code}, files=${list.join(", ")}`);
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  OUTPUT ${outDir}\n`);
  }

  // ---- 6d) 参数/输入错误码（-o 指向文件 → 2；扩展名不支持 → 3）----
  {
    const target = join(OUT_ROOT, "case6d-a-file.txt");
    await writeFile(target, "not a directory\n", "utf8");
    const run = await sh([join("examples", "cjk.md"), "-o", target]);
    expect(run.code === 2 && run.stderr.includes("ERROR usage-error"), "6d.1 -o 指向已存在文件 → 2", `exit=${run.code}`);
  }
  {
    const run = await sh([join(ROOT, "test", "shell", "make-fixtures.mjs"), "-o", join(OUT_ROOT, "case6d-unsupported")]);
    expect(run.code === 3 && run.stderr.includes("ERROR unsupported-extension"), "6d.2 扩展名不支持 → 3", `exit=${run.code}`);
  }

  // ---- 6d-2) 目录递归与"目录内无输入文件" ----
  {
    const recursiveDir = join(ROOT, "test", "shell", "fixtures", "recursive");
    const dirTop = await resetOut("case6r-top");
    const topRun = await sh([recursiveDir, "-o", dirTop]);
    const topFiles = await files(dirTop);
    expect(topRun.code === 0 && topFiles.includes("顶层.docx") && !topFiles.some((f) => f.includes("嵌套")),
      "6r.1 不加 -r 只处理目录第一层", topFiles.filter((f) => f.endsWith(".docx")).join(", "));

    const dirAll = await resetOut("case6r-all");
    const allRun = await sh([recursiveDir, "-o", dirAll, "-r"]);
    const allFiles = await filesDeep(dirAll);
    expect(allRun.code === 0 && allFiles.filter((f) => f.endsWith(".docx")).length === 2
      && allFiles.includes("子目录/嵌套.docx"),
      "6r.2 加 -r 递归处理子目录（输出保持相对路径层级）", allFiles.filter((f) => f.endsWith(".docx")).join(", "));
    console.log(`  CMD ${allRun.command}\n  exit=${allRun.code}\n  files=${allFiles.join(", ")}\n`);
  }
  {
    const dir = await resetOut("case6n-noinput");
    const run = await sh([join(ROOT, "test", "shell", "fixtures", "no-input"), "-o", dir]);
    expect(run.code === 3 && run.stderr.includes("ERROR no-input-files"), "6n.1 目录内无白名单文件 → 3", `exit=${run.code}`);
  }

  // ---- 6f) 输出目录无法创建 → output-not-writable / 4（2026-10-22 t9 新增错误码）----
  {
    const blocker = join(OUT_ROOT, "case6f-blocker.txt");
    await writeFile(blocker, "x", "utf8");
    const run = await sh([join("examples", "cjk.md"), "-o", join(blocker, "sub")]);
    expect(run.code === 4 && run.stderr.includes("ERROR output-not-writable") && /hint: /.test(run.stderr),
      "6f.1 输出目录不可创建 → 4 + output-not-writable", `exit=${run.code}`);
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  stderr=${run.stderr.trim().split("\n")[0]}\n`);
  }

  // ---- 6e) 日志写盘失败：WARN 但不吞产物、退出码不变 ----
  {
    const dir = await resetOut("case6e-logfail");
    await mkdir(join(dir, "conversion-log.jsonl"), { recursive: true });
    const run = await sh([join("examples", "cjk.md"), "-o", dir]);
    const list = await files(dir);
    expect(run.code === 0 && run.stderr.includes("WARN log-write-failed") && list.includes("cjk.docx") && list.includes("cjk.pdf"),
      "6e.1 日志写盘失败 → WARN log-write-failed，产物保留、退出码 0", `exit=${run.code}, stderr=${run.stderr.trim().split("\n").pop()}`);
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n  files=${list.join(", ")}\n`);
  }

  // ---- 7) --version ----
  {
    const run = await sh(["--version"]);
    const lines = run.stdout.trim().split("\n");
    const keys = lines.map((line) => line.split(":")[0]);
    expect(keys.join(",") === "docconvert,node,template,pdf-kit,pdf-engine,toc,fonts",
      "7.1 --version 7 行、键名与顺序固定", keys.join(","));
    expect(run.code === 0 && /^pdf-kit: 0\.1\.5$/m.test(run.stdout) && /^template: [0-9a-f]{12}$/m.test(run.stdout) && /^node: v?\d+/m.test(run.stdout),
      "7.2 --version 含程序/模板/kit/node");
    expect(/^toc: two-pass$/m.test(run.stdout) && /^fonts: .+ \/ .+ \/ .+$/m.test(run.stdout), "7.3 toc 与 fonts 行");
    console.log(`  CMD ${run.command}\n  exit=${run.code}\n${run.stdout.trim().split("\n").map((l) => "  " + l).join("\n")}\n`);
  }

  // ---- 8) --help 不含禁止参数 ----
  {
    const run = await sh(["--help"]);
    const forbidden = ["--font", "--margin", "--color", "--template", "--reference", "--theme", "--page-size", "--engine", "--jobs", "--log", "--encoding"];
    const hits = forbidden.filter((flag) => run.stdout.includes(flag));
    expect(run.code === 0 && hits.length === 0 && run.stdout.includes("docconvert a.md") && /退出码/.test(run.stdout),
      "8.1 --help 含示例/退出码，且不含禁止参数", hits.join(",") || "无命中");
    console.log(`  CMD ${run.command}\n  exit=${run.code}, forbidden-hits=${hits.length}\n`);
  }

  // ---- 9) doctor ----
  {
    const run = await sh(["doctor", "--json"]);
    let payload = null;
    try { payload = JSON.parse(run.stdout); } catch { payload = null; }
    expect(run.code === 0 && payload && payload.found === true && payload.version === "0.1.5",
      "9.1 doctor --json 可解析且 found=true", payload ? `source=${payload.source}, version=${payload.version}` : "JSON 解析失败");
    console.log(`  CMD ${run.command}\n  exit=${run.code}, source=${payload?.source}\n`);
  }

  console.log(`\n# 结果：PASS ${passed} / FAIL ${failed}`);
  await writeFile(join(OUT_ROOT, "acceptance-summary.json"), JSON.stringify({ passed, failed, results }, null, 2) + "\n", "utf8");
  await writeFile(join(OUT_ROOT, "acceptance-log.txt"), transcript.join("\n") + "\n", "utf8");
  if (failed > 0) process.exitCode = 1;
}

await main();
