/**
 * docconvert 契约常量（冻结；见 docconvert/architecture.md §3）
 *
 * 本文件只放常量与 typedef，不含任何逻辑。开发不得改签名/取值；
 * 变更必须走 architecture.md §12.2 的变更流程。
 *
 * @module contracts
 */

/** 程序名（冻结）。 */
export const PROGRAM_NAME = "docconvert";

/** 程序版本（package.json version 的镜像；bin 启动时以 package.json 为准）。 */
export const PROGRAM_VERSION = "0.1.0";

/** conversion-log 的 schemaVersion（冻结）。 */
export const SCHEMA_VERSION = 1;

/** 唯一第三方依赖（冻结，architecture D1/D6）。 */
export const KIT_PACKAGE_NAME = "@deepseek-ai/libreoffice-kit";
export const KIT_VERSION = "0.1.5";

/** Node 运行时下限（冻结，REQ-DEP-001）。 */
export const MIN_NODE_VERSION = "22.19.0";
export const RECOMMENDED_NODE_VERSION = "24";

/** 白名单扩展名（大小写不敏感，REQ-IN-001）。 */
export const SUPPORTED_EXTENSIONS = Object.freeze([".md", ".txt"]);

/** 冻结的退出码（REQ-CLI 7.2 / architecture §3.11）。 */
export const EXIT_OK = 0;
export const EXIT_INTERNAL = 1;
export const EXIT_USAGE = 2;
export const EXIT_INPUT = 3;
export const EXIT_DEPENDENCY = 4;
export const EXIT_CONVERT = 5;

/**
 * 错误码 → 退出码（14 个，冻结；不得新增未登记项，REQ-DEP-004）。
 * 2026-10-22 t9 评审新增 output-not-writable（环境 / 退出码 4），见 architecture §3.11。
 * @type {Readonly<Record<string, 1|2|3|4|5>>}
 */
export const ERROR_EXIT_CODES = Object.freeze({
  "usage-error": EXIT_USAGE,
  "output-conflict": EXIT_USAGE,
  "input-not-found": EXIT_INPUT,
  "unsupported-extension": EXIT_INPUT,
  "empty-input": EXIT_INPUT,
  "decode-error": EXIT_INPUT,
  "no-input-files": EXIT_INPUT,
  "input-permission": EXIT_INPUT,
  "runtime-unsupported": EXIT_DEPENDENCY,
  "template-missing": EXIT_DEPENDENCY,
  "pdf-engine-missing": EXIT_DEPENDENCY,
  "output-not-writable": EXIT_DEPENDENCY,
  "convert-failed": EXIT_CONVERT,
  "internal-error": EXIT_INTERNAL,
});

/**
 * 每个错误码的一行可执行建议（REQ-DEP-002）。
 * @type {Readonly<Record<string, string>>}
 */
export const ERROR_HINTS = Object.freeze({
  "usage-error": "运行 docconvert --help 查看用法",
  "output-conflict": "改用独立的 -o 输出目录，或给同名文件改名",
  "input-not-found": "检查路径拼写；路径含空格时加引号",
  "unsupported-extension": "支持：.md .txt",
  "empty-input": "确认文件内容非空",
  "decode-error": "另存为 UTF-8 后重试",
  "no-input-files": "确认目录与 -r 参数",
  "input-permission": "检查文件访问权限",
  "runtime-unsupported": "升级到 Node " + RECOMMENDED_NODE_VERSION,
  "template-missing": "重新安装 docconvert",
  "pdf-engine-missing": "安装 @deepseek-ai/libreoffice-kit@0.1.5、设置 DOCONVERT_LIBREOFFICE_KIT，或改用 --format docx",
  "output-not-writable": "检查 -o 目录权限，或改用可写目录",
  "convert-failed": "查看 conversion-log.jsonl",
  "internal-error": "将 conversion-log.jsonl 反馈给维护者",
});

/** 告警码全集（冻结，architecture §3.1.2）。 */
export const WARNING_CODES = Object.freeze([
  "image-degraded", "footnote-unsupported", "task-list-degraded",
  "inline-html-unsupported", "indented-code-unsupported", "list-depth-clamped",
  "quote-depth-clamped", "table-ragged", "table-malformed", "table-nested-unsupported",
  "link-target-degraded", "front-matter-not-recognized", "strikethrough-unsupported",
  "formula-unsupported", "no-heading-detected", "font-fallback",
  "toc-degraded", "toc-not-converged",
]);

/** 字体回退链（写死，REQ-PLAT-003）。 */
export const FONT_STACKS = Object.freeze({
  latin: Object.freeze(["Calibri", "Carlito", "Arial", "Helvetica"]),
  cjk: Object.freeze(["微软雅黑", "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "SimSun"]),
  mono: Object.freeze(["Consolas", "Menlo", "DejaVu Sans Mono", "monospace"]),
});

/** 目录层级（冻结，TOC 只含 H1–H3；PDF 书签取 bookmarkDepth）。 */
export const TOC_DEPTH = 3;
export const TOC_MODE = "two-pass";

/** 输出/日志文件名（冻结默认值，实际以 config/default.yml 为准）。 */
export const DEFAULT_OUT_DIR_NAME = "docconvert-out";
export const DOCX_EXT = ".docx";
export const PDF_EXT = ".pdf";
export const LOG_FILE_NAME = "conversion-log.jsonl";

/** 模板文件相对包根的路径（冻结，REQ-TPL-001：不接受其它值）。 */
export const TEMPLATE_REL_PATH = "templates/reference.docx";

/** 模板必需部件（预检第 ② 步）。 */
export const TEMPLATE_REQUIRED_PARTS = Object.freeze([
  "[Content_Types].xml",
  "word/document.xml",
  "word/styles.xml",
]);

/**
 * @typedef {{ code: string, exitCode: 1|2|3|4|5, message: string, hint?: string, detail?: Record<string, unknown>, cause?: unknown }} DocconvertErrorShape
 *
 * @typedef {"md"|"txt"} SourceFormat
 * @typedef {{ absolutePath: string, format: SourceFormat, sha256: string, bytes: number, mtimeMs: number, encoding: string, title?: string }} SourceMeta
 * @typedef {{ code: string, message: string, line?: number }} ConversionWarning
 * @typedef {object} AstDocument
 * @property {1} schemaVersion
 * @property {SourceMeta} meta
 * @property {Array<object>} blocks
 * @property {Array<object>} assets
 * @property {Array<ConversionWarning>} warnings
 *
 * @typedef {object} TocEntry
 * @property {number} index 1-based
 * @property {1|2|3} level
 * @property {string} text
 * @property {string} bookmark
 *
 * @typedef {object} TocReport
 * @property {"two-pass"|"degraded"} mode
 * @property {number} entries
 * @property {1|2} passes
 * @property {boolean} converged
 * @property {Array<{index:number,expected:number,actual:number}>} mismatches
 *
 * @typedef {object} KitLocation
 * @property {string} packageDir
 * @property {string} cliPath
 * @property {string} version
 * @property {"env"|"project"|"global"|"npx-cache"} source
 * @property {string} enginePackageDir
 * @property {string} engineVersion
 * @property {Array<object>} [candidates]
 *
 * @typedef {object} EngineProbe
 * @property {string} version
 * @property {"native"|"wasm"} backend
 * @property {string} [libreOfficeVersion]
 * @property {boolean} supportsDocxToPdf
 *
 * @typedef {object} DocxRenderResult
 * @property {string} outputPath
 * @property {number} bytes
 * @property {string} sha256
 * @property {Array<TocEntry>} tocEntries
 *
 * @typedef {object} PdfRenderResult
 * @property {string} outputPath
 * @property {number} bytes
 * @property {string} sha256
 * @property {number} [pages]
 * @property {string[]} missingFonts
 * @property {{ version: string, backend: string, libreOfficeVersion?: string }} engine
 *
 * @typedef {object} CliOptions
 * @property {string[]} inputs
 * @property {string} outDir
 * @property {boolean} recursive
 * @property {Array<"docx"|"pdf">} formats
 * @property {boolean} continueOnError
 * @property {boolean} help
 * @property {boolean} version
 *
 * @typedef {object} InputItem
 * @property {string} absolutePath
 * @property {string} relOutBase
 * @property {SourceFormat} format
 *
 * @typedef {object} InputPlan
 * @property {Array<InputItem>} items
 * @property {Array<{outPath:string, inputs:string[]}>} conflicts
 * @property {string[]} skipped
 * @property {string} outDirAbs
 *
 * @typedef {object} BuildInfo
 * @property {string} programVersion
 * @property {string} nodeVersion
 * @property {string|null} templateVersion
 * @property {string|null} kitVersion
 * @property {string|null} engineVersion
 * @property {"two-pass"|"degraded"} tocMode
 * @property {{latin:string,cjk:string,mono:string}} fontStack
 */
