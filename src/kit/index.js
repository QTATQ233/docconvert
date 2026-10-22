/**
 * kit-locator：定位 @deepseek-ai/libreoffice-kit@0.1.5（architecture §3.7）。
 *
 * 解析顺序（冻结）：① DOCONVERT_LIBREOFFICE_KIT ② 安装目录逐级向上的 node_modules
 * ③ npm root -g（best-effort，失败跳过）④ npx 缓存（按目录 mtime 倒序）。
 * 候选校验四条全过才可用：name 精确、version === 0.1.5、lib/cli.js 与 lib/index.js 存在、
 * 同级平台引擎包存在且版本相同。
 *
 * @module kit
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { arch, homedir, platform as hostPlatform } from "node:os";
import { DocconvertError } from "../contracts/errors.js";
import { KIT_PACKAGE_NAME, KIT_VERSION } from "../contracts/index.js";
import { captureProcess } from "../cli/spawn-capture.js";

/**
 * 当前平台对应的引擎包名（architecture §3.7）。
 * @param {{ os: string, arch: string }} platform
 * @returns {string}
 */
export function platformEnginePackage(platform) {
  const { os, arch: cpu } = platform;
  if (os === "win32") return `${KIT_PACKAGE_NAME}-win32-${cpu === "arm64" ? "arm64" : "x64"}`;
  if (os === "darwin") return `${KIT_PACKAGE_NAME}-darwin-${cpu === "arm64" ? "arm64" : "x64"}`;
  return `${KIT_PACKAGE_NAME}-wasm`;
}

/**
 * @param {string} start 绝对目录
 * @returns {string[]} 从 start 到根的所有祖先目录（含 start）
 */
function ancestorDirs(start) {
  /** @type {string[]} */
  const dirs = [];
  let current = start;
  for (;;) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

/**
 * 校验单个候选目录，永远不抛错（把失败原因记进 reason）。
 * @param {string} dir
 * @param {string} source
 * @param {string} platformPackage
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, any>}
 */
function inspectCandidate(dir, source, platformPackage, extra = {}) {
  /** @type {Record<string, any>} */
  const record = { source, path: dir, ...extra, valid: false, reason: "" };
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (pkg.name !== KIT_PACKAGE_NAME) {
      record.reason = `name mismatch: ${String(pkg.name)}`;
      return record;
    }
    if (pkg.version !== KIT_VERSION) {
      record.reason = `version mismatch: ${String(pkg.version)}`;
      return record;
    }
    record.version = pkg.version;
    for (const rel of ["lib/cli.js", "lib/index.js"]) {
      if (!existsSync(join(dir, rel))) {
        record.reason = `missing ${rel}`;
        return record;
      }
    }
    const engineDir = join(dirname(dir), platformPackage.slice(platformPackage.indexOf("/") + 1));
    record.enginePackageDir = engineDir;
    const enginePkgPath = join(engineDir, "package.json");
    if (!existsSync(enginePkgPath)) {
      record.reason = `missing platform engine ${platformPackage}`;
      return record;
    }
    const enginePkg = JSON.parse(readFileSync(enginePkgPath, "utf8"));
    if (enginePkg.name !== platformPackage || enginePkg.version !== KIT_VERSION) {
      record.reason = `engine mismatch ${String(enginePkg.name)}@${String(enginePkg.version)}`;
      return record;
    }
    record.engineVersion = enginePkg.version;
    record.valid = true;
  } catch (error) {
    record.reason = String(error && error.message ? error.message : error).slice(0, 200);
  }
  return record;
}

/**
 * 尝试 npm root -g（best-effort：任何失败都返回空串，不阻塞、不抛错）。
 * @returns {string}
 */
function tryNpmGlobalRoot() {
  const attempts = [];
  if (hostPlatform() === "win32") {
    // 不用 shell:true（会被 Node 报 DEP0190）：Windows 上 npm 是 .cmd，交给 cmd.exe 执行。
    attempts.push(() => spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm root -g"], { encoding: "utf8", timeout: 10000, windowsHide: true }));
  }
  attempts.push(() => spawnSync("npm", ["root", "-g"], { encoding: "utf8", timeout: 10000, windowsHide: true }));
  for (const run of attempts) {
    try {
      const result = run();
      if (!result || result.error) continue;
      const text = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";
      if (text) return text;
    } catch {
      // 沙箱/受限环境下 npm 不可用：best-effort 跳过。
    }
  }
  return "";
}

/**
 * npx 缓存根目录（Windows 与 POSIX 都试）。
 * @returns {Array<{ root: string, dirs: Array<{ name: string, mtimeMs: number }> }>}
 */
function npxCacheRoots() {
  /** @type {string[]} */
  const roots = [];
  if (hostPlatform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    roots.push(join(localAppData, "npm-cache", "_npx"));
  }
  roots.push(join(homedir(), ".npm", "_npx"));
  /** @type {Array<{ root: string, dirs: Array<{ name: string, mtimeMs: number }> }>} */
  const result = [];
  for (const root of roots) {
    /** @type {Array<{ name: string, mtimeMs: number }>} */
    let dirs = [];
    try {
      dirs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, mtimeMs: statSync(join(root, entry.name)).mtimeMs }));
    } catch {
      continue;
    }
    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    result.push({ root, dirs });
  }
  return result;
}

/**
 * 定位 kit；失败抛 pdf-engine-missing（退出码 4）。
 * @param {{ installRoot: string, env?: Record<string, string|undefined>, platform?: { os: string, arch: string }, npxCacheRoots?: string[] }} options
 * @returns {import("../contracts/index.js").KitLocation}
 */
export function locateKit(options) {
  const { installRoot } = options;
  const env = options.env ?? process.env;
  const platform = options.platform ?? { os: hostPlatform(), arch: arch() };
  const platformPackage = platformEnginePackage(platform);

  /** @type {Array<Record<string, any>>} */
  const candidates = [];
  const explicit = env.DOCONVERT_LIBREOFFICE_KIT ? String(env.DOCONVERT_LIBREOFFICE_KIT) : "";
  if (explicit) {
    const record = inspectCandidate(explicit, "env", platformPackage, { envVar: "DOCONVERT_LIBREOFFICE_KIT" });
    candidates.push(record);
    if (!record.valid) {
      // 显式覆盖不做静默回退：用户指定了就必须可用（否则会「以为在用指定 kit，其实用了别的」）。
      throw new DocconvertError(
        "pdf-engine-missing",
        `DOCONVERT_LIBREOFFICE_KIT 指向的目录不可用：${explicit}（${record.reason}）`,
        {
          hint: "改为指向有效的 @deepseek-ai/libreoffice-kit@0.1.5 目录，或删除该环境变量以自动探测（npm 安装 / 复用 DSH 缓存）",
          detail: { envVar: "DOCONVERT_LIBREOFFICE_KIT", envPath: explicit, reason: record.reason, candidates },
        },
      );
    }
  }

  for (const root of ancestorDirs(installRoot)) {
    const dir = join(root, "node_modules", ...KIT_PACKAGE_NAME.split("/"));
    if (!candidates.some((candidate) => candidate.path === dir)) {
      candidates.push(inspectCandidate(dir, "project", platformPackage, { root }));
    }
  }

  const globalRoot = tryNpmGlobalRoot();
  if (globalRoot) {
    candidates.push(inspectCandidate(join(globalRoot, ...KIT_PACKAGE_NAME.split("/")), "global", platformPackage, { globalRoot }));
  }

  const injectedRoots = options.npxCacheRoots;
  const roots = injectedRoots
    ? injectedRoots.map((root) => {
        /** @type {Array<{ name: string, mtimeMs: number }>} */
        let dirs = [];
        try {
          dirs = readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({ name: entry.name, mtimeMs: statSync(join(root, entry.name)).mtimeMs }))
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
        } catch {
          dirs = [];
        }
        return { root, dirs };
      })
    : npxCacheRoots();
  for (const { root, dirs } of roots) {
    for (const entry of dirs) {
      candidates.push(inspectCandidate(
        join(root, entry.name, "node_modules", ...KIT_PACKAGE_NAME.split("/")),
        "npx-cache",
        platformPackage,
        { npxRoot: root, npxHash: entry.name },
      ));
    }
  }

  const chosen = candidates.find((candidate) => candidate.valid);
  if (!chosen) {
    throw new DocconvertError(
      "pdf-engine-missing",
      `未找到可用的 ${KIT_PACKAGE_NAME}@${KIT_VERSION}（已检查 ${candidates.length} 个候选）`,
      {
        hint: "安装 @deepseek-ai/libreoffice-kit@0.1.5；或设置 DOCONVERT_LIBREOFFICE_KIT 指向已有 kit 目录（本机 DSH 的 npx 缓存可直接复用）；或改用 --format docx",
        detail: { candidates, platformPackage },
      },
    );
  }
  return {
    packageDir: chosen.path,
    cliPath: join(chosen.path, "lib", "cli.js"),
    version: chosen.version,
    source: /** @type {"env"|"project"|"global"|"npx-cache"} */ (chosen.source),
    enginePackageDir: chosen.enginePackageDir,
    engineVersion: chosen.engineVersion,
    candidates,
  };
}

/**
 * 探测引擎能力；失败抛 pdf-engine-missing。
 * @param {import("../contracts/index.js").KitLocation} kit
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<import("../contracts/index.js").EngineProbe>}
 */
export async function probeEngine(kit, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const result = await captureProcess(process.execPath, [kit.cliPath, "capabilities"], { timeoutMs });
  if (result.error) {
    throw new DocconvertError("pdf-engine-missing", `无法启动 PDF 引擎自检：${result.error.message}`, {
      hint: "确认 Node 可执行，并重装 @deepseek-ai/libreoffice-kit@0.1.5",
      detail: { kind: "spawn", kit: kit.packageDir },
      cause: result.error,
    });
  }
  if (result.code !== 0) {
    throw new DocconvertError("pdf-engine-missing", `PDF 引擎自检失败：${String(result.stderr || "").trim().slice(0, 300)}`, {
      hint: "确认平台引擎包完整（native 引擎依赖 VC++ 运行库），或重装 kit",
      detail: { kind: "capabilities", status: result.code, kit: kit.packageDir },
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || "").trim());
  } catch (error) {
    throw new DocconvertError("pdf-engine-missing", "PDF 引擎自检输出无法解析", {
      detail: { kind: "capabilities-json" },
      cause: error,
    });
  }
  const conversions = Array.isArray(parsed.conversions) ? parsed.conversions : [];
  const supportsDocxToPdf = conversions.some(
    (item) => Array.isArray(item.inputs) && item.inputs.includes("docx")
      && Array.isArray(item.outputs) && item.outputs.includes("pdf"),
  );
  // D-005：--version 的 pdf-engine 行显示 kit 版本；LibreOffice 版本仅 best-effort 透传（取不到就省略）。
  const libreOfficeVersion =
    (parsed.runtime && parsed.runtime.libreOfficeVersion) ||
    parsed.libreOfficeVersion ||
    (parsed.engine && parsed.engine.libreOfficeVersion) ||
    undefined;
  return {
    version: parsed.runtime && parsed.runtime.version ? String(parsed.runtime.version) : kit.version,
    backend: parsed.runtime && parsed.runtime.backend === "wasm" ? "wasm" : "native",
    ...(libreOfficeVersion ? { libreOfficeVersion: String(libreOfficeVersion) } : {}),
    supportsDocxToPdf,
  };
}
