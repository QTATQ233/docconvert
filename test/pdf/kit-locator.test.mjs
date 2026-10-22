/**
 * kit-locator 模块级测试（architecture §3.7 / D-004 / D-005）。
 *
 * 覆盖：①显式 env 无效 -> 硬失败 4 且不回退；②项目 node_modules 命中且四条校验全过；
 * ③版本不符的候选被拒绝（candidates 记录原因）；④--version 语义用 kit 版本。
 * 不安装任何东西：全部用临时目录伪造 kit 包结构。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arch, platform } from "node:os";
import { KIT_PACKAGE_NAME, KIT_VERSION } from "../../src/contracts/index.js";
import { locateKit, platformEnginePackage } from "../../src/kit/index.js";

/** 伪造一个完整 kit 包 + 对应平台引擎包。 */
async function fakeKit(root, version = KIT_VERSION) {
  const pkgDir = join(root, "node_modules", ...KIT_PACKAGE_NAME.split("/"));
  await mkdir(join(pkgDir, "lib"), { recursive: true });
  await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: KIT_PACKAGE_NAME, version }));
  await writeFile(join(pkgDir, "lib", "cli.js"), "// fake cli\n");
  await writeFile(join(pkgDir, "lib", "index.js"), "export {};\n");
  const engineName = platformEnginePackage({ os: platform(), arch: arch() });
  const engineDir = join(root, "node_modules", ...engineName.split("/"));
  await mkdir(engineDir, { recursive: true });
  await writeFile(join(engineDir, "package.json"), JSON.stringify({ name: engineName, version }));
  return { pkgDir, engineDir, engineName };
}

test("显式 DOCONVERT_LIBREOFFICE_KIT 无效 -> pdf-engine-missing（4），不回退（D-004）", async () => {
  const root = await mkdtemp(join(tmpdir(), "docconvert-kit-env-"));
  try {
    // 即使项目里存在可用的 kit，也不得回退使用。
    await fakeKit(root);
    assert.throws(
      () => locateKit({ installRoot: root, env: { DOCONVERT_LIBREOFFICE_KIT: join(root, "no-such-kit") }, npxCacheRoots: [] }),
      (error) => {
        assert.equal(error.code, "pdf-engine-missing");
        assert.equal(error.exitCode, 4);
        assert.equal(error.detail.envVar, "DOCONVERT_LIBREOFFICE_KIT");
        assert.match(String(error.message), /DOCONVERT_LIBREOFFICE_KIT/);
        assert.match(String(error.hint), /环境变量|kit/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("项目 node_modules 命中 -> source=project，cliPath/engine 完整", async () => {
  const root = await mkdtemp(join(tmpdir(), "docconvert-kit-project-"));
  try {
    const fake = await fakeKit(root);
    await mkdir(join(root, "app", "src"), { recursive: true });
    const kit = locateKit({ installRoot: join(root, "app", "src"), env: {}, npxCacheRoots: [] });
    assert.equal(kit.source, "project");
    assert.equal(kit.version, KIT_VERSION);
    assert.equal(kit.packageDir, fake.pkgDir);
    assert.equal(kit.cliPath, join(fake.pkgDir, "lib", "cli.js"));
    assert.equal(kit.enginePackageDir, fake.engineDir);
    assert.equal(kit.engineVersion, KIT_VERSION);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("版本不符的候选被拒绝（version mismatch 记录进 candidates）", async () => {
  const root = await mkdtemp(join(tmpdir(), "docconvert-kit-version-"));
  try {
    await fakeKit(root, "0.1.4");
    let kit = null;
    try {
      kit = locateKit({ installRoot: root, env: {}, npxCacheRoots: [] });
    } catch (error) {
      assert.equal(error.code, "pdf-engine-missing");
      const bad = error.detail.candidates.find((item) => item.source === "project");
      assert.ok(bad, "project 候选必须被记录");
      assert.match(String(bad.reason), /version mismatch/);
      return;
    }
    // 若本机全局/npx 缓存另有可用 kit，则不得选中版本不符的项目候选。
    const project = kit.candidates.find((item) => item.source === "project");
    assert.equal(project.valid, false);
    assert.match(String(project.reason), /version mismatch/);
    assert.notEqual(kit.packageDir, join(root, "node_modules", ...KIT_PACKAGE_NAME.split("/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
