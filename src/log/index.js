/**
 * log-writer：写 <outdir>/conversion-log.jsonl（architecture §3.10 / requirements §10）。
 *
 * 冻结纪律：
 * - UTF-8 无 BOM、LF 换行、每行一个 JSON 对象；每次运行 truncate（临时文件 + 原子 rename）。
 * - 输入顺序：每个文件一条 type:"file"，末尾一条 type:"run"。
 * - sha256/bytes 必须来自磁盘重算（由调用方传入真实值）。
 * - 写日志失败**不得**吞掉转换结果：由 cli 捕获后打 WARN log-write-failed，退出码不变。
 *
 * @module log
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * @param {object} input
 * @param {{name: string, version: string}} input.program
 * @param {{version: string}} input.template
 * @param {{version: string, engine: string, backend: string} | null} input.pdfKit
 * @param {{latin: string, cjk: string, mono: string}} input.fonts
 * @param {string[]} input.command
 * @param {{path: string, bytes: number, sha256: string, encoding: string, extension: string}} input.input
 * @param {Array<{format: "docx"|"pdf", path: string, bytes: number, sha256: string, durationMs: number}>} input.outputs
 * @param {"ok"|"partial"|"failed"|"skipped"} input.status
 * @param {string | null} input.errorCode
 * @param {Array<{code: string, line?: number, message: string}>} input.warnings
 * @param {{mode: "two-pass"|"degraded", entries: number, passes: 1|2, converged: boolean, mismatches?: Array<object>}} input.toc
 * @param {string} input.startedAt
 * @param {string} input.endedAt
 * @param {number} input.durationMs
 * @param {{os: string, arch: string, node: string}} input.platform
 * @returns {Record<string, unknown>}
 */
export function buildFileRecord(input) {
  return {
    type: "file",
    schemaVersion: 1,
    program: { name: input.program.name, version: input.program.version },
    template: { version: input.template.version },
    pdfKit: input.pdfKit ? { version: input.pdfKit.version, engine: input.pdfKit.engine, backend: input.pdfKit.backend } : null,
    fonts: { latin: input.fonts.latin, cjk: input.fonts.cjk, mono: input.fonts.mono },
    command: [...input.command],
    input: {
      path: input.input.path,
      bytes: input.input.bytes,
      sha256: input.input.sha256,
      encoding: input.input.encoding,
      extension: input.input.extension,
    },
    outputs: input.outputs.map((item) => ({
      format: item.format,
      path: item.path,
      bytes: item.bytes,
      sha256: item.sha256,
      durationMs: item.durationMs,
    })),
    status: input.status,
    errorCode: input.errorCode,
    warnings: input.warnings.map((warning) => ({
      code: warning.code,
      ...(warning.line === undefined ? {} : { line: warning.line }),
      message: warning.message,
    })),
    toc: {
      mode: input.toc.mode,
      entries: input.toc.entries,
      passes: input.toc.passes,
      converged: input.toc.converged,
    },
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: input.durationMs,
    platform: { os: input.platform.os, arch: input.platform.arch, node: input.platform.node },
  };
}

/**
 * @param {object} input 同 buildFileRecord 的 program/template/pdfKit/fonts/platform/command 字段
 * @param {string} input.startedAt
 * @param {string} input.endedAt
 * @param {number} input.durationMs
 * @param {{total: number, ok: number, failed: number, skipped: number}} input.counts
 * @param {number} input.exitCode
 * @param {string} input.outdir
 * @param {"two-pass"|"degraded"} input.tocMode
 * @returns {Record<string, unknown>}
 */
export function buildRunRecord(input) {
  return {
    type: "run",
    schemaVersion: 1,
    program: { name: input.program.name, version: input.program.version },
    template: { version: input.template.version },
    pdfKit: input.pdfKit ? { version: input.pdfKit.version, engine: input.pdfKit.engine, backend: input.pdfKit.backend } : null,
    fonts: { latin: input.fonts.latin, cjk: input.fonts.cjk, mono: input.fonts.mono },
    platform: { os: input.platform.os, arch: input.platform.arch, node: input.platform.node },
    command: [...input.command],
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: input.durationMs,
    counts: { ...input.counts },
    exitCode: input.exitCode,
    outdir: input.outdir,
    tocMode: input.tocMode,
  };
}

/**
 * 写日志（先写临时文件再原子替换，保证 truncate 且不产生半截文件）。
 * @param {Array<Record<string, unknown>>} records
 * @param {string} logPath
 * @returns {Promise<void>}
 */
export async function writeConversionLog(records, logPath) {
  const text = records.length === 0 ? "" : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await mkdir(dirname(logPath), { recursive: true });
  const tempPath = `${logPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tempPath, text, "utf8");
    await rename(tempPath, logPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
