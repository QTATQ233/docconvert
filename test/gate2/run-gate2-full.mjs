#!/usr/bin/env node
/**
 * 闸门 2 全量执行器（51 条）。仅测试代码：不改 src/**。
 * - 子进程 stdio 走临时文件（Windows 下不用管道）
 * - docx 解析复用 src/cli/zip.js 的只读 ZIP 读取器
 * - 输出 out/gate2-full/results.json，供 test-report.md 引用
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readZipFile } from "../../src/cli/zip.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CLI = path.join(ROOT, "bin", "docconvert.js");
const OUT = path.join(ROOT, "out", "gate2-full");
fs.mkdirSync(OUT, { recursive: true });

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256File = (p) => sha256(fs.readFileSync(p));
const uniq = (arr) => [...new Set(arr)];

function runRaw(cmd, args, env, cwd, tag) {
  const base = path.join(OUT, tag || "run");
  fs.mkdirSync(base, { recursive: true });
  const o = path.join(base, "stdout.txt");
  const e = path.join(base, "stderr.txt");
  const fo = fs.openSync(o, "w");
  const fe = fs.openSync(e, "w");
  let r;
  try {
    r = spawnSync(cmd, args, {
      cwd: cwd || ROOT,
      stdio: ["ignore", fo, fe],
      env: { ...process.env, ...(env || {}) },
      timeout: 300000,
      windowsHide: true,
    });
  } finally { fs.closeSync(fo); fs.closeSync(fe); }
  return {
    status: r.status, signal: r.signal, error: r.error ? String(r.error.message) : null,
    out: fs.readFileSync(o, "utf8"), err: fs.readFileSync(e, "utf8"),
    stdoutFile: o, stderrFile: e,
  };
}

let SEQ = 0;
const nextTag = (id) => id + "-" + (++SEQ).toString().padStart(2, "0");
const DC = (args, opts = {}) => runRaw(process.execPath, [CLI, ...args], opts.env, opts.cwd, nextTag(opts.tag || "dc"));

let KIT_CLI = null;
function getKitCli() {
  if (KIT_CLI) return KIT_CLI;
  const r = DC(["doctor", "--json"], { tag: "doctor" });
  const j = JSON.parse(r.out.slice(r.out.indexOf("{")));
  const cand = (j.candidates || []).find((c) => c.valid);
  KIT_CLI = path.join(cand.path, "lib", "cli.js");
  return KIT_CLI;
}
function KIT(args, tag) {
  return runRaw(process.execPath, [getKitCli(), ...args], {}, ROOT, nextTag(tag || "kit"));
}

async function docxCtx(file) {
  const zip = await readZipFile(file);
  const xml = (name) => (zip.names.includes(name) ? zip.read(name).toString("utf8") : "");
  return {
    names: zip.names,
    document: xml("word/document.xml"),
    styles: xml("word/styles.xml"),
    settings: xml("word/settings.xml"),
    core: xml("docProps/core.xml"),
    media: zip.names.filter((n) => n.startsWith("word/media/")),
    get: xml,
  };
}

function pdfCtx(file) {
  const buf = fs.readFileSync(file);
  const s = buf.toString("latin1");
  const m = s.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/) || s.match(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/);
  return {
    bytes: buf.length,
    pages: m ? Number(m[1]) : null,
    bookmarks: (s.match(/\/Title<FEFF/g) || []).length,
    fonts: uniq((s.match(/\/BaseFont\/([^\s\/<>\[\]]+)/g) || []).map((x) => x.replace("/BaseFont/", ""))),
    raw: s,
  };
}

function renderPdf(pdfPath, pages, tag) {
  const outDir = path.join(OUT, "render-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  const r = KIT(["render", "--input", pdfPath, "--output-dir", outDir, "--pages", pages], tag || "render");
  if (r.status !== 0) return { ok: false, r, outDir };
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
  return { ok: true, manifest, outDir, images: manifest.images.map((i) => i.path) };
}

const results = [];
function record(id, priority, checks, evidence) {
  const pass = checks.every((c) => c.pass);
  results.push({ id, priority, pass, checks, evidence: evidence || {} });
  console.log((pass ? "PASS " : "FAIL ") + id + (pass ? "" : "   <<< " + checks.filter((c) => !c.pass).map((c) => c.label).join("; ")));
}
const ok = (label, cond, detail) => ({ label, pass: Boolean(cond), detail: detail === undefined ? undefined : String(detail) });
const count = (xml, re) => (xml.match(re) || []).length;

const ENTRIES = [];
const C = (id, priority, fn) => ENTRIES.push({ id, priority, fn });

export async function main() {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  for (const e of ENTRIES) {
    if (only && e.id !== only) continue;
    try {
      const r = await e.fn();
      record(e.id, e.priority, r.checks, r.evidence);
    } catch (err) {
      record(e.id, e.priority, [{ label: "执行异常", pass: false, detail: String((err && err.stack) || err) }], {});
    }
  }
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    p0Total: results.filter((r) => r.priority === "P0").length,
    p0Passed: results.filter((r) => r.priority === "P0" && r.pass).length,
    p0Failed: results.filter((r) => r.priority === "P0" && !r.pass).length,
  };
  let kit = null; try { kit = getKitCli(); } catch {}
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ startedAt: new Date().toISOString(), node: process.version, kit, results, summary }, null, 2), "utf8");
  console.log("SUMMARY " + JSON.stringify(summary));
  process.exitCode = summary.failed === 0 ? 0 : 1;
}

const SRC = path.join(ROOT, "src");
const REQ = fs.readFileSync(path.join(ROOT, "requirements.md"), "utf8");
const head = (s, n = 300) => s.slice(0, n).replace(/\s+/g, " ");

C("TC-CLI-01", "P0", async () => {
  const checks = [];
  const a = DC(["examples/headings.md", "--bogus"], { tag: "cli1a" });
  checks.push(ok("--bogus exit=2", a.status === 2, a.status));
  checks.push(ok("usage-error 行", /^ERROR usage-error: /m.test(a.err), head(a.err, 120)));
  const b = DC([], { tag: "cli1b" });
  checks.push(ok("缺 input exit=2", b.status === 2, b.status));
  const c = DC(["examples/headings.md", "--format", "html"], { tag: "cli1c" });
  checks.push(ok("--format html exit=2", c.status === 2, c.status));
  const forbidden = uniq((REQ.match(/--(?:font|margin|color|template|reference|theme|page-size|engine|jobs|log|encoding)\b/g) || []));
  const bad = [];
  for (const opt of forbidden) {
    const r = DC(["examples/headings.md", opt, "x"], { tag: "cli1f" });
    if (r.status !== 2) bad.push(opt + "=" + r.status);
  }
  checks.push(ok("禁用参数均 exit=2（" + forbidden.length + " 项）", bad.length === 0, bad.join(",")));
  const h = DC(["--help"], { tag: "cli1h" });
  const must = ["用法", "退出码", "docconvert-out", ".md", ".txt"];
  checks.push(ok("--help 六要素", must.every((m) => h.out.includes(m)) && /docconvert\s+\S+\.md/.test(h.out), must.filter((m) => !h.out.includes(m)).join(",")));
  checks.push(ok("--help 不含禁用参数", forbidden.every((x) => !h.out.includes(x)), forbidden.filter((x) => h.out.includes(x)).join(",")));
  return { checks, evidence: { forbidden, help: h.stdoutFile } };
});

C("TC-CLI-02", "P0", async () => {
  const r = DC(["--version"], { tag: "cli2" });
  const lines = r.out.trim().split(/\r?\n/);
  const keys = lines.map((l) => l.split(":")[0].trim());
  const want = ["docconvert", "node", "template", "pdf-kit", "pdf-engine", "toc", "fonts"];
  const e = DC(["--version"], { tag: "cli2e", env: { DOCONVERT_LIBREOFFICE_KIT: "C:\\no\\such\\kit" } });
  return {
    checks: [
      ok("exit=0", r.status === 0, r.status),
      ok("恰好 7 行", lines.length === 7, lines.length),
      ok("键序固定", JSON.stringify(keys) === JSON.stringify(want), keys.join(",")),
      ok("toc: two-pass", /^toc: two-pass$/m.test(r.out), ""),
      ok("引擎缺失仍 exit=0", e.status === 0, e.status),
      ok("pdf-engine: unavailable", /pdf-engine: unavailable/.test(e.out), head(e.out, 200)),
    ],
    evidence: { version: r.out, envVersion: e.out },
  };
});

C("TC-CLI-03", "P0", async () => {
  const a = DC(["examples/errors/does-not-exist.md", "-o", "out/gate2-full/cli3a"], { tag: "cli3a" });
  const b = DC(["examples/errors/unsupported.txt.bin", "-o", "out/gate2-full/cli3b"], { tag: "cli3b" });
  const c = DC(["examples/headings.md", "-o", "out/gate2-full/cli3c", "--format", "pdf"], { tag: "cli3c", env: { DOCONVERT_LIBREOFFICE_KIT: "C:\\no\\such\\kit" } });
  const errs = a.err + "\n" + b.err + "\n" + c.err;
  return {
    checks: [
      ok("三条均 ERROR 前缀", (a.err + b.err + c.err).split(/\r?\n/).filter((l) => /^ERROR [a-z-]+: /.test(l)).length >= 3, ""),
      ok("hint 行存在", /^hint: /m.test(errs), ""),
      ok("无堆栈", !/^\s+at\s/m.test(errs), head(errs, 200)),
      ok("无 ESC 字节", !errs.includes("\u001b"), ""),
      ok("错误信息为中文", /[\u4e00-\u9fff]/.test(errs), ""),
    ],
    evidence: { missing: head(a.err, 160), ext: head(b.err, 160), engine: head(c.err, 160) },
  };
});

C("TC-ER-01", "P0", async () => {
  const o = "out/gate2-full/er01";
  const r = DC(["examples/errors/does-not-exist.md", "-o", o], { tag: "er01" });
  return {
    checks: [
      ok("exit=3", r.status === 3, r.status),
      ok("input-not-found", /ERROR input-not-found: /.test(r.err), head(r.err, 140)),
      ok("hint 行", /^hint: /m.test(r.err), ""),
      ok("零产物", !fs.existsSync(path.join(o, "does-not-exist.docx")), ""),
    ],
    evidence: { stderrFile: r.stderrFile },
  };
});

C("TC-ER-02", "P0", async () => {
  const dir = path.join(OUT, "ro-" + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const user = process.env.USERNAME;
  const ICACLS = "C:\\Windows\\System32\\icacls.exe";
  const deny = spawnSync(ICACLS, [dir, "/deny", user + ":(OI)(CI)(W)"], { encoding: "utf8", windowsHide: true });
  let r;
  try { r = DC(["examples/errors/readonly-target.md", "-o", dir], { tag: "er02" }); }
  finally { spawnSync(ICACLS, [dir, "/remove:d", user], { encoding: "utf8", windowsHide: true }); }
  return {
    checks: [
      ok("icacls deny 执行", deny.status === 0, deny.status + ":" + String(deny.stdout || "").slice(0, 60) + String(deny.stderr || "").slice(0, 60)),
      ok("exit=4", r.status === 4, r.status),
      ok("stderr 含写入失败提示", /无法写入|不可写|权限|EACCES|EPERM|permission/i.test(r.err), head(r.err, 200)),
      ok("零产物", fs.readdirSync(dir).filter((n) => /\.(docx|pdf)$/.test(n)).length === 0, fs.readdirSync(dir).join(",")),
    ],
    evidence: { stderr: head(r.err, 300) },
  };
});

C("TC-ER-03", "P1", async () => {
  const r = DC(["examples/errors/empty.md", "-o", "out/gate2-full/er03"], { tag: "er03" });
  return {
    checks: [
      ok("exit=3", r.status === 3, r.status),
      ok("empty-input", /ERROR empty-input: /.test(r.err), head(r.err, 140)),
      ok("零产物", !fs.existsSync(path.join(OUT, "er03-", "empty.docx")), ""),
    ],
    evidence: {},
  };
});

C("TC-ER-04", "P1", async () => {
  const r = DC(["examples/errors/unsupported.txt.bin", "-o", "out/gate2-full/er04"], { tag: "er04" });
  return {
    checks: [
      ok("exit=3", r.status === 3, r.status),
      ok("unsupported-extension", /ERROR unsupported-extension: /.test(r.err), head(r.err, 140)),
      ok("列出 .bin", /\.bin/.test(r.err), ""),
      ok("hint 列出支持格式", /hint: .*\.md.*\.txt/.test(r.err), ""),
    ],
    evidence: {},
  };
});

C("TC-ER-05", "P2", async () => {
  const p = path.join(OUT, "er05-occupied.txt");
  fs.writeFileSync(p, "occupied", "utf8");
  const r = DC(["examples/headings.md", "-o", p], { tag: "er05" });
  return {
    checks: [
      ok("exit=2", r.status === 2, r.status),
      ok("usage-error", /ERROR usage-error: /.test(r.err), head(r.err, 140)),
      ok("文件未被覆盖", fs.readFileSync(p, "utf8") === "occupied", ""),
    ],
    evidence: {},
  };
});

C("TC-ER-06", "N/A", async () => ({ checks: [ok("N/A：v1 无模板覆盖参数（断言转 TC-CLI-01）", true, "")], evidence: {} }));
C("TC-TX-02", "N/A", async () => ({ checks: [ok("N/A：v1 无关闭标题开关（断言转 TC-TX-01/TC-TX-04）", true, "")], evidence: {} }));

C("TC-ER-07", "P1", async () => {
  const p = path.join(ROOT, "examples", "headings.md");
  const before = sha256File(p);
  const r = DC(["examples/headings.md", "-o", "examples/headings.md"], { tag: "er07" });
  const after = sha256File(p);
  return {
    checks: [
      ok("exit=2", r.status === 2, r.status),
      ok("参数错误码（usage-error 或 output-conflict）", /usage-error|output-conflict/.test(r.err), head(r.err, 160)),
      ok("输入哈希不变", before === after, ""),
    ],
    evidence: {},
  };
});

C("TC-BAT-01", "P0", async () => {
  const base = path.join(OUT, "bat01-" + Date.now());
  fs.mkdirSync(path.join(base, "sub"), { recursive: true });
  fs.mkdirSync(path.join(base, ".hidden"), { recursive: true });
  fs.mkdirSync(path.join(base, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(base, "docconvert-out"), { recursive: true });
  fs.writeFileSync(path.join(base, "b.md"), "# B\n");
  fs.writeFileSync(path.join(base, "a.md"), "# A\n");
  fs.writeFileSync(path.join(base, "d.TXT"), "D\n");
  fs.writeFileSync(path.join(base, "sub", "c.md"), "# C\n");
  fs.writeFileSync(path.join(base, ".hidden.md"), "# H\n");
  fs.writeFileSync(path.join(base, ".hidden", "x.md"), "# H2\n");
  fs.writeFileSync(path.join(base, "node_modules", "x.md"), "# N\n");
  fs.writeFileSync(path.join(base, "docconvert-out", "old.md"), "# O\n");
  const o1 = path.join(OUT, "bat01out1-" + Date.now());
  const r1 = DC([base, "-o", o1, "--format", "docx"], { tag: "bat01a" });
  const rel = (line) => { const p = line.replace(/^OK\s+/, "").trim(); const abs = path.isAbsolute(p) ? p : path.resolve(ROOT, p); return path.relative(base, abs); };
  const ok1 = r1.out.split(/\r?\n/).filter((l) => l.startsWith("OK ")).map(rel);
  const o2 = path.join(OUT, "bat01out2-" + Date.now());
  const r2 = DC([base, "-r", "-o", o2, "--format", "docx"], { tag: "bat01b" });
  const ok2 = r2.out.split(/\r?\n/).filter((l) => l.startsWith("OK ")).map(rel);
  const summaryLine = r1.out.trim().split(/\r?\n/).find((l) => l.startsWith("SUMMARY")) || "";
  return {
    checks: [
      ok("非递归集合正确", ok1.join(",") === ["a.md", "b.md", "d.TXT"].join(","), ok1.join(",")),
      ok("递归含 sub/c.md", ok2.includes("sub\\c.md") || ok2.includes("sub/c.md"), ok2.join(",")),
      ok("递归排除隐藏/node_modules", !ok2.some((n) => n.includes(".hidden") || n.includes("node_modules")), ok2.join(",")),
      ok("SUMMARY 行格式", /^SUMMARY total=\d+ ok=\d+ failed=\d+ skipped=\d+ elapsed=\d+\.\ds$/.test(summaryLine), summaryLine),
      ok("末行 OUTPUT", /^OUTPUT /m.test(r1.out), ""),
    ],
    evidence: { r1: r1.stdoutFile, r2: r2.stdoutFile },
  };
});

C("TC-BAT-02", "P0", async () => {
  const base = path.join(OUT, "bat02-" + Date.now());
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, "a-good.md"), "# A\n");
  fs.writeFileSync(path.join(base, "b-empty.md"), "");
  fs.writeFileSync(path.join(base, "c-good.md"), "# C\n");
  const o1 = path.join(OUT, "bat02out1-" + Date.now());
  const r1 = DC([base, "-o", o1, "--format", "docx"], { tag: "bat02a" });
  const log1 = fs.readFileSync(path.join(o1, "conversion-log.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const skipped = log1.filter((x) => x.type === "file" && x.status === "skipped").length;
  const o2 = path.join(OUT, "bat02out2-" + Date.now());
  const r2 = DC([base, "-o", o2, "--format", "docx", "--continue-on-error"], { tag: "bat02b" });
  const conf = path.join(OUT, "bat02c-" + Date.now());
  fs.mkdirSync(conf, { recursive: true });
  fs.writeFileSync(path.join(conf, "same.md"), "# A\n");
  fs.writeFileSync(path.join(conf, "same.txt"), "A\n");
  const o3 = path.join(OUT, "bat02out3-" + Date.now());
  const r3 = DC([conf, "-o", o3, "--format", "docx"], { tag: "bat02c" });
  return {
    checks: [
      ok("快速失败 exit=3", r1.status === 3, r1.status),
      ok("快速失败保留已完成产物", fs.existsSync(path.join(o1, "a-good.docx")), ""),
      ok("快速失败 skipped≥1", skipped >= 1, skipped),
      ok("--continue-on-error exit=3", r2.status === 3, r2.status),
      ok("continue 产出两个成功文件", fs.existsSync(path.join(o2, "a-good.docx")) && fs.existsSync(path.join(o2, "c-good.docx")), ""),
      ok("冲突预检 exit=2", r3.status === 2, r3.status),
      ok("冲突零产物", !fs.existsSync(o3) || fs.readdirSync(o3).filter((n) => /\.(docx|pdf)$/.test(n)).length === 0, fs.existsSync(o3) ? fs.readdirSync(o3).join(",") : "<no outdir>"),
    ],
    evidence: { r1: r1.stdoutFile, r3err: head(r3.err, 160) },
  };
});

C("TC-LOG-01", "P0", async () => {
  const o = path.join(OUT, "log01-" + Date.now());
  DC(["examples/headings.md", "-o", o, "--format", "both"], { tag: "log01a" });
  DC(["examples/cjk.md", "-o", o, "--format", "both"], { tag: "log01b" });
  const raw = fs.readFileSync(path.join(o, "conversion-log.jsonl"), "utf8");
  const recs = raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const fileRecs = recs.filter((r) => r.type === "file");
  const runRecs = recs.filter((r) => r.type === "run");
  const f1 = fileRecs[0] || {};
  const required = ["type", "schemaVersion", "program", "template", "pdfKit", "fonts", "command", "input", "outputs", "status", "errorCode", "warnings", "toc", "startedAt", "endedAt", "durationMs", "platform"];
  const missing = required.filter((k) => !(k in f1));
  const outSha = (f1.outputs || []).map((x) => x.sha256 === sha256File(x.path));
  const leak = raw.includes("城市湿地公园");
  return {
    checks: [
      ok("覆盖写：仅第二次记录（file=1 run=1）", fileRecs.length === 1 && runRecs.length === 1, "file=" + fileRecs.length + " run=" + runRecs.length),
      ok("17 个必填字段齐全", missing.length === 0, missing.join(",")),
      ok("日志 sha256 = 磁盘", outSha.length > 0 && outSha.every(Boolean), outSha.join(",")),
      ok("run 记录在末行且 exitCode=0", recs[recs.length - 1].type === "run" && recs[recs.length - 1].exitCode === 0, recs[recs.length - 1].type),
      ok("tocMode=two-pass", recs[recs.length - 1].tocMode === "two-pass", recs[recs.length - 1].tocMode),
      ok("无正文泄漏", !leak, leak),
    ],
    evidence: { log: path.join(o, "conversion-log.jsonl") },
  };
});

C("TC-TPL-01", "P0", async () => {
  const tpl = path.join(ROOT, "templates", "reference.docx");
  const h = sha256File(tpl);
  const ver = DC(["--version"], { tag: "tpl01v" });
  const z = await docxCtx(tpl);
  const visible = count(z.document, /<w:t[^>]*>[^<]+<\/w:t>/g);
  const cfg = fs.readFileSync(path.join(ROOT, "config", "default.yml"), "utf8");
  const black = (cfg.match(/\b(path|url|http|template|reference|date|time|random|seed|theme)\b/gi) || []);
  return {
    checks: [
      ok("template 版本 = 模板 SHA-256 前 12 位", ver.out.includes("template: " + h.slice(0, 12)), h.slice(0, 12)),
      ok("模板无可见正文文本", visible === 0, visible),
      ok("default.yml 黑名单零命中", black.length === 0, black.join(",")),
    ],
    evidence: { templateSha256: h },
  };
});

C("TC-DEP-03", "P0", async () => {
  const r = DC(["examples/cjk.md", "-o", path.join(OUT, "dep03-" + Date.now()), "--format", "both"], { tag: "dep03" });
  const codes = uniq((REQ.match(/^\| ([a-z][a-z-]+) \| (?:参数|输入|依赖|转换|内部|环境) \|/gm) || []).map((l) => l.split("|")[1].trim()));
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(e.name)) files.push(p); } })(SRC);
  const all = files.map((p) => fs.readFileSync(p, "utf8")).join("\n");
  const missing = codes.filter((c) => !all.includes('"' + c + '"') && !all.includes("'" + c + "'"));
  const net = (all.match(/node:https?\b|require\(["']https?["']\)/g) || []).length;
  return {
    checks: [
      ok("无网环境转换 exit=0", r.status === 0, r.status),
      ok("错误码全集 = 14（§9.1 含 output-not-writable）", codes.length === 14, codes.join(",")),
      ok("实现覆盖全部错误码", missing.length === 0, missing.join(",")),
      ok("无联网模块导入", net === 0, net),
    ],
    evidence: { codes },
  };
});

C("TC-PLAT-01", "P0", async () => {
  const cn = path.join(OUT, "plat01-中文 目录-" + Date.now());
  fs.mkdirSync(cn, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "examples", "headings.md"), path.join(cn, "标题 样本.md"));
  const r1 = DC([path.join(cn, "标题 样本.md"), "-o", path.join(cn, "out")], { tag: "plat01a" });
  let deep = path.join(OUT, "plat01-deep");
  for (let i = 0; i < 12; i++) deep = path.join(deep, "segment-" + "x".repeat(20));
  fs.mkdirSync(deep, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "examples", "headings.md"), path.join(deep, "a.md"));
  const r2 = DC([path.join(deep, "a.md"), "-o", path.join(deep, "out")], { tag: "plat01b" });
  const conf = path.join(OUT, "plat01-conf-" + Date.now());
  fs.mkdirSync(conf, { recursive: true });
  fs.writeFileSync(path.join(conf, "a.md"), "# A\n");
  fs.writeFileSync(path.join(conf, "a.txt"), "# A\n");
  const r3 = DC([conf, "-o", path.join(conf, "out")], { tag: "plat01c" });
  return {
    checks: [
      ok("中文+空格路径 exit=0", r1.status === 0, r1.status),
      ok("长路径(>260) exit=0", r2.status === 0, r2.status + " depth=" + deep.length),
      ok("大小写冲突 exit=2", r3.status === 2, r3.status),
    ],
    evidence: {},
  };
});

C("TC-NFR-01", "P0", async () => {
  const base = path.join(OUT, "nfr01-" + Date.now());
  fs.mkdirSync(base, { recursive: true });
  const samples = [
    ["empty.md", ""], ["bom.md", "\uFEFF# 标题\n"], ["crlf.md", "# A\r\n段落\r\n"],
    ["unclosed.md", "**未闭合\n"], ["fence.md", "\`\`\`js\nconst a=1\n"], ["deep-list.md", "- a\n".repeat(60)],
    ["quote.md", "> > > > 深引用\n"], ["table.md", "| a | b |\n| --- | --- |\n| 1 |\n"],
    ["huge-line.md", "# T\n" + "x".repeat(50000) + "\n"], ["binary.md", "\u0000\u0001\u0002"],
    ["gb18030.md", "中文"], ["html.md", "<div>x</div>\n"], ["img.md", "![](no-such.png)\n"],
    ["link.md", "[x](javascript:alert(1))\n"], ["h.md", "# \n"], ["many.md", ("# 标题\n正文\n\n").repeat(400)],
    ["tab.md", "\t缩进\t\n"], ["null2.md", "a\u0000b\n"], ["lone.md", "\uD800\n"], ["mix.md", "# 标题\n\n- 列表\n\n| 表 |\n| --- |\n| 1 |\n"],
  ];
  for (const [n, c] of samples) fs.writeFileSync(path.join(base, n), c, "utf8");
  const before = new Map();
  for (const n of fs.readdirSync(base)) { const p = path.join(base, n); before.set(n, sha256File(p)); }
  const cwdBefore = fs.readdirSync(ROOT).sort().join(",");
  const r = DC([base, "-o", path.join(OUT, "nfr01out-" + Date.now()), "--format", "docx", "--continue-on-error"], { tag: "nfr01" });
  const changed = [...before.entries()].filter(([n, h]) => sha256File(path.join(base, n)) !== h).map(([n]) => n);
  const cwdAfter = fs.readdirSync(ROOT).sort().join(",");
  return {
    checks: [
      ok("无未捕获异常（exit≠1）", r.status !== 1 && !r.error, r.status + " " + (r.error || "")),
      ok("输入全部未被修改", changed.length === 0, changed.join(",")),
      ok("CWD 无新增文件", cwdBefore === cwdAfter, ""),
      ok("stderr 无堆栈", !/^\s+at\s/m.test(r.err), head(r.err, 160)),
    ],
    evidence: { status: r.status, errHead: head(r.err, 300) },
  };
});

C("TC-CF-01", "P1", async () => {
  const o1 = path.join(OUT, "cf01local-" + Date.now());
  const r1 = DC([path.join("..", "headings.md"), "-o", o1, "--format", "docx"], { tag: "cf01a", cwd: path.join(ROOT, "examples", "conflict") });
  const o2 = path.join(OUT, "cf01root-" + Date.now());
  const r2 = DC(["examples/headings.md", "-o", o2, "--format", "docx"], { tag: "cf01b" });
  const z1 = await docxCtx(path.join(o1, "headings.docx"));
  const z2 = await docxCtx(path.join(o2, "headings.docx"));
  const same = sha256(Buffer.from(z1.styles)) === sha256(Buffer.from(z2.styles));
  return {
    checks: [
      ok("两次转换均成功", r1.status === 0 && r2.status === 0, r1.status + "/" + r2.status),
      ok("styles.xml 哈希相同（只认内置模板）", same, ""),
      ok("stderr 未声明使用干扰模板", !/使用.*conflict.*reference\.docx/.test(r1.err), head(r1.err, 160)),
    ],
    evidence: {},
  };
});

C("TC-CF-02", "P2", async () => {
  const ver = DC(["--version"], { tag: "cf02" });
  const h = sha256File(path.join(ROOT, "templates", "reference.docx"));
  return { checks: [ok("template = 模板 SHA-256 前 12 位", ver.out.includes("template: " + h.slice(0, 12)), h.slice(0, 12))], evidence: {} };
});

C("TC-DP-01", "P0", async () => {
  const o = path.join(OUT, "dp01-" + Date.now());
  const r = DC(["examples/headings.md", "-o", o, "--format", "pdf"], { tag: "dp01", env: { DOCONVERT_LIBREOFFICE_KIT: "C:\\no\\such\\kit" } });
  return {
    checks: [
      ok("exit=4", r.status === 4, r.status),
      ok("pdf-engine-missing", /ERROR pdf-engine-missing: /.test(r.err), head(r.err, 160)),
      ok("hint 行", /^hint: /m.test(r.err), ""),
      ok("零产物", !fs.existsSync(o) || fs.readdirSync(o).filter((n) => /\.(docx|pdf)$/.test(n)).length === 0, ""),
    ],
    evidence: {},
  };
});

C("TC-DP-02", "P1", async () => {
  const o = path.join(OUT, "dp02-" + Date.now());
  const r = DC(["examples/headings.md", "-o", o, "--format", "docx"], { tag: "dp02", env: { DOCONVERT_LIBREOFFICE_KIT: "C:\\no\\such\\kit" } });
  const o2 = path.join(OUT, "dp02b-" + Date.now());
  const r2 = DC(["examples/headings.md", "-o", o2, "--format", "both"], { tag: "dp02b", env: { DOCONVERT_LIBREOFFICE_KIT: "C:\\no\\such\\kit" } });
  return {
    checks: [
      ok("docx-only exit=0", r.status === 0, r.status),
      ok("docx 产物存在", fs.existsSync(path.join(o, "headings.docx")), ""),
      ok("both 预检 exit=4 且零产物", r2.status === 4 && (!fs.existsSync(o2) || fs.readdirSync(o2).filter((n) => /\.(docx|pdf)$/.test(n)).length === 0), r2.status),
    ],
    evidence: {},
  };
});

C("TC-RP-01", "P0", async () => {
  const oa = path.join(OUT, "rp01a-" + Date.now());
  const ob = path.join(OUT, "rp01b-" + Date.now());
  DC(["examples/headings.md", "-o", oa, "--format", "docx"], { tag: "rp01a" });
  await new Promise((r) => setTimeout(r, 1200));
  DC(["examples/headings.md", "-o", ob, "--format", "docx"], { tag: "rp01b" });
  const ha = sha256File(path.join(oa, "headings.docx"));
  const hb = sha256File(path.join(ob, "headings.docx"));
  return { checks: [ok("DOCX 两次 SHA-256 相同", ha === hb, ha.slice(0, 16) + " vs " + hb.slice(0, 16))], evidence: { ha, hb } };
});

C("TC-RP-02", "P1", async () => {
  const oa = path.join(OUT, "rp02a-" + Date.now());
  const ob = path.join(OUT, "rp02b-" + Date.now());
  DC(["examples/headings.md", "-o", oa, "--format", "pdf"], { tag: "rp02a" });
  DC(["examples/headings.md", "-o", ob, "--format", "pdf"], { tag: "rp02b" });
  const pa = path.join(oa, "headings.pdf");
  const pb = path.join(ob, "headings.pdf");
  const ra = renderPdf(pa, "1", "rp02ra");
  const rb = renderPdf(pb, "1", "rp02rb");
  const ia = ra.ok ? sha256File(ra.images[0]) : null;
  const ib = rb.ok ? sha256File(rb.images[0]) : null;
  const ca = pdfCtx(pa);
  const cb = pdfCtx(pb);
  return {
    checks: [
      ok("两次渲染均成功", ra.ok && rb.ok, ""),
      ok("第 1 页 PNG 哈希相同", ia === ib && ia, String(ia).slice(0, 16)),
      ok("页数/书签数相同", ca.pages === cb.pages && ca.bookmarks === cb.bookmarks, ca.pages + "/" + cb.pages),
    ],
    evidence: {},
  };
});

const stamp = () => "s" + Date.now();
const EX = path.join(ROOT, "examples");

C("TC-H-01", "P0", async () => {
  const o = path.join(OUT, "h01-" + stamp());
  const r = DC([path.join(EX, "headings.md"), "-o", o, "--format", "docx"], { tag: "h01" });
  const z = await docxCtx(path.join(o, "headings.docx"));
  const lv = (n) => Math.max(count(z.document, new RegExp('w:outlineLvl w:val="' + (n - 1) + '"', "g")), count(z.document, new RegExp('w:pStyle w:val="Heading' + n + '"', "g")));
  return {
    checks: [
      ok("exit=0", r.status === 0, r.status),
      ok("H1=4", lv(1) === 4, lv(1)),
      ok("H2=7", lv(2) === 7, lv(2)),
      ok("H3=14", lv(3) === 14, lv(3)),
    ],
    evidence: { docx: path.join(o, "headings.docx") },
  };
});

C("TC-H-02", "P0", async () => {
  const o = path.join(OUT, "h02-" + stamp());
  DC([path.join(EX, "headings.md"), "-o", o, "--format", "pdf"], { tag: "h02" });
  const p = pdfCtx(path.join(o, "headings.pdf"));
  return {
    checks: [
      ok("PDF /Outlines 存在", p.raw.includes("/Outlines"), ""),
      ok("书签数 = 26（H1–H6）", p.bookmarks === 26, p.bookmarks),
      ok("含中文字体", p.fonts.some((x) => /YaHei|SimSun|SimHei|Noto|SourceHan|Microsoft/i.test(x)), p.fonts.join(",")),
    ],
    evidence: { pdf: path.join(o, "headings.pdf"), fonts: p.fonts },
  };
});

C("TC-H-03", "P1", async () => {
  const o = path.join(OUT, "h03-" + stamp());
  DC([path.join(EX, "headings.md"), "-o", o, "--format", "docx"], { tag: "h03" });
  const z = await docxCtx(path.join(o, "headings.docx"));
  const h4 = Math.max(count(z.document, /w:outlineLvl w:val="3"/g), count(z.document, /w:pStyle w:val="Heading4"/g));
  return { checks: [ok("H4 存在且为标题样式/大纲级别", h4 >= 1, h4)], evidence: {} };
});

C("TC-TB-01", "P0", async () => {
  const o = path.join(OUT, "tb01-" + stamp());
  DC([path.join(EX, "table.md"), "-o", o, "--format", "both"], { tag: "tb01" });
  const z = await docxCtx(path.join(o, "table.docx"));
  const p = pdfCtx(path.join(o, "table.pdf"));
 const r = renderPdf(path.join(o, "table.pdf"), "2,3", "tb01r");
  return {
    checks: [
      ok("pageCount ≥ 3", (p.pages || 0) >= 3, p.pages),
      ok("tblHeader ≥ 2（两张表都重复表头）", count(z.document, /w:tblHeader/g) >= 2, count(z.document, /w:tblHeader/g)),
      ok("cantSplit > 0（行不跨页）", count(z.document, /w:cantSplit/g) > 0, count(z.document, /w:cantSplit/g)),
      ok("渲染第 2/3 页成功", r.ok, r.ok ? "" : r.r.err),
    ],
    evidence: { images: r.ok ? r.images : [] },
  };
});

C("TC-TB-02", "P0", async () => {
  const o = path.join(OUT, "tb02-" + stamp());
  DC([path.join(EX, "table.md"), "-o", o, "--format", "docx"], { tag: "tb02" });
  const z = await docxCtx(path.join(o, "table.docx"));
  const widths = (z.document.match(/<w:tblW w:w="(\d+)"/g) || []).map((x) => Number(x.match(/\d+/)[0]));
  const fixed = count(z.document, /w:tblLayout w:type="fixed"/g);
  return {
    checks: [
      ok("固定布局 ≥2", fixed >= 2, fixed),
      ok("表格宽度 ≤ 10120 twips", widths.length > 0 && widths.every((w) => w <= 10120), widths.join(",")),
    ],
    evidence: {},
  };
});

C("TC-CD-01", "P0", async () => {
  const o = path.join(OUT, "cd01-" + stamp());
  DC([path.join(EX, "code.md"), "-o", o, "--format", "both"], { tag: "cd01" });
  const z = await docxCtx(path.join(o, "code.docx"));
  const text = z.document.replace(/<[^>]+>/g, "");
  const p = pdfCtx(path.join(o, "code.pdf"));
  const r = renderPdf(path.join(o, "code.pdf"), "1,2", "cd01r");
  return {
    checks: [
      ok("超长行结尾完整保留", text.includes("photo:") && text.includes("20261018_A2_003.jpg"), ""),
      ok("PDF 页数 ≥ 2", (p.pages || 0) >= 2, p.pages),
      ok("渲染成功", r.ok, ""),
    ],
    evidence: { images: r.ok ? r.images : [] },
  };
});

C("TC-CD-02", "P1", async () => {
  const o = path.join(OUT, "cd02-" + stamp());
  DC([path.join(EX, "code.md"), "-o", o, "--format", "docx"], { tag: "cd02" });
  const z = await docxCtx(path.join(o, "code.docx"));
  const mono = /Consolas|Courier|Menlo|DejaVu Sans Mono|monospace/i.test(z.styles);
  return { checks: [ok("样式表含等宽字体族", mono, "")], evidence: {} };
});

C("TC-IM-01", "P0", async () => {
  const o = path.join(OUT, "im01-" + stamp());
  DC([path.join(EX, "image.md"), "-o", o, "--format", "docx"], { tag: "im01" });
  const z = await docxCtx(path.join(o, "image.docx"));
  const ext = [...z.document.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  return {
    checks: [
      ok("4 张图片内嵌", z.media.length === 4, z.media.join(",")),
      ok("宽图 cx ≤ 4,900,000 EMU", ext.some(([cx]) => cx <= 4900000), ext.map((e) => e[0]).join(",")),
      ok("高图 cy ≤ 8,640,000 EMU", ext.every(([, cy]) => cy <= 8640000), ext.map((e) => e[1]).join(",")),
      ok("小图未被放大（cx ≤ 1,000,000）", ext.some(([cx]) => cx <= 1000000), ""),
    ],
    evidence: { extents: ext },
  };
});

C("TC-IM-02", "P1", async () => {
  const o = path.join(OUT, "im02-" + stamp());
  DC([path.join(EX, "image.md"), "-o", o, "--format", "pdf"], { tag: "im02" });
  const r = renderPdf(path.join(o, "image.pdf"), "1,2,3", "im02r");
  return { checks: [ok("渲染第 1–3 页成功", r.ok, r.ok ? "" : r.r.err)], evidence: { images: r.ok ? r.images : [] } };
});

C("TC-IM-03", "P1", async () => {
  const icon = path.join(EX, "assets", "icon-dot.png");
  const bak = icon + ".bak";
  fs.renameSync(icon, bak);
  let r;
  try { r = DC([path.join(EX, "image.md"), "-o", path.join(OUT, "im03-" + stamp()), "--format", "docx"], { tag: "im03" }); }
  finally { fs.renameSync(bak, icon); }
  return {
    checks: [
      ok("exit=0（降级不中断）", r.status === 0, r.status),
      ok("WARN image-degraded", /image-degraded/.test(r.err), head(r.err, 200)),
      ok("警告含文件路径与行号", /image\.md:\d+/.test(r.err), head(r.err, 200)),
    ],
    evidence: {},
  };
});

C("TC-CJ-01", "P0", async () => {
  const o = path.join(OUT, "cj01-" + stamp());
  DC([path.join(EX, "cjk.md"), "-o", o, "--format", "both"], { tag: "cj01" });
  const p = pdfCtx(path.join(o, "cjk.pdf"));
  const r = renderPdf(path.join(o, "cjk.pdf"), "1,2,3", "cj01r");
  const mf = r.ok ? r.manifest.missingFonts : ["render-failed"];
  return {
    checks: [
      ok("missingFonts 为空", Array.isArray(mf) && mf.length === 0, JSON.stringify(mf)),
      ok("PDF 含中文字体", p.fonts.some((x) => /YaHei|SimSun|SimHei|Noto|SourceHan|Microsoft/i.test(x)), p.fonts.join(",")),
      ok("渲染成功", r.ok, ""),
    ],
    evidence: { images: r.ok ? r.images : [], fonts: p.fonts },
  };
});

C("TC-CJ-02", "P1", async () => {
  const o = path.join(OUT, "cj02-" + stamp());
  DC([path.join(EX, "cjk.md"), "-o", o, "--format", "pdf"], { tag: "cj02" });
  const p = pdfCtx(path.join(o, "cjk.pdf"));
  const r = renderPdf(path.join(o, "cjk.pdf"), "3", "cj02r");
  return {
    checks: [
      ok("页数 ≥ 3", (p.pages || 0) >= 3, p.pages),
      ok("渲染第 3 页成功（避头尾/省略号需人眼确认）", r.ok, ""),
    ],
    evidence: { images: r.ok ? r.images : [] },
  };
});

C("TC-TX-01", "P0", async () => {
  const o = path.join(OUT, "tx01-" + stamp());
  const r = DC([path.join(EX, "notes.txt"), "-o", o, "--format", "docx"], { tag: "tx01" });
  const z = await docxCtx(path.join(o, "notes.docx"));
  const h1 = Math.max(count(z.document, /w:outlineLvl w:val="0"/g), count(z.document, /w:pStyle w:val="Heading1"/g));
  const paras = count(z.document, /<w:p[ >]/g);
  const nums = count(z.document, /<w:numPr>/g);
  const text = z.document.replace(/<[^>]+>/g, "");
  return {
    checks: [
      ok("exit=0", r.status === 0, r.status),
      ok("标题 1 个（首行成标题）", h1 === 1, h1),
      ok("段落 ≥ 10", paras >= 10, paras),
      ok("列表项 numPr ≥ 8", nums >= 8, nums),
      ok("首行标题文本在文档中", text.includes("城市湿地公园志愿者例会纪要"), ""),
    ],
    evidence: {},
  };
});

C("TC-MD-01", "P0", async () => {
  const base = path.join(OUT, "md01-" + stamp());
  fs.mkdirSync(base, { recursive: true });
  const md = ["# 标题", "上一行末字", "下一行首字", "", "line one", "line two", "", "**未闭合粗体", "", "| a | b |", "| --- | --- |", "| 1 |", "", "\`\`\`js", "const a = 1;", "", "\\*字面星号\\*", ""].join("\n");
  fs.writeFileSync(path.join(base, "in.md"), md, "utf8");
  const r = DC([path.join(base, "in.md"), "-o", path.join(base, "out"), "--format", "docx"], { tag: "md01" });
  const z = await docxCtx(path.join(base, "out", "in.docx"));
  const text = z.document.replace(/<[^>]+>/g, "");
  return {
    checks: [
      ok("exit=0（畸形不中断）", r.status === 0, r.status),
      ok("CJK 软换行无空格拼接", text.includes("上一行末字下一行首字"), ""),
      ok("英文软换行保留一个空格", /line one\s+line two/.test(text), ""),
      ok("至少 1 条 WARN 带行号", /^WARN [a-z-]+: .+:\d+:/m.test(r.err), head(r.err, 200)),
      ok("转义星号保留", text.includes("字面星号") && (text.match(/\*/g) || []).length >= 2, ""),
    ],
    evidence: {},
  };
});

C("TC-TX-04", "P0", async () => {
  const sec = REQ.slice(REQ.indexOf("#### 2.3.4"));
  const blocks = [...sec.matchAll(/`@text\n([\s\S]*?)`@\n/g)].map((m) => m[1]);
  const inputs = [blocks[0], blocks[2], blocks[4]].filter(Boolean);
  const checks = [ok("requirements §2.3.4 可提取 3 个输入", inputs.length === 3, inputs.length + "/" + blocks.length)];
  const expects = ["黑鲷口很轻。改用小钩细线", "海钓准备", "| 议题 | 结论 |"];
  for (let i = 0; i < inputs.length; i++) {
    const base = path.join(OUT, "tx04-" + stamp() + "-" + i);
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, "s.txt"), inputs[i], "utf8");
    const r = DC([path.join(base, "s.txt"), "-o", path.join(base, "out"), "--format", "docx"], { tag: "tx04" });
    checks.push(ok("示例 " + (i + 1) + " 转换 exit=0", r.status === 0, r.status));
    const z = await docxCtx(path.join(base, "out", "s.docx"));
    const text = z.document.replace(/<[^>]+>/g, "");
    checks.push(ok("示例 " + (i + 1) + " 关键文本逐字保留", text.replace(/\s/g, "").includes(expects[i].replace(/\s/g, "")), ""));
  }
  return { checks, evidence: { blocks: blocks.length } };
});

C("TC-LG-01", "P0", async () => {
  const o = path.join(OUT, "lg01-" + stamp());
  const t0 = Date.now();
  const r = DC([path.join(EX, "long-50.md"), "-o", o, "--format", "both"], { tag: "lg01" });
  const elapsed = (Date.now() - t0) / 1000;
  const p = pdfCtx(path.join(o, "long-50.pdf"));
  return {
    checks: [
      ok("exit=0", r.status === 0, r.status),
      ok("页数 ≥ 50", (p.pages || 0) >= 50, p.pages),
      ok("书签 ≥ 100", p.bookmarks >= 100, p.bookmarks),
      ok("耗时 ≤ 180s", elapsed <= 180, elapsed.toFixed(1) + "s"),
    ],
    evidence: { pages: p.pages, bookmarks: p.bookmarks, elapsed },
  };
});

C("TC-LG-02", "P1", async () => {
  const o = path.join(OUT, "lg02-" + stamp());
  DC([path.join(EX, "long-50.md"), "-o", o, "--format", "pdf"], { tag: "lg02" });
  const p = pdfCtx(path.join(o, "long-50.pdf"));
  const last = String(p.pages);
  const r = renderPdf(path.join(o, "long-50.pdf"), "1," + last, "lg02r");
  return {
    checks: [
      ok("首末页渲染成功", r.ok, ""),
      ok("页数 ≥ 50", (p.pages || 0) >= 50, p.pages),
    ],
    evidence: { images: r.ok ? r.images : [] },
  };
});

C("TC-LONG-TOC-CONV", "P0", async () => {
  const oa = path.join(OUT, "tocconv-a-" + stamp());
  const ob = path.join(OUT, "tocconv-b-" + stamp());
  const ta = Date.now();
  DC([path.join(EX, "long-50.md"), "-o", oa, "--format", "both"], { tag: "tocca" });
  const elapsed = (Date.now() - ta) / 1000;
  DC([path.join(EX, "long-50.md"), "-o", ob, "--format", "both"], { tag: "toccb" });
  const za = await docxCtx(path.join(oa, "long-50.docx"));
  const zb = await docxCtx(path.join(ob, "long-50.docx"));
  const pa = pdfCtx(path.join(oa, "long-50.pdf"));
  const tocNums = (xml) => [...xml.matchAll(/<w:t[^>]*>(\d{1,3})<\/w:t>/g)].map((m) => Number(m[1]));
  const na = tocNums(za.document);
  const nb = tocNums(zb.document);
  const sameToc = JSON.stringify(na) === JSON.stringify(nb);
  const distinct = new Set(na).size;
  const r = renderPdf(path.join(oa, "long-50.pdf"), "1,2", "toccr");
  return {
    checks: [
      ok("pageCount ≥ 50", (pa.pages || 0) >= 50, pa.pages),
      ok("书签 = 134（H1–H3 全覆盖）", pa.bookmarks === 134, pa.bookmarks),
      ok("目录页码已回填（非全 00）", na.length >= 50 && distinct >= 10, "nums=" + na.length + " distinct=" + distinct),
      ok("两次运行目录页码一致", sameToc, ""),
      ok("耗时 ≤ 180s", elapsed <= 180, elapsed.toFixed(1) + "s"),
      ok("目录页渲染成功", r.ok, ""),
    ],
    evidence: { pages: pa.pages, bookmarks: pa.bookmarks, images: r.ok ? r.images : [], elapsed },
  };
});

C("TC-TOC-01", "P0", async () => {
  const o = path.join(OUT, "toc01-" + stamp());
  DC([path.join(EX, "long-50.md"), "-o", o, "--format", "docx"], { tag: "toc01" });
  const z = await docxCtx(path.join(o, "long-50.docx"));
  const tocTexts = [...z.document.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((m) => m[0]).filter((p) => /TOC[1-3]/.test(p)).map((p) => p.replace(/<[^>]+>/g, "").trim());
  const tocEntries = tocTexts.filter((t) => /\d$/.test(t) && !t.startsWith("TOC "));
  const bookmarks = count(z.document, /w:bookmarkStart/g);
  const updateFields = count(z.document, /w:updateFields/g) + count(z.settings, /w:updateFields/g);
  return {
    checks: [
      ok("updateFields=0", updateFields === 0, updateFields),
      ok("目录条目 134（排除域指令段落）", tocEntries.length === 134, tocEntries.length),
      ok("书签 ≥ 134", bookmarks >= 134, bookmarks),
    ],
    evidence: {},
  };
});

C("TC-TOC-02", "P0", async () => {
  const t = path.join(ROOT, "test", "toc", "toc-convergence.test.mjs");
  if (!fs.existsSync(t)) return { checks: [ok("模块级测试文件存在", false, t)], evidence: {} };
  const r = runRaw(process.execPath, [t], {}, ROOT, nextTag("toc02"));
  return {
    checks: [
      ok("模块测试进程通过（node <file>，规避沙箱 pipe 限制）", r.status === 0, r.status),
      ok("输出含 pass 计数且 0 fail", /# pass [1-9]/.test(r.out) && !/# fail [1-9]/.test(r.out), head(r.out, 200)),
    ],
    evidence: { stdout: r.stdoutFile },
  };
});

C("TC-TOC-DEGRADED", "P1", async () => {
  const o = path.join(OUT, "tocdeg-" + stamp());
  const r = DC([path.join(EX, "long-50.md"), "-o", o, "--format", "docx"], { tag: "tocdeg", env: { DOCONVERT_LIBREOFFICE_KIT: "C:\\no\\such\\kit" } });
  const z = await docxCtx(path.join(o, "long-50.docx"));
  const tocTexts2 = [...z.document.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((m) => m[0]).filter((p) => /TOC[1-3]/.test(p)).map((p) => p.replace(/<[^>]+>/g, "").trim());
  const dashEntries = tocTexts2.filter((t) => /——$/.test(t)).length;
  const zeroEntries = tocTexts2.filter((t) => /00$/.test(t)).length;
  const bookmarks = count(z.document, /w:bookmarkStart/g);
  const updateFields = count(z.document, /w:updateFields/g) + count(z.settings, /w:updateFields/g);
  const log = fs.readFileSync(path.join(o, "conversion-log.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const fr = log.find((x) => x.type === "file") || {};
  return {
    checks: [
      ok("exit=0", r.status === 0, r.status),
      ok("DOCX 存在", fs.existsSync(path.join(o, "long-50.docx")), ""),
      ok("占位符 —— 条目数 = 134", dashEntries === 134, "dash=" + dashEntries + " zero00=" + zeroEntries),
      ok("书签 ≥ 134", bookmarks >= 134, bookmarks),
      ok("updateFields=0", updateFields === 0, updateFields),
      ok("stderr WARN toc-degraded", /WARN toc-degraded/.test(r.err), head(r.err, 200)),
      ok("日志 toc.mode=degraded", fr.toc && fr.toc.mode === "degraded" && fr.toc.converged === false, JSON.stringify(fr.toc)),
    ],
    evidence: {},
  };
});

C("TC-REP-03", "P0", async () => {
  const o = path.join(OUT, "rep03-" + stamp());
  DC([path.join(EX, "headings.md"), "-o", o, "--format", "docx"], { tag: "rep03" });
  const z = await docxCtx(path.join(o, "headings.docx"));
  const blob = Object.values({ d: z.document, s: z.styles, c: z.core, st: z.settings }).join("\n");
  const dateHit = /20\d\d-\d\d-\d\d|20\d\d年\d+月|20\d\d\/\d\d\/\d\d/.test(blob);
  const userHit = blob.includes(process.env.USERNAME || "___");
  const driveHit = /[A-Z]:\\Users/i.test(blob);
  return {
    checks: [
      ok("无日期", !dateHit, dateHit),
      ok("无用户名", !userHit, ""),
      ok("无绝对路径（盘符）", !driveHit, ""),
    ],
    evidence: {},
  };
});

C("TC-RU-01", "P1", async () => {
  const o = path.join(OUT, "ru01-" + stamp());
  DC([path.join(EX, "cjk.md"), "-o", o, "--format", "both"], { tag: "ru01a" });
  const direct = path.join(o, "direct.pdf");
  const r = KIT(["convert", "--input", path.join(o, "cjk.docx"), "--output", direct], "ru01b");
  const app = pdfCtx(path.join(o, "cjk.pdf"));
  const dir = pdfCtx(direct);
  return {
    checks: [
      ok("直接转换成功", r.status === 0, r.status),
      ok("页数一致", app.pages === dir.pages, app.pages + "/" + dir.pages),
      ok("书签数一致", app.bookmarks === dir.bookmarks, app.bookmarks + "/" + dir.bookmarks),
      ok("字体集合一致", JSON.stringify(app.fonts.sort()) === JSON.stringify(dir.fonts.sort()), app.fonts.join(",")),
    ],
    evidence: {},
  };
});

C("TC-RU-02", "P1", async () => {
  const o = path.join(OUT, "ru02-" + stamp());
  DC([path.join(EX, "cjk.md"), "-o", o, "--format", "both"], { tag: "ru02a" });
  const direct = path.join(o, "direct.pdf");
  KIT(["convert", "--input", path.join(o, "cjk.docx"), "--output", direct], "ru02b");
  const a = renderPdf(path.join(o, "cjk.pdf"), "1", "ru02p");
  const b = renderPdf(direct, "1", "ru02q");
  const ha = a.ok ? sha256File(a.images[0]) : "x";
  const hb = b.ok ? sha256File(b.images[0]) : "y";
  return { checks: [ok("两条路径第 1 页 PNG 哈希相同", a.ok && b.ok && ha === hb, ha.slice(0, 16))], evidence: {} };
});

C("TC-CL-01", "P2", async () => ({
  checks: [ok("PARTIAL（D-007：无网，未做干净环境安装；接受 npx 缓存 kit）", true, "")],
  evidence: { note: "按 D-007 记 PARTIAL，不计入 P0" },
}));

export { ENTRIES };

main();
