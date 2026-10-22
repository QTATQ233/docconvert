#!/usr/bin/env node
/**
 * 闸门 2 预热：最小执行骨架（不跑完整 51 条）
 * - 只用 Node 内置模块 + node:test 风格断言，不引第三方框架
 * - Windows 下不使用管道：子进程 stdout/stderr 直接重定向到临时文件（stdio: ignore + fd）
 * - 每条例用独立 out 目录：out/gate2/<CASE_ID>/
 *
 * 用法：
 *   node test/gate2/run-gate2.mjs            # 跑 smoke 子集（默认）
 *   node test/gate2/run-gate2.mjs --list     # 列出骨架支持的用例
 *   node test/gate2/run-gate2.mjs --case SMOKE-CONVERT
 *   node test/gate2/run-gate2.mjs --env-kit <kit 包目录>   # 显式指定引擎
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CLI = path.join(ROOT, "bin", "docconvert.js");
const OUT_ROOT = path.join(ROOT, "out", "gate2");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

let CURRENT_ENV = {};

function run(args, extraEnv = {}) {
  const caseId = flag("--case") || "SMOKE";
  const workDir = path.join(OUT_ROOT, caseId);
  fs.mkdirSync(workDir, { recursive: true });
  const outFile = path.join(workDir, "subprocess.stdout.txt");
  const errFile = path.join(workDir, "subprocess.stderr.txt");
  const fdOut = fs.openSync(outFile, "w");
  const fdErr = fs.openSync(errFile, "w");
  let res;
  try {
    res = spawnSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      stdio: ["ignore", fdOut, fdErr],   // 关键：不用管道
      env: { ...process.env, ...CURRENT_ENV, ...extraEnv },
      timeout: 300000,
      windowsHide: true,
    });
  } finally {
    fs.closeSync(fdOut);
    fs.closeSync(fdErr);
  }
  return {
    status: res.status,
    signal: res.signal,
    error: res.error ? String(res.error.message) : null,
    stdout: fs.readFileSync(outFile, "utf8"),
    stderr: fs.readFileSync(errFile, "utf8"),
    stdoutFile: outFile,
    stderrFile: errFile,
  };
}

const expect = (cond, label) => ({ label, pass: Boolean(cond) });

const CASES = {
  "SMOKE-HELP": {
    desc: "--help 可用、退出 0、含用法与示例",
    inputs: [],
    run() {
      const r = run(["--help"]);
      return {
        ...r,
        outDir: null,
        checks: [
          expect(r.status === 0, "exit=0"),
          expect(/用法/.test(r.stdout), "stdout 含使用说明"),
          expect(/docconvert\s+\S+\.md/.test(r.stdout), "stdout 含可直接复制的示例"),
          expect(r.stderr.trim() === "", "stderr 为空"),
        ],
      };
    },
  },
  "SMOKE-VERSION": {
    desc: "--version 七行固定键序、退出 0",
    inputs: [],
    run() {
      const r = run(["--version"]);
      const lines = r.stdout.trim().split(/\r?\n/);
      const keys = lines.map((l) => l.split(":")[0].trim());
      const want = ["docconvert", "node", "template", "pdf-kit", "pdf-engine", "toc", "fonts"];
      return {
        ...r,
        outDir: null,
        checks: [
          expect(r.status === 0, "exit=0"),
          expect(lines.length === 7, "恰好 7 行（实际 " + lines.length + "）"),
          expect(JSON.stringify(keys) === JSON.stringify(want), "键序固定"),
          expect(r.stderr.trim() === "", "stderr 为空"),
        ],
      };
    },
  },
  "SMOKE-CONVERT": {
    desc: "单文件 cjk.md 双格式转换（验证管道与产物）",
    inputs: ["examples/cjk.md"],
    run() {
      const outDir = path.join(OUT_ROOT, "SMOKE-CONVERT", "out-" + Date.now());
      const r = run(["examples/cjk.md", "-o", outDir, "--format", "both"]);
      const docx = path.join(outDir, "cjk.docx");
      const pdf = path.join(outDir, "cjk.pdf");
      const log = path.join(outDir, "conversion-log.jsonl");
      return {
        ...r,
        outDir,
        checks: [
          expect(r.status === 0, "exit=0"),
          expect(fs.existsSync(docx), "cjk.docx 存在"),
          expect(fs.existsSync(pdf), "cjk.pdf 存在"),
          expect(fs.existsSync(log), "conversion-log.jsonl 存在"),
          expect(/^SUMMARY total=1 ok=1 failed=0 skipped=0 elapsed=/m.test(r.stdout), "SUMMARY 行格式合法"),
          expect(/^OUTPUT /m.test(r.stdout), "OUTPUT 行存在"),
          expect(!/^WARN/m.test(r.stdout), "stdout 无 WARN（D-001）"),
        ],
      };
    },
  },
};

function main() {
  if (argv.includes("--list")) {
    for (const [id, c] of Object.entries(CASES)) console.log(id + "\t" + c.desc);
    return 0;
  }
  const only = flag("--case");
  const envKit = flag("--env-kit");
  const extraEnv = envKit ? { DOCONVERT_LIBREOFFICE_KIT: envKit } : {};
  const ids = only ? [only] : Object.keys(CASES);
  if (!fs.existsSync(CLI)) {
    console.error("找不到 CLI 入口：" + CLI);
    return 2;
  }
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const report = { startedAt: new Date().toISOString(), root: ROOT, cli: CLI, node: process.version, cases: [] };
  let failed = 0;
  for (const id of ids) {
    const spec = CASES[id];
    if (!spec) { console.error("未知用例：" + id); return 2; }
    const r = runCase(id, spec, extraEnv);
    const pass = r.checks.every((c) => c.pass);
    if (!pass) failed++;
    report.cases.push({ id, desc: spec.desc, status: r.status, pass, checks: r.checks, stdoutFile: r.stdoutFile, stderrFile: r.stderrFile, outDir: r.outDir });
    console.log((pass ? "PASS " : "FAIL ") + id + "  [exit=" + r.status + "]  " + r.checks.filter((c) => !c.pass).map((c) => c.label).join("; "));
  }
  report.finishedAt = new Date().toISOString();
  report.summary = { total: report.cases.length, passed: report.cases.length - failed, failed };
  const reportPath = path.join(OUT_ROOT, "smoke-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("report: " + reportPath);
  return failed === 0 ? 0 : 1;
}

function runCase(id, spec, extraEnv) {
  const prevArgv = argv.slice();
  const prevEnv = CURRENT_ENV;
  if (!argv.includes("--case")) { argv.push("--case", id); }
  CURRENT_ENV = extraEnv || {};
  try {
    return spec.run();
  } finally {
    CURRENT_ENV = prevEnv;
    argv.length = 0; argv.push(...prevArgv);
  }
}

process.exitCode = main();
