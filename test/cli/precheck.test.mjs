import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, inspectTemplate } from "../../src/cli/precheck.js";
import { loadConfig } from "../../src/config/index.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("assertNodeVersion：>= 22.19.0 通过，低版本 → runtime-unsupported / 4", () => {
  assert.doesNotThrow(() => assertNodeVersion("22.19.0"));
  assert.doesNotThrow(() => assertNodeVersion("v24.19.0"));
  for (const version of ["22.18.9", "20.11.0", "18.0.0"]) {
    assert.throws(() => assertNodeVersion(version), (error) => {
      assert.equal(error.code, "runtime-unsupported");
      assert.equal(error.exitCode, 4);
      return true;
    }, version);
  }
});

test("inspectTemplate：真实模板可解析，版本为 SHA-256 前 12 位、样式齐全", async () => {
  const { config } = await loadConfig({ packageRoot: PACKAGE_ROOT });
  const template = await inspectTemplate({ packageRoot: PACKAGE_ROOT, config });
  assert.match(template.version, /^[0-9a-f]{12}$/);
  assert.ok(template.entries.includes("word/styles.xml"));
  assert.ok(template.styles.size >= 16);
  assert.ok(template.compared >= 1, "至少应有 Normal 的 w:sz 参与双源比对");
});

test("inspectTemplate：模板缺失 / ZIP 损坏 → template-missing / 4", async () => {
  const root = await mkdtemp(join(tmpdir(), "docconvert-tpl-"));
  try {
    await mkdir(join(root, "config"), { recursive: true });
    const { config } = await loadConfig({ packageRoot: PACKAGE_ROOT });
    // 模板缺失
    await assert.rejects(() => inspectTemplate({ packageRoot: root, config }), (error) => {
      assert.equal(error.code, "template-missing");
      assert.equal(error.exitCode, 4);
      return true;
    });
    // ZIP 损坏
    await mkdir(join(root, "templates"), { recursive: true });
    await writeFile(join(root, "templates", "reference.docx"), "not a zip at all", "utf8");
    await assert.rejects(() => inspectTemplate({ packageRoot: root, config }), (error) => {
      assert.equal(error.code, "template-missing");
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
