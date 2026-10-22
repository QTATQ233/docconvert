/**
 * --help 文本（REQ-CLI-004）。必须包含：用法行、选项表（含默认值）、支持的扩展名、
 * 默认输出目录规则、退出码表、1 条可直接复制的示例。
 * 禁止参数（--font/--margin/...）**不得出现**（REQ-CLI-003）；本文件不含这些字符串。
 *
 * @module cli/help
 */
import { PROGRAM_NAME, PROGRAM_VERSION } from "../contracts/index.js";

/**
 * @returns {string}
 */
export function helpText() {
  return [
    `${PROGRAM_NAME} ${PROGRAM_VERSION} — 把 .md / .txt 转成排版好的 .docx 与 .pdf`,
    "",
    "用法：",
    `  ${PROGRAM_NAME} <input...> [选项]`,
    `  ${PROGRAM_NAME} doctor [--json]`,
    "",
    "输入：",
    "  文件或目录（扩展名 .md / .txt，大小写不敏感；路径可含中文与空格）",
    "",
    "选项：",
    "  -o, --outdir <dir>        输出目录（默认：输入所在目录/docconvert-out/）",
    "  -r, --recursive           目录递归（仅目录输入有意义；文件输入时忽略）",
    "  --format <docx|pdf|both>  产物类型（默认 both）",
    "  --continue-on-error       单个文件失败后继续处理其余文件",
    "  -h, --help                显示本帮助并退出 0",
    "  -V, --version             显示版本与依赖并退出 0",
    "",
    "支持的扩展名：.md .txt",
    "默认输出目录：输入所在目录下的 docconvert-out/（不存在则创建）",
    "",
    "退出码：",
    "  0  全部成功（或 --help / --version）",
    "  1  未预期的内部错误",
    "  2  参数错误（未知选项、缺少输入、--format 取值非法、-o 指向已存在文件、输出冲突）",
    "  3  输入错误（路径不存在、扩展名不支持、空文件、解码失败、目录内无输入文件、无读取权限）",
    "  4  依赖 / 环境缺失（Node 版本、内置模板、PDF 引擎、输出目录不可写）",
    "  5  转换失败",
    "",
    "示例：",
    `  ${PROGRAM_NAME} a.md`,
  ].join("\n");
}
