/**
 * toc/two-pass —— TOC 两遍法编排（E3 独立模块，architecture §3.8 / §7.1 / §7.3）。
 *
 * 第一遍 DOCX 写「完整目录缓存 + 占位 00」→ 导出 PDF → 解析书签得到每条标题的物理页 →
 * 回填页码重出 DOCX/PDF → 用第二次 outline 复核收敛（C1–C3，§7.1.2），失败最多重试一次。
 * 只依赖 contracts + docx-render + pdf-render；不生成 DOCX、不封装 kit（§7.3.1）。
 *
 * 失败口径（§7.1.3）：收敛失败 → 照常交付 + WARN toc-not-converged + converged=false；
 * 无法测量 → 降级占位 + WARN toc-degraded；docx-only 且无引擎 → 降级（§9.5 裁决 (a)）；
 * wantPdf 且无引擎 → pdf-engine-missing（退出码 4）。以上降级都不抛错。
 *
 * @module toc
 */
import { collectTocEntries, isLongDoc, renderDocx } from "../docx/index.js";
import { renderPdf } from "../pdf/index.js";
import { readPdfOutline, tocOutlineEntries } from "./outline.js";
import { TOC_DEPTH } from "../contracts/index.js";
import { DocconvertError, isDocconvertError } from "../contracts/errors.js";
import { basename, extname, join } from "node:path";

/** 最多重试一次（§7.1.3：总导出次数 <= 3）。 */
export const TOC_MAX_RETRIES = 1;
/** 降级占位符（全角破折号，§7.3.3 G2）。 */
export const TOC_DEGRADED_PLACEHOLDER = "——";
/** 引擎缺失时的固定告警文案（requirements §6.2 写死）。 */
export const TOC_DEGRADED_ENGINE_MESSAGE = "PDF 引擎不可用，目录页码以占位符显示（见 README 已知限制）";
/** 收敛失败的固定告警文案前缀（requirements §5.2 写死）。 */
export const TOC_NOT_CONVERGED_MESSAGE = "PDF 目录页码两遍测量未收敛，已采用最后一次结果";

export { readPdfOutline, tocOutlineEntries };

/**
 * @param {string} message
 * @returns {import("../contracts/index.js").ConversionWarning}
 */
export function tocDegradedWarning(message) {
  return { code: "toc-degraded", message };
}

/**
 * @param {Array<{index:number, expected:number, actual:number}>} mismatches
 * @param {Array<import("../contracts/index.js").TocEntry>} entries
 * @returns {import("../contracts/index.js").ConversionWarning}
 */
export function tocNotConvergedWarning(mismatches, entries) {
  const first = mismatches[0];
  const title = first ? entries[Math.max(0, first.index - 1)] : null;
  const detail = first
    ? "（第 " + String(first.index) + " 条 " + (title ? JSON.stringify(title.text) : "") +
      " 期望 " + String(first.expected) + " 实际 " + String(first.actual) + "）"
    : "";
  return { code: "toc-not-converged", message: TOC_NOT_CONVERGED_MESSAGE + detail };
}

/**
 * 过滤 level <= 2 后按顺序映射为页码（§3.8 映射规则：禁止按标题文本匹配）。
 * @param {import("../contracts/index.js").PdfOutline} outline
 * @param {Array<import("../contracts/index.js").TocEntry>} entries
 * @returns {number[]}
 */
export function planTocNumbers(outline, entries) {
  const measured = tocOutlineEntries(outline);
  if (measured.length !== entries.length) {
    throw new DocconvertError("convert-failed", "目录页码测量失败：目录 " + String(entries.length) + " 条，PDF 书签 " + String(measured.length) + " 条", {
      hint: "查看 conversion-log.jsonl",
      detail: { kind: "toc-count-mismatch", entries: entries.length, outline: measured.length },
    });
  }
  const unresolved = measured.findIndex((entry) => !Number.isInteger(entry.page) || entry.page < 1);
  if (unresolved >= 0) {
    throw new DocconvertError("convert-failed", "目录页码测量失败：第 " + String(unresolved + 1) + " 条书签的目的地无法解析到页码", {
      hint: "查看 conversion-log.jsonl",
      detail: { kind: "toc-unmeasurable", index: unresolved + 1, outline: measured.length },
    });
  }
  return measured.map((entry) => entry.page);
}

/**
 * 收敛判定（C1–C3；C4 由 planTocNumbers 长度校验保证）。
 * @param {import("../contracts/index.js").PdfOutline} a 第一遍
 * @param {import("../contracts/index.js").PdfOutline} b 第二遍
 * @param {number[]} numbers 已回填页码
 * @returns {{ converged: boolean, mismatches: Array<{index:number,expected:number,actual:number,title?:string}>, pageCountStable: boolean }}
 */
export function verifyTocConvergence(a, b, numbers) {
  const previous = tocOutlineEntries(a);
  const current = tocOutlineEntries(b);
  const mismatches = [];
  const total = Math.max(previous.length, current.length, numbers.length);
  for (let i = 0; i < total; i += 1) {
    const before = previous[i];
    const after = current[i];
    const expected = Number.isInteger(numbers[i]) ? numbers[i] : -1;
    const actual = after ? after.page : -1;
    const pageStable = Boolean(before && after && before.page === after.page);
    if (!pageStable || expected !== actual) {
      mismatches.push({
        index: i + 1,
        expected: pageStable ? expected : (before ? before.page : expected),
        actual,
        title: after ? after.title : (before ? before.title : ""),
      });
    }
  }
  return { converged: a.pageCount === b.pageCount && mismatches.length === 0, mismatches, pageCountStable: a.pageCount === b.pageCount };
}

/** 可降级的「无法测量」错误（其余 convert-failed 必须照常抛出）。 */
function isMeasurementError(error) {
  if (!isDocconvertError(error) || error.code !== "convert-failed") return false;
  const kind = error.detail && typeof error.detail.kind === "string" ? error.detail.kind : "";
  return kind === "toc-count-mismatch" || kind === "toc-unmeasurable" || kind === "pdf-outline";
}

/**
 * 收敛循环（内部编排，测试可见；不属于 §3.12 冻结接口）。
 * measure(null) 出第一遍，measure(numbers) 出后续遍；失败最多重试一次。
 * @param {(numbers: number[]|null) => Promise<{ outline: import("../contracts/index.js").PdfOutline }>} measure
 * @param {Array<import("../contracts/index.js").TocEntry>} entries
 * @param {{ maxRetries?: number }} [options]
 */
export async function convergeToc(measure, entries, options = {}) {
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : TOC_MAX_RETRIES;
  const first = await measure(null);
  if (tocOutlineEntries(first.outline).length === 0) {
    throw new DocconvertError("convert-failed", "目录页码测量失败：PDF 没有可用于测量的书签", {
      hint: "确认文档含 H1–H3 标题；查看 conversion-log.jsonl",
      detail: { kind: "toc-unmeasurable", reason: "empty-outline", pageCount: first.outline.pageCount },
    });
  }
  let previous = first.outline;
  let numbers = planTocNumbers(previous, entries);
  for (let retries = 0; ; retries += 1) {
    const next = await measure(numbers);
    const check = verifyTocConvergence(previous, next.outline, numbers);
    if (check.converged) return { pass: next, numbers, converged: true, retries, mismatches: [] };
    if (retries >= maxRetries) return { pass: next, numbers, converged: false, retries, mismatches: check.mismatches };
    previous = next.outline;
    numbers = planTocNumbers(previous, entries);
  }
}

/** 输出基名：输入文件去扩展名（缺省与 cli 的单文件 relOutBase 一致）。 */
function deriveOutBase(doc) {
  const source = doc && doc.meta && doc.meta.absolutePath ? doc.meta.absolutePath : "document";
  return basename(source, extname(source)) || "document";
}

/**
 * 渲染 DOCX/PDF 并完成两遍法；返回交付结果与 TocReport（§3.8）。
 * @param {import("../contracts/index.js").AstDocument} doc
 * @param {{ outDir: string, workDir: string, templatePath: string, wantDocx: boolean, wantPdf: boolean, kit: import("../contracts/index.js").KitLocation|null, tocThreshold: number, timeoutMs?: number, outBase?: string }} options
 * @returns {Promise<import("../contracts/index.js").TocRenderResult>}
 */
export async function renderWithToc(doc, options) {
  const { outDir, workDir, templatePath, wantDocx, wantPdf, kit } = options;
  const threshold = Number.isInteger(options.tocThreshold) ? options.tocThreshold : 3;
  const entries = collectTocEntries(doc, { depth: TOC_DEPTH });
  const warnings = [];
  const outBase = typeof options.outBase === "string" && options.outBase ? options.outBase : deriveOutBase(doc);
  const safeBase = outBase.replace(/[\\/:*?"<>|]/g, "_");
  const docxPath = join(outDir, safeBase + ".docx");
  const pdfPath = join(outDir, safeBase + ".pdf");
  let passIndex = 0;

  /** 产出一遍：DOCX ->（可选）PDF -> outline。final=true 时写最终产物路径。 */
  const runPass = async (numbers, final, placeholder, needPdf = true) => {
    passIndex += 1;
    const tag = "pass" + String(passIndex);
    /** @type {{ templatePath: string, tocNumbers: number[]|null, tocPlaceholder?: string }} */
    const docxOptions = { templatePath, tocNumbers: numbers };
    // 降级占位「——」需要 docx-render 附加信号：additive optional（见报告 C-PDF-01）。
    if (placeholder) docxOptions.tocPlaceholder = placeholder;
    const docx = await renderDocx(doc, final && wantDocx ? docxPath : join(workDir, tag + "-" + safeBase + ".docx"), docxOptions);
    if (!needPdf) return { docx, pdf: undefined, outline: null };
    const pdf = await renderPdf(docx.outputPath, final && wantPdf ? pdfPath : join(workDir, tag + "-" + safeBase + ".pdf"), { kit, workDir, timeoutMs: options.timeoutMs });
    const outline = await readPdfOutline(pdf.outputPath);
    if (pdf.pages === undefined) pdf.pages = outline.pageCount;
    return { docx, pdf, outline };
  };

  const pack = (pass, toc) => ({
    docx: wantDocx && pass ? pass.docx : undefined,
    pdf: wantPdf && pass ? pass.pdf : undefined,
    toc,
    warnings,
  });

  if (!isLongDoc(entries, threshold)) {
    // 短文：单遍、无目录（§3.8 / REQ-LAY-001）。
    return pack(await runPass(null, true, null, wantPdf), { mode: "two-pass", entries: 0, passes: 1, converged: true, mismatches: [] });
  }

  if (!kit) {
    if (wantPdf) {
      throw new DocconvertError("pdf-engine-missing", "长文目录需要在导出 PDF 时测量页码，但没有可用的 PDF 引擎", {
        hint: "安装 @deepseek-ai/libreoffice-kit@0.1.5、设置 DOCONVERT_LIBREOFFICE_KIT，或改用 --format docx",
        detail: { kind: "toc-measure-needs-kit", entries: entries.length },
      });
    }
    // docx-only + 引擎不可解析：降级交付（§9.5 裁决 (a)），退出码 0。
    warnings.push(tocDegradedWarning(TOC_DEGRADED_ENGINE_MESSAGE));
    return pack(await runPass(null, true, TOC_DEGRADED_PLACEHOLDER, false), { mode: "degraded", entries: entries.length, passes: 1, converged: false, mismatches: [] });
  }

  try {
    const result = await convergeToc((numbers) => runPass(numbers, numbers !== null, null, true), entries);
    if (!result.converged) warnings.push(tocNotConvergedWarning(result.mismatches, entries));
    return pack(result.pass, {
      mode: "two-pass",
      entries: entries.length,
      passes: 2,
      converged: result.converged,
      mismatches: result.mismatches,
    });
  } catch (error) {
    if (!isMeasurementError(error)) throw error;
    // 无法测量：降级为占位页码，照常交付（§7.1.3 / §9.5）。
    warnings.push(tocDegradedWarning("目录页码测量失败，已以占位符显示（见 README 已知限制）：" + (error instanceof Error ? error.message : String(error))));
    return pack(await runPass(null, true, TOC_DEGRADED_PLACEHOLDER, wantPdf), { mode: "degraded", entries: entries.length, passes: 1, converged: false, mismatches: [] });
  }
}
