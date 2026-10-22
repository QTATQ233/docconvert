/**
 * 子进程捕获工具（阶段 2.0 基础设施）。
 *
 * 为什么不用管道：本仓库的开发环境（DSH Windows 沙箱）禁止 Node 打开命名管道，
 * 使用 `stdio: "pipe"` 的 spawn/spawnSync 会 EPERM。这里把子进程的 stdout/stderr
 * 重定向到临时**文件**（stdio 传文件描述符），既能拿到输出，也能避免管道死锁；
 * 在普通环境同样可用（属于比管道更保守的实现）。
 *
 * kit 调用（dsoffice convert / capabilities）都走这里。
 *
 * @module cli/spawn-capture
 */
import { spawn } from "node:child_process";
import { open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;

/**
 * 运行子进程并捕获 stdout/stderr。
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ code: number|null, signal: string|null, stdout: string, stderr: string, timedOut: boolean, error?: Error }>}
 */
export async function captureProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  counter += 1;
  const base = join(tmpdir(), `docconvert-spawn-${process.pid}-${counter}-${Date.now()}`);
  const stdoutPath = `${base}.out`;
  const stderrPath = `${base}.err`;
  const stdoutFd = await open(stdoutPath, "w");
  const stderrFd = await open(stderrPath, "w");

  try {
    return await new Promise((resolvePromise) => {
      let settled = false;
      let timedOut = false;
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      /** @type {import("node:child_process").ChildProcess} */
      let child;

      const finish = async (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        await stdoutFd.close().catch(() => {});
        await stderrFd.close().catch(() => {});
        const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
        const stderr = await readFile(stderrPath, "utf8").catch(() => "");
        await rm(stdoutPath, { force: true }).catch(() => {});
        await rm(stderrPath, { force: true }).catch(() => {});
        resolvePromise({ ...result, stdout, stderr });
      };

      try {
        child = spawn(command, args, {
          cwd: options.cwd,
          env: options.env,
          windowsHide: true,
          stdio: ["ignore", stdoutFd.fd, stderrFd.fd],
        });
      } catch (error) {
        void finish({ code: null, signal: null, timedOut: false, error });
        return;
      }

      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch { /* 忽略 */ }
      }, timeoutMs);

      child.on("error", (error) => {
        void finish({ code: null, signal: null, timedOut, error });
      });
      child.on("close", (code, signal) => {
        void finish({ code, signal: signal ?? null, timedOut });
      });
    });
  } finally {
    await stdoutFd.close().catch(() => {});
    await stderrFd.close().catch(() => {});
    await rm(stdoutPath, { force: true }).catch(() => {});
    await rm(stderrPath, { force: true }).catch(() => {});
  }
}
