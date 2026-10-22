#!/usr/bin/env node
/**
 * docconvert 唯一入口：把 runCli 的返回值交给 process.exitCode（architecture §3.9/§10.1）。
 * 本文件之外的任何模块都不得调用 process.exit。
 */
import { runCli } from "../src/cli/index.js";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  // 兜底：未捕获异常 → internal-error / 退出码 1，不打堆栈（REQ-CLI-006）。
  const message = error && error.message ? error.message : String(error);
  process.stderr.write(`ERROR internal-error: ${message}\n`);
  process.exitCode = 1;
}
