/**
 * cli：参数解析 / 输入收集 / 端到端编排 / 汇总 / doctor（architecture §3.9、§9、§10.3）。
 *
 * 冻结签名（§3.12）：
 *   export function parseArgs(argv) {}
 *   export async function collectInputs(inputs, options) {}
 *   export async function runCli(argv, io) {}
 *
 * 职责边界：本模块**不解析内容、不碰样式**；只做参数、输入展开、预检、逐文件编排、
 * 汇总、退出码与日志组装。TOC 两遍法由 src/toc（卡 4）的 renderWithToc 负责。
 *
 * @module cli
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdir, readFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { DocconvertError, formatErrorLines, isDocconvertError, toDocconvertError } from "../contracts/errors.js";
import {
  DEFAULT_OUT_DIR_NAME,
  DOCX_EXT,
  LOG_FILE_NAME,
  PDF_EXT,
  PROGRAM_NAME,
  TOC_MODE,
  TOC_DEPTH,
} from "../contracts/index.js";
import { toWriteError } from "../contracts/output-errors.js";
import { loadConfig, valueAt } from "../config/index.js";
import { collectTocEntries, isLongDoc, renderDocx } from "../docx/index.js";
import { locateKit, probeEngine } from "../kit/index.js";
import { buildFileRecord, buildRunRecord, writeConversionLog } from "../log/index.js";
import { renderPdf } from "../pdf/index.js";
import { preprocess } from "../preprocess/index.js";
import { helpText } from "./help.js";
import { assertNodeVersion, inspectTemplate, platformInfo, probeFonts, sha256File } from "./precheck.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

/** 程序安装目录（不是 CWD，architecture §3.7）。 */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Windows / macOS 的文件系统大小写不敏感（REQ-PLAT-006）。 */
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

/** @param {string} value */
const pathKey = (value) => (CASE_INSENSITIVE_FS ? value.toLowerCase() : value);

/** 允许的扩展名（大小写不敏感）。 */
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

/** 目录页码降级文案（写死，requirements §6.2）。 */
const TOC_DEGRADED_MESSAGE = "PDF 引擎不可用，目录页码以占位符显示（见 README 已知限制）";

/**
 * 降级态目录页码占位符（全角破折号，与 src/toc 的 TOC_DEGRADED_PLACEHOLDER 一致）。
 * 这里镜像一份常量：CLI 对 toc 模块是懒加载的，toc 模块不可用时的降级路径也必须生效，
 * 不能依赖 import 成功。两处取值必须保持一致（gate 2 TC-TOC-DEGRADED 断言 '——'）。
 */
const TOC_DEGRADED_PLACEHOLDER = "——";

/** 同一文件同一告警码在 stderr 最多打印的条数（REQ-ELEM-29）。 */
const WARN_DETAIL_LIMIT = 3;

/** 本次进程内缓存：kit 定位、engine 探测、toc 模块。 */
/** @type {import("../contracts/index.js").KitLocation | null} */
let cachedKit = null;
/** @type {import("../contracts/index.js").EngineProbe | null} */
let cachedEngine = null;
/** @type {Promise<any> | null} */
let tocModulePromise = null;

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

/**
 * 解析 argv；非法输入抛 usage-error（退出码 2）。重复选项最后一个生效（REQ-CLI-008）。
 * @param {string[]} argv
 * @returns {import("../contracts/index.js").CliOptions}
 */
export function parseArgs(argv) {
  /** @type {import("../contracts/index.js").CliOptions} */
  const options = {
    inputs: [],
    outDir: "",
    recursive: false,
    formats: ["docx", "pdf"],
    continueOnError: false,
    help: false,
    version: false,
  };
  let positionalOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && arg.length > 1 && arg.startsWith("-")) {
      let name = arg;
      let inlineValue = "";
      const eq = arg.indexOf("=");
      if (arg.startsWith("--") && eq > 0) {
        name = arg.slice(0, eq);
        inlineValue = arg.slice(eq + 1);
      }
      switch (name) {
        case "-h":
        case "--help":
          options.help = true;
          break;
        case "-V":
        case "--version":
          options.version = true;
          break;
        case "-r":
        case "--recursive":
          options.recursive = true;
          break;
        case "--continue-on-error":
          options.continueOnError = true;
          break;
        case "-o":
        case "--outdir": {
          const value = inlineValue || argv[++i];
          if (value === undefined || value === "") {
            throw new DocconvertError("usage-error", `选项 ${name} 缺少目录参数`, {
              hint: "用法：-o <输出目录>",
              detail: { option: name },
            });
          }
          options.outDir = value;
          break;
        }
        case "--format": {
          const value = inlineValue || argv[++i];
          if (value === undefined) {
            throw new DocconvertError("usage-error", "选项 --format 缺少取值", {
              hint: "取值：docx / pdf / both",
              detail: { option: "--format" },
            });
          }
          if (value === "docx") options.formats = ["docx"];
          else if (value === "pdf") options.formats = ["pdf"];
          else if (value === "both") options.formats = ["docx", "pdf"];
          else {
            throw new DocconvertError("usage-error", `--format 取值非法：${value}`, {
              hint: "取值：docx / pdf / both",
              detail: { option: "--format", value },
            });
          }
          break;
        }
        default:
          throw new DocconvertError("usage-error", `未知选项：${arg}`, {
            hint: "运行 docconvert --help 查看用法",
            detail: { option: arg },
          });
      }
      continue;
    }
    options.inputs.push(arg);
  }

  if (options.help || options.version) return options;
  if (options.inputs.length === 0) {
    throw new DocconvertError("usage-error", "缺少输入文件或目录", {
      hint: "用法：docconvert <input...> [选项]",
    });
  }
  return options;
}

// ---------------------------------------------------------------------------
// collectInputs
// ---------------------------------------------------------------------------

/**
 * 展开输入、跳过规则、冲突预检（REQ-BATCH-001/002/010）。
 * @param {string[]} inputs
 * @param {{ outDir: string, recursive: boolean, cwd: string }} options
 * @returns {Promise<import("../contracts/index.js").InputPlan>}
 */
export async function collectInputs(inputs, options) {
  const cwd = options.cwd ?? process.cwd();
  const outDirAbs = resolve(cwd, options.outDir);
  /** @type {Array<import("../contracts/index.js").InputItem>} */
  const items = [];

  for (const input of inputs) {
    const absolutePath = resolve(cwd, input);
    let info;
    try {
      info = await stat(absolutePath);
    } catch (error) {
      throw mapAccessError(error, absolutePath);
    }
    if (info.isDirectory()) {
      const files = await collectDirectoryFiles(absolutePath, {
        recursive: options.recursive,
        outDirAbs,
      });
      if (files.length === 0) {
        throw new DocconvertError("no-input-files", `目录内没有可转换的 .md / .txt 文件：${absolutePath}`, {
          detail: { path: absolutePath, recursive: options.recursive },
        });
      }
      for (const file of files) {
        const rel = relative(absolutePath, file);
        const extension = extname(rel);
        items.push({
          absolutePath: file,
          relOutBase: rel.slice(0, -extension.length).split(sep).join("/"),
          format: extension.toLowerCase() === ".md" ? "md" : "txt",
        });
      }
    } else if (info.isFile()) {
      const extension = extname(absolutePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new DocconvertError("unsupported-extension", `不支持的扩展名：${extension || "(无扩展名)"}（${absolutePath}）`, {
          detail: { path: absolutePath, extension },
        });
      }
      items.push({
        absolutePath,
        relOutBase: basename(absolutePath, extname(absolutePath)),
        format: extension === ".md" ? "md" : "txt",
      });
    } else {
      throw new DocconvertError("input-not-found", `输入既不是文件也不是目录：${absolutePath}`, {
        detail: { path: absolutePath },
      });
    }
  }

  items.sort((a, b) => (a.relOutBase < b.relOutBase ? -1 : a.relOutBase > b.relOutBase ? 1 : 0));

  const inputKeys = new Set(items.map((item) => pathKey(item.absolutePath)));
  /** @type {Map<string, { outPath: string, inputs: string[], conflictsWithInput?: boolean }>} */
  const byOutput = new Map();
  for (const item of items) {
    for (const extension of [DOCX_EXT, PDF_EXT]) {
      const outPath = join(outDirAbs, ...`${item.relOutBase}${extension}`.split("/"));
      const key = pathKey(outPath);
      if (!byOutput.has(key)) byOutput.set(key, { outPath, inputs: [] });
      const entry = byOutput.get(key);
      if (entry) {
        entry.inputs.push(item.absolutePath);
        if (inputKeys.has(key)) entry.conflictsWithInput = true;
      }
    }
  }
  const conflicts = [];
  for (const entry of byOutput.values()) {
    if (entry.inputs.length > 1 || entry.conflictsWithInput) {
      conflicts.push({ outPath: entry.outPath, inputs: entry.inputs });
    }
  }
  return { items, conflicts, skipped: [], outDirAbs };
}

/**
 * @param {string} directory
 * @param {{ recursive: boolean, outDirAbs: string }} options
 * @returns {Promise<string[]>}
 */
async function collectDirectoryFiles(directory, options) {
  const outKey = pathKey(resolve(options.outDirAbs));
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      throw new DocconvertError("input-permission", `无法读取目录：${current}`, {
        hint: "检查目录访问权限后重试",
        detail: { path: current },
        cause: error,
      });
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // 隐藏文件/目录
      if (entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) continue; // 不跟随符号链接/联接点
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        if (pathKey(absolute) === outKey) continue; // 输出目录自身
        if (options.recursive) stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) continue;
      files.push(absolute);
    }
  }
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return files;
}

/**
 * @param {unknown} error
 * @param {string} absolutePath
 * @returns {DocconvertError}
 */
function mapAccessError(error, absolutePath) {
  const code = error && typeof error === "object" ? error.code : "";
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new DocconvertError("input-not-found", `输入路径不存在：${absolutePath}`, {
      hint: "检查路径拼写；路径含空格时加引号",
      detail: { path: absolutePath },
      cause: error,
    });
  }
  if (code === "EACCES" || code === "EPERM") {
    return new DocconvertError("input-permission", `无法访问输入路径：${absolutePath}`, {
      detail: { path: absolutePath },
      cause: error,
    });
  }
  return new DocconvertError("input-not-found", `无法访问输入路径：${absolutePath}`, {
    detail: { path: absolutePath },
    cause: error,
  });
}

// ---------------------------------------------------------------------------
// TOC 决策（纯函数，便于单测）
// ---------------------------------------------------------------------------

/**
 * 决定本文件的目录策略（architecture §3.8 / §9.5 C-ARCH-01 裁决 (a)）。
 *
 * - 短文（条目数 < 阈值）：单遍，不写目录、不调用引擎（REQ-LAY-001）。
 * - 长文 + 产 PDF：两遍法（renderWithToc）。
 * - 长文 + 仅 docx + 引擎可用：仍做一次测量（两遍法），拿到正确页码。
 * - 长文 + 仅 docx + 引擎不可用：**降级**（目录条目完整、页码占位、WARN toc-degraded、退出码 0）。
 *
 * @param {{ entryCount: number, threshold: number, wantPdf: boolean, kitAvailable: boolean }} input
 * @returns {{ mode: "single" | "two-pass" | "degraded", long: boolean }}
 */
export function planTocDecision({ entryCount, threshold, wantPdf, kitAvailable }) {
  const long = entryCount >= threshold;
  if (!long) return { mode: "single", long: false };
  if (wantPdf) return { mode: "two-pass", long: true };
  return kitAvailable ? { mode: "two-pass", long: true } : { mode: "degraded", long: true };
}

/**
 * 两遍法模块是否可用（卡 4 的 src/toc/index.js）。仅用于集成过渡期的显式降级判断。
 * @returns {Promise<boolean>}
 */
async function isTocModuleAvailable() {
  try {
    await getTocModule();
    return true;
  } catch {
    return false;
  }
}

/**
 * 懒加载两遍法模块（src/toc，卡 4）。缺失时明确报错，不静默降级。
 * @returns {Promise<{ renderWithToc: Function }>}
 */
async function getTocModule() {
  if (!tocModulePromise) tocModulePromise = import("../toc/index.js");
  try {
    const module = await tocModulePromise;
    if (typeof module.renderWithToc !== "function") {
      throw new Error("src/toc/index.js 未导出 renderWithToc");
    }
    return module;
  } catch (error) {
    throw new DocconvertError("convert-failed", "长文档目录两遍法模块不可用（src/toc/index.js）", {
      hint: "重新安装 docconvert；或改用 --format docx 并接受目录页码占位（C-ARCH-01 (a)）",
      detail: { kind: "toc-module-missing" },
      cause: error,
    });
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/**
 * ISO 8601 含时区偏移（日志要求）。
 * @param {Date} [date]
 * @returns {string}
 */
function nowIso(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T`
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    + `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/**
 * 用户可见路径：能相对 CWD 就相对，否则绝对。
 * @param {string} absolutePath
 * @param {string} cwd
 * @returns {string}
 */
function displayPath(absolutePath, cwd) {
  const rel = relative(cwd, absolutePath);
  return rel && !rel.startsWith("..") && !rel.includes(":") ? rel : absolutePath;
}

/**
 * 读取输入文件的真实事实（bytes / sha256 / extension）；失败则返回零值。
 * 输入哈希按 SourceMeta 约定用大写（architecture §3.1.2）。
 * @param {string} absolutePath
 * @returns {Promise<{ path: string, bytes: number, sha256: string, encoding: string, extension: string }>}
 */
async function readInputFacts(absolutePath) {
  const extension = extname(absolutePath).toLowerCase();
  try {
    const info = await stat(absolutePath);
    const buffer = await readFile(absolutePath);
    return {
      path: absolutePath,
      bytes: info.size,
      sha256: createHash("sha256").update(buffer).digest("hex").toUpperCase(),
      encoding: "unknown",
      extension,
    };
  } catch {
    return { path: absolutePath, bytes: 0, sha256: "", encoding: "unknown", extension };
  }
}

/**
 * 由磁盘文件重算产物事实（REQ-LOG-004）；sha256 小写（TC-LOG-01）。
 * @param {string} filePath
 * @returns {Promise<{ path: string, bytes: number, sha256: string }>}
 */
async function productFacts(filePath) {
  const info = await stat(filePath);
  return { path: filePath, bytes: info.size, sha256: await sha256File(filePath) };
}

/**
 * 打印告警（stderr；同文件同 code 最多 3 条，第 4 条起折叠，REQ-ELEM-29）。
 * @param {Array<{ code: string, line?: number, message: string }>} warnings
 * @param {string} fileDisplay
 * @param {(line: string) => void} writeErr
 */
function printWarnings(warnings, fileDisplay, writeErr) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Map<string, number>} */
  const omitted = new Map();
  for (const warning of warnings) {
    const code = warning.code;
    const seen = counts.get(code) ?? 0;
    counts.set(code, seen + 1);
    if (seen < WARN_DETAIL_LIMIT) {
      const location = warning.line === undefined ? fileDisplay : `${fileDisplay}:${warning.line}`;
      writeErr(`WARN ${code}: ${location}: ${warning.message}`);
    } else {
      omitted.set(code, (omitted.get(code) ?? 0) + 1);
    }
  }
  for (const [code, count] of omitted) {
    writeErr(`WARN ${code}: ${fileDisplay}: 另有 ${count} 处同类告警已省略（详见 conversion-log.jsonl）`);
  }
}

/**
 * 本次运行独占临时目录（系统临时区，由 cli 创建/清理）。
 * @returns {Promise<string>}
 */
async function createWorkDir() {
  return mkdtemp(join(tmpdir(), "docconvert-"));
}

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

/**
 * CLI 唯一入口：返回退出码（不调用 process.exit，architecture §3.0）。
 * @param {string[]} argv 不含程序路径的原始参数
 * @param {{ stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, env?: NodeJS.ProcessEnv, cwd?: string }} [io]
 * @returns {Promise<number>}
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const writeOut = (line) => { stdout.write(`${line}\n`); };
  const writeErr = (line) => { stderr.write(`${line}\n`); };

  if (argv[0] === "doctor") {
    return runDoctor(argv.slice(1), { writeOut, writeErr, env });
  }

  /** @type {import("../contracts/index.js").CliOptions} */
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    return reportFatal(error, writeErr);
  }

  if (options.help) {
    writeOut(helpText());
    return 0;
  }
  if (options.version) {
    try {
      const { lines } = await buildVersionInfo(env);
      for (const line of lines) writeOut(line);
      return 0;
    } catch (error) {
      return reportFatal(error, writeErr);
    }
  }

  try {
    return await runConversion(options, { writeOut, writeErr, env, cwd, argv });
  } catch (error) {
    return reportFatal(error, writeErr);
  }
}

/**
 * 打印错误（不含堆栈）并返回退出码。
 * @param {unknown} error
 * @param {(line: string) => void} writeErr
 * @returns {number}
 */
function reportFatal(error, writeErr) {
  const docError = toDocconvertError(error);
  for (const line of formatErrorLines(docError)) writeErr(line);
  return docError.exitCode;
}

// ---------------------------------------------------------------------------
// 转换主流程
// ---------------------------------------------------------------------------

/**
 * @param {import("../contracts/index.js").CliOptions} options
 * @param {{ writeOut: (line: string) => void, writeErr: (line: string) => void, env: NodeJS.ProcessEnv, cwd: string, argv: string[] }} ctx
 * @returns {Promise<number>}
 */
async function runConversion(options, ctx) {
  const { writeOut, writeErr, env, cwd, argv } = ctx;
  const runStartedAt = new Date();

  // 预检 ① Node 版本
  assertNodeVersion(process.versions.node);

  // 预检 ② 内置配置 + 模板（含双源一致性与必需样式）
  const { config } = await loadConfig({ packageRoot: PACKAGE_ROOT });
  const template = await inspectTemplate({ packageRoot: PACKAGE_ROOT, config });

  const wantDocx = options.formats.includes("docx");
  const wantPdf = options.formats.includes("pdf");

  // 预检 ③ 需要 PDF 时引擎可解析（docx-only 不阻断：见 §9.5 C-ARCH-01 (a)）
  /** @type {import("../contracts/index.js").KitLocation | null} */
  let kit = null;
  /** @type {import("../contracts/index.js").EngineProbe | null} */
  let engine = null;
  if (wantPdf) {
    kit = getKit(env);
    engine = await probeEngineChecked(kit);
  }

  // 预检 ④ 字体栈探测（不阻断）
  const fontsProbe = await probeFonts();
  if (fontsProbe.fallback) {
    writeErr(`WARN font-fallback: 首选字体不可用，已回退到 ${fontsProbe.fontStack.latin} / ${fontsProbe.fontStack.cjk} / ${fontsProbe.fontStack.mono}`);
  }

  const outDirName = String(valueAt(config, "output.dirName") ?? DEFAULT_OUT_DIR_NAME);
  const docxExt = String(valueAt(config, "output.docxExt") ?? DOCX_EXT);
  const pdfExt = String(valueAt(config, "output.pdfExt") ?? PDF_EXT);
  const logFileName = String(valueAt(config, "log.fileName") ?? LOG_FILE_NAME);
  const tocDepth = Number(valueAt(config, "toc.depth") ?? TOC_DEPTH);
  const longDocThreshold = Number(valueAt(config, "layout.longdocHeadingThreshold") ?? 3);

  const outDirAbs = resolveOutDir(options, cwd, outDirName);
  const outDirInfo = await stat(outDirAbs).catch(() => null);
  if (outDirInfo && !outDirInfo.isDirectory()) {
    throw new DocconvertError("usage-error", `-o 指向的文件已存在，不是目录：${outDirAbs}`, {
      detail: { outDir: outDirAbs },
    });
  }

  // 预检 ⑤ 输入展开 + 输出冲突（转换前整体失败，不写产物）
  const plan = await collectInputs(options.inputs, {
    outDir: outDirAbs,
    recursive: options.recursive,
    cwd,
  });
  if (plan.conflicts.length > 0) {
    const conflict = plan.conflicts[0];
    throw new DocconvertError(
      "output-conflict",
      `多个输入映射到同一输出路径：${conflict.outPath}（${conflict.inputs.join("、")}）`,
      {
        hint: "改用独立的 -o 输出目录，或给同名文件改名",
        detail: { conflicts: plan.conflicts },
      },
    );
  }

  try {
    await mkdir(outDirAbs, { recursive: true });
  } catch (error) {
    throw toWriteError(error, { target: outDirAbs, what: "输出目录" });
  }

  /** @type {string} */
  let workDir;
  try {
    workDir = await createWorkDir();
  } catch (error) {
    throw new DocconvertError("output-not-writable", `无法创建临时工作目录：${error && error.message ? error.message : error}`, {
      hint: "检查系统临时目录权限（TEMP/TMP）",
      detail: { kind: "workdir" },
      cause: error,
    });
  }

  const program = { name: PROGRAM_NAME, version: String(pkg.version) };
  const platform = platformInfo();
  /** @type {{latin: string, cjk: string, mono: string}} */
  const fontStack = fontsProbe.fontStack;

  const counts = { total: plan.items.length, ok: 0, failed: 0, skipped: 0 };
  /** @type {Array<Record<string, unknown>>} */
  const records = [];
  /** @type {Array<{ item: import("../contracts/index.js").InputItem, code: string }>} */
  const failures = [];
  let firstFailureExitCode = 0;
  let stopProcessing = false;
  let anyDegraded = false;
  let usedPdfEngine = false;
  let tempIndex = 0;

  try {
    for (const item of plan.items) {
      const itemStartedAt = new Date();
      const itemDisplay = displayPath(item.absolutePath, cwd);

      if (stopProcessing) {
        counts.skipped += 1;
        const facts = await readInputFacts(item.absolutePath);
        records.push(buildFileRecord({
          program,
          template: { version: template.version },
          pdfKit: null,
          fonts: fontStack,
          command: [...argv],
          platform,
          input: facts,
          outputs: [],
          status: "skipped",
          errorCode: null,
          warnings: [],
          toc: { mode: TOC_MODE, entries: 0, passes: 1, converged: true },
          startedAt: nowIso(itemStartedAt),
          endedAt: nowIso(),
          durationMs: Math.max(0, Math.round(Date.now() - itemStartedAt.getTime())),
        }));
        writeOut(`SKIP ${itemDisplay}`);
        continue;
      }

      /** @type {Array<{ format: "docx"|"pdf", path: string, bytes: number, sha256: string, durationMs: number }>} */
      const outputs = [];
      /** @type {import("../contracts/index.js").AstDocument | null} */
      let ast = null;
      let errorCode = null;
      let status = "ok";
      /** @type {Array<{code: string, line?: number, message: string}>} */
      let warnings = [];
      let tocReport = { mode: /** @type {"two-pass"|"degraded"} */ (TOC_MODE), entries: 0, passes: /** @type {1|2} */ (1), converged: true };

      try {
        ast = await preprocess(item.absolutePath);
        const tocEntries = collectTocEntries(ast, { depth: tocDepth });
        warnings = (ast.warnings ?? []).map((warning) => ({
          code: warning.code,
          ...(warning.line === undefined ? {} : { line: warning.line }),
          message: warning.message,
        }));

        const docxPath = join(outDirAbs, ...`${item.relOutBase}${docxExt}`.split("/"));
        const pdfPath = join(outDirAbs, ...`${item.relOutBase}${pdfExt}`.split("/"));

        const longDoc = isLongDoc(tocEntries, longDocThreshold);
        let docxOnlyKit = kit;
        if (longDoc && !wantPdf && !docxOnlyKit) {
          // 长文 + 仅 docx：引擎可用则做一次测量，不可用则降级（C-ARCH-01 (a)）。
          docxOnlyKit = tryKit(env);
        }
        let decision = planTocDecision({
          entryCount: tocEntries.length,
          threshold: longDocThreshold,
          wantPdf,
          kitAvailable: Boolean(docxOnlyKit),
        });
        if (decision.mode === "two-pass" && !(await isTocModuleAvailable())) {
          // 集成过渡：卡 4 的 src/toc 尚未落地时，两遍法不可用。按 C-ARCH-01 (a) 的
          // 降级口径显式交付「目录条目完整 + 页码占位」，并写 WARN toc-degraded（不静默）。
          // 卡 4 的 src/toc/index.js 就绪后本分支自动消失（无需改契约）。
          decision = { mode: "degraded", long: true };
        }

        if (decision.mode === "two-pass") {
          const startedAll = Date.now();
          const tocModule = await getTocModule();
          const result = await tocModule.renderWithToc(ast, {
            outDir: dirname(docxPath),
            workDir,
            templatePath: template.absolutePath,
            wantDocx,
            wantPdf,
            kit: docxOnlyKit,
            tocThreshold: longDocThreshold,
            timeoutMs: 120000,
          });
          const totalMs = Math.max(0, Date.now() - startedAll);
          if (result.docx) {
            const facts = await productFacts(result.docx.outputPath);
            outputs.push({ format: "docx", path: facts.path, bytes: facts.bytes, sha256: facts.sha256, durationMs: totalMs });
          }
          if (result.pdf) {
            const facts = await productFacts(result.pdf.outputPath);
            outputs.push({ format: "pdf", path: facts.path, bytes: facts.bytes, sha256: facts.sha256, durationMs: totalMs });
            usedPdfEngine = true;
          }
          if (result.toc) tocReport = { ...result.toc };
          if (Array.isArray(result.warnings)) {
            warnings = warnings.concat(result.warnings.map((warning) => ({
              code: warning.code,
              ...(warning.line === undefined ? {} : { line: warning.line }),
              message: warning.message,
            })));
          }
          if (tocReport.mode === "degraded") anyDegraded = true;
        } else {
          if (decision.mode === "degraded") {
            // 长文 + 无引擎（或两遍法模块未就绪）：目录条目完整、页码占位、显式告警、退出码 0。
            warnings.push({ code: "toc-degraded", message: TOC_DEGRADED_MESSAGE });
            anyDegraded = true;
            tocReport = { mode: "degraded", entries: tocEntries.length, passes: 1, converged: false };
          } else {
            tocReport = { mode: TOC_MODE, entries: tocEntries.length, passes: 1, converged: true };
          }
          /** @type {{ templatePath: string, tocNumbers: null, tocPlaceholder?: string }} */
          const docxOptions = { templatePath: template.absolutePath, tocNumbers: null };
          if (decision.mode === "degraded") {
            // 降级：页码列用占位符（不是默认的 '00'），避免看起来像正确页码。
            docxOptions.tocPlaceholder = TOC_DEGRADED_PLACEHOLDER;
          }
          /** @type {string | null} */
          let docxForPdf = null;
          if (wantDocx) {
            const docxStarted = Date.now();
            const docxResult = await renderDocx(ast, docxPath, docxOptions);
            const facts = await productFacts(docxResult.outputPath);
            outputs.push({ format: "docx", path: facts.path, bytes: facts.bytes, sha256: facts.sha256, durationMs: Math.max(0, Date.now() - docxStarted) });
            docxForPdf = docxResult.outputPath;
          }
          if (wantPdf && kit) {
            if (!docxForPdf) {
              tempIndex += 1;
              const safeName = item.relOutBase.replace(/[\\/:*?"<>|]/g, "_");
              const tempDocxPath = join(workDir, `src-${tempIndex}-${safeName}${docxExt}`);
              const tempResult = await renderDocx(ast, tempDocxPath, docxOptions);
              docxForPdf = tempResult.outputPath;
            }
            const pdfStarted = Date.now();
            const pdfResult = await renderPdf(docxForPdf, pdfPath, { kit, workDir });
            const facts = await productFacts(pdfResult.outputPath);
            outputs.push({ format: "pdf", path: facts.path, bytes: facts.bytes, sha256: facts.sha256, durationMs: Math.max(0, Date.now() - pdfStarted) });
            usedPdfEngine = true;
            for (const font of pdfResult.missingFonts) {
              warnings.push({ code: "font-fallback", message: `PDF 引擎缺少字体 ${font}` });
            }
          }
        }

        printWarnings(warnings, itemDisplay, writeErr);
      } catch (error) {
        const docError = isDocconvertError(error) ? error : toDocconvertError(error);
        errorCode = docError.code;
        status = outputs.length > 0 ? "partial" : "failed";
        for (const line of formatErrorLines(docError)) writeErr(line);
        if (!options.continueOnError) {
          stopProcessing = true;
          firstFailureExitCode = firstFailureExitCode || docError.exitCode;
        } else if (firstFailureExitCode === 0) {
          firstFailureExitCode = docError.exitCode;
        }
        failures.push({ item, code: docError.code });
      }

      if (status === "ok") counts.ok += 1;
      else counts.failed += 1;

      const inputFacts = ast?.meta
        ? {
            path: item.absolutePath,
            bytes: ast.meta.bytes,
            sha256: ast.meta.sha256,
            encoding: ast.meta.encoding,
            extension: extname(item.absolutePath).toLowerCase(),
          }
        : await readInputFacts(item.absolutePath);

      records.push(buildFileRecord({
        program,
        template: { version: template.version },
        pdfKit: outputs.some((output) => output.format === "pdf") && kit
          ? { version: kit.version, engine: engine?.version ?? kit.version, backend: engine?.backend ?? "native" }
          : null,
        fonts: fontStack,
        command: [...argv],
        platform,
        input: inputFacts,
        outputs,
        status,
        errorCode,
        warnings,
        toc: tocReport,
        startedAt: nowIso(itemStartedAt),
        endedAt: nowIso(),
        durationMs: Math.max(0, Math.round(Date.now() - itemStartedAt.getTime())),
      }));

      writeOut(`${status === "ok" ? "OK" : "FAIL"} ${itemDisplay}`);
    }

    const elapsedMs = Date.now() - runStartedAt.getTime();
    const exitCode = counts.failed > 0 ? firstFailureExitCode : 0;

    records.push(buildRunRecord({
      program,
      template: { version: template.version },
      pdfKit: usedPdfEngine && kit
        ? { version: kit.version, engine: engine?.version ?? kit.version, backend: engine?.backend ?? "native" }
        : null,
      fonts: fontStack,
      platform,
      command: [...argv],
      startedAt: nowIso(runStartedAt),
      endedAt: nowIso(),
      durationMs: Math.max(0, elapsedMs),
      counts,
      exitCode,
      outdir: outDirAbs,
      tocMode: anyDegraded ? "degraded" : TOC_MODE,
    }));

    const logPath = join(outDirAbs, logFileName);
    try {
      await writeConversionLog(records, logPath);
    } catch (error) {
      writeErr(`WARN log-write-failed: ${logPath}: ${error && error.message ? error.message : error}`);
    }

    writeOut(`SUMMARY total=${counts.total} ok=${counts.ok} failed=${counts.failed} skipped=${counts.skipped} elapsed=${(elapsedMs / 1000).toFixed(1)}s`);
    if (failures.length > 0) {
      const shown = failures.slice(0, 5).map((failure) => displayPath(failure.item.absolutePath, cwd));
      const extra = failures.length - shown.length;
      writeOut(`FAILED: ${shown.join(", ")}${extra > 0 ? `, ... +${extra} more` : ""}`);
    }
    writeOut(`OUTPUT ${outDirAbs}`);

    return exitCode;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 缺省输出目录 = 输入所在目录/docconvert-out/（REQ §7.1）。
 * @param {import("../contracts/index.js").CliOptions} options
 * @param {string} cwd
 * @param {string} outDirName
 * @returns {string}
 */
function resolveOutDir(options, cwd, outDirName) {
  if (options.outDir) return resolve(cwd, options.outDir);
  const first = options.inputs[0] ?? ".";
  const absolute = resolve(cwd, first);
  const base = extname(absolute) && !first.endsWith(sep) ? dirname(absolute) : absolute;
  return join(base, outDirName);
}

/**
 * 定位 kit（进程内缓存；失败抛 pdf-engine-missing）。
 * @param {NodeJS.ProcessEnv} env
 * @returns {import("../contracts/index.js").KitLocation}
 */
function getKit(env) {
  if (!cachedKit) {
    cachedKit = locateKit({ installRoot: PACKAGE_ROOT, env });
  }
  return cachedKit;
}

/**
 * 尽力定位 kit（仅 docx-only 长文测量用）；失败返回 null。
 * @param {NodeJS.ProcessEnv} env
 * @returns {import("../contracts/index.js").KitLocation | null}
 */
function tryKit(env) {
  try {
    return getKit(env);
  } catch {
    return null;
  }
}

/**
 * 引擎能力校验（capabilities 含 docx→pdf）。
 * @param {import("../contracts/index.js").KitLocation} kit
 * @returns {Promise<import("../contracts/index.js").EngineProbe>}
 */
async function probeEngineChecked(kit) {
  if (!cachedEngine) cachedEngine = await probeEngine(kit);
  if (!cachedEngine.supportsDocxToPdf) {
    throw new DocconvertError("pdf-engine-missing", `PDF 引擎不支持 DOCX→PDF（版本 ${cachedEngine.version}）`, {
      hint: "重装 @deepseek-ai/libreoffice-kit@0.1.5，或改用 --format docx",
      detail: { kit: kit.packageDir },
    });
  }
  return cachedEngine;
}

// ---------------------------------------------------------------------------
// --version
// ---------------------------------------------------------------------------

/**
 * 构造 --version 的 7 行输出（顺序固定，REQ-CLI-005 / D-005）。
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ info: import("../contracts/index.js").BuildInfo, lines: string[] }>}
 */
async function buildVersionInfo(env) {
  /** @type {string | null} */
  let templateVersion = null;
  try {
    const { config } = await loadConfig({ packageRoot: PACKAGE_ROOT });
    templateVersion = (await inspectTemplate({ packageRoot: PACKAGE_ROOT, config })).version;
  } catch {
    templateVersion = null;
  }

  /** @type {string | null} */
  let kitVersion = null;
  /** @type {string | null} */
  let engineVersion = null;
  /** @type {string | null} */
  let backend = null;
  try {
    const kit = getKit(env);
    kitVersion = kit.version;
    try {
      const probe = await probeEngine(kit);
      engineVersion = probe.version;
      backend = probe.backend;
    } catch {
      engineVersion = null; // 版本查询不得因引擎自检失败而失败（REQ-CLI-005）
    }
  } catch {
    kitVersion = null;
  }

  const fonts = await probeFonts();
  /** @type {import("../contracts/index.js").BuildInfo} */
  const info = {
    programVersion: String(pkg.version),
    nodeVersion: process.versions.node,
    templateVersion,
    kitVersion,
    engineVersion,
    tocMode: TOC_MODE,
    fontStack: fonts.fontStack,
  };
  const lines = [
    `docconvert: ${info.programVersion}`,
    `node: ${info.nodeVersion}`,
    `template: ${info.templateVersion ?? "unavailable"}`,
    `pdf-kit: ${info.kitVersion ?? "unavailable"}`,
    `pdf-engine: ${info.engineVersion ? `${info.engineVersion} (${backend ?? "native"})` : "unavailable"}`,
    `toc: ${info.tocMode}`,
    `fonts: ${info.fontStack.latin} / ${info.fontStack.cjk} / ${info.fontStack.mono}`,
  ];
  return { info, lines };
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

/**
 * docconvert doctor [--json]：输出 locateKit 的结果与候选（architecture §3.7）。
 * @param {string[]} args
 * @param {{ writeOut: (line: string) => void, writeErr: (line: string) => void, env: NodeJS.ProcessEnv }} ctx
 * @returns {Promise<number>}
 */
async function runDoctor(args, ctx) {
  const { writeOut, writeErr, env } = ctx;
  const json = args.includes("--json");
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    for (const line of formatErrorLines(new DocconvertError("usage-error", `doctor 不支持参数：${unknown.join(" ")}`, {
      hint: "用法：docconvert doctor [--json]",
    }))) writeErr(line);
    return 2;
  }

  /** @type {import("../contracts/index.js").KitLocation | null} */
  let kit = null;
  /** @type {import("../contracts/index.js").EngineProbe | null} */
  let probe = null;
  /** @type {DocconvertError | null} */
  let error = null;
  try {
    kit = getKit(env);
    probe = await probeEngine(kit);
  } catch (caught) {
    error = isDocconvertError(caught) ? caught : toDocconvertError(caught);
  }

  const payload = {
    found: Boolean(kit),
    source: kit ? kit.source : null,
    version: kit ? kit.version : null,
    engine: probe ? probe.version : null,
    backend: probe ? probe.backend : null,
    candidates: kit ? kit.candidates : (error && error.detail && Array.isArray(error.detail.candidates) ? error.detail.candidates : []),
  };

  if (json) {
    writeOut(JSON.stringify(payload, null, 2));
  } else if (kit) {
    writeOut(`kit: ${payload.version}（来源：${payload.source}）`);
    writeOut(`engine: ${payload.backend} ${payload.engine}`);
    writeOut(`path: ${kit.packageDir}`);
    writeOut(`candidates: ${Array.isArray(payload.candidates) ? payload.candidates.length : 0}（用 --json 查看明细）`);
  } else {
    writeOut("kit: unavailable");
    if (error) {
      for (const line of formatErrorLines(error)) writeErr(line);
    }
  }
  return kit ? 0 : 4;
}

export { PACKAGE_ROOT };
