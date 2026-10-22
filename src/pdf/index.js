/**
 * pdf-render：真实调用 kit CLI 做一次 DOCX→PDF（architecture §3.6）。
 *
 * 冻结纪律：
 * - 输入输出都用**绝对路径**（kit 要求，spike §2.5）。
 * - kit **独占创建**输出文件：先写本次运行独占的临时文件，成功后原子 rename 到 outPath。
 * - 超时杀进程 + 清理临时文件 + convert-failed（detail.kind="timeout"）。
 * - 不含任何 TOC 逻辑（TOC 由 toc-two-pass 模块负责）。
 *
 * @module pdf
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { captureProcess } from "../cli/spawn-capture.js";
import { DocconvertError } from "../contracts/errors.js";
import { toWriteError } from "../contracts/output-errors.js";

let tempCounter = 0;

/**
 * 计算文件 SHA-256（大写十六进制；与 SourceMeta 约定一致）。
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

/**
 * 用 kit CLI 执行一次转换；成功返回 {backend, missingFonts}。
 * @param {string} cliPath
 * @param {string} absInput
 * @param {string} absOutput
 * @param {number} timeoutMs
 * @returns {Promise<{ backend: string, missingFonts: string[] }>}
 */
async function runKitConvert(cliPath, absInput, absOutput, timeoutMs) {
  const result = await captureProcess(
    process.execPath,
    [cliPath, "convert", "--input", absInput, "--output", absOutput],
    { timeoutMs },
  );

  if (result.timedOut) {
    throw new DocconvertError("convert-failed", `PDF 导出超时（>${timeoutMs}ms）`, {
      hint: "查看 conversion-log.jsonl；缩短文档或检查引擎状态",
      detail: { kind: "timeout", timeoutMs },
    });
  }
  if (result.error) {
    throw new DocconvertError("convert-failed", `无法启动 PDF 引擎：${result.error.message}`, {
      hint: "确认 Node 可执行，并重装 @deepseek-ai/libreoffice-kit@0.1.5",
      detail: { kind: "spawn" },
      cause: result.error,
    });
  }
  if (result.code === 0) {
    /** @type {{ backend?: string, missingFonts?: string[] }} */
    let parsed = {};
    try { parsed = JSON.parse(String(result.stdout || "").trim()); } catch { parsed = {}; }
    const missingFonts = Array.isArray(parsed.missingFonts)
      ? [...new Set(parsed.missingFonts.map(String).map((name) => name.trim()).filter((name) => name.length > 0))]
      : [];
    return {
      backend: parsed.backend === "wasm" ? "wasm" : "native",
      missingFonts,
      ...(parsed.libreOfficeVersion ? { libreOfficeVersion: String(parsed.libreOfficeVersion) } : {}),
    };
  }

  /** @type {{ code?: string, error?: string }} */
  let parsed = {};
  try { parsed = JSON.parse(String(result.stderr || "").trim()); } catch { parsed = {}; }
  const kitCode = parsed.code ? String(parsed.code) : "failed";
  const detailText = `kitCode=${kitCode}${parsed.error ? `; ${String(parsed.error).slice(0, 300)}` : ""}`;
  if (kitCode === "unavailable") {
    throw new DocconvertError("pdf-engine-missing", `PDF 引擎不可用（${detailText}）`, {
      hint: "确认平台引擎包完整（Windows x64 需 VC++ v14 运行库）；或改用 --format docx",
      detail: { kind: "kit-unavailable", kitCode, stderr: String(result.stderr || "").slice(0, 1000) },
    });
  }
  throw new DocconvertError("convert-failed", `DOCX→PDF 导出失败（${detailText}）`, {
    hint: "查看 conversion-log.jsonl",
    detail: { kind: "kit-convert", kitCode, exitCode: result.code, stderr: String(result.stderr || "").slice(0, 1000) },
  });
}

/**
 * 把 DOCX 导出为 PDF。
 * @param {string} docxPath
 * @param {string} outPath
 * @param {{ kit: import("../contracts/index.js").KitLocation, workDir: string, timeoutMs?: number }} options
 * @returns {Promise<import("../contracts/index.js").PdfRenderResult>}
 */
export async function renderPdf(docxPath, outPath, options) {
  const { kit, workDir } = options;
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!kit || !kit.cliPath) {
    throw new DocconvertError("pdf-engine-missing", "未提供可用的 PDF 引擎位置", {
      hint: "安装 kit 或设置 DOCONVERT_LIBREOFFICE_KIT；或改用 --format docx",
    });
  }
  const absInput = resolve(docxPath);
  const absOutput = resolve(outPath);
  await mkdir(dirname(absOutput), { recursive: true });
  await mkdir(workDir, { recursive: true });

  tempCounter += 1;
  const tempOutput = join(workDir, `out-${process.pid}-${tempCounter}.pdf`);
  await rm(tempOutput, { force: true });

  let kitResult;
  try {
    kitResult = await runKitConvert(kit.cliPath, absInput, tempOutput, timeoutMs);
  } catch (error) {
    await rm(tempOutput, { force: true });
    throw error;
  }

  const produced = await stat(tempOutput).catch(() => null);
  if (!produced || produced.size === 0) {
    await rm(tempOutput, { force: true });
    throw new DocconvertError("convert-failed", "PDF 引擎报告成功但没有产出文件", {
      hint: "查看 conversion-log.jsonl",
      detail: { kind: "empty-output", kitCode: "failed" },
    });
  }

  try {
    await rename(tempOutput, absOutput);
  } catch (error) {
    if (error && error.code === "EXDEV") {
      await copyFile(tempOutput, absOutput);
      await rm(tempOutput, { force: true });
    } else {
      await rm(tempOutput, { force: true });
      throw toWriteError(error, { target: absOutput, what: " PDF 产物" });
    }
  }

  // 真实性：bytes/sha256 由磁盘文件重算（REQ-LOG-004）。
  const finalStat = await stat(absOutput);
  const sha256 = await sha256File(absOutput);
  // engine 字段按 architecture §3.1.5 冻结结构（kitVersion/backend/libreOfficeVersion?）。
  // 注：src/contracts 的 JSDoc 仍写 version，属契约文件滞后（见报告 C-PDF-02），运行期以本文为准。
  return {
    outputPath: absOutput,
    bytes: finalStat.size,
    sha256,
    missingFonts: kitResult.missingFonts,
    engine: {
      kitVersion: kit.version,
      version: kit.version,
      backend: kitResult.backend,
      ...(kitResult.libreOfficeVersion ? { libreOfficeVersion: kitResult.libreOfficeVersion } : {}),
    },
  };
}
