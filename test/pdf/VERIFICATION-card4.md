# 卡 4 交付报告｜pdf-renderer + TOC 两遍法（阶段 2.1）

- 角色：开发工程师（dev-pdf）｜任务：t15｜attempt：2
- 写入范围：`docconvert/src/pdf/**`、`src/kit/**`、`src/toc/**`、`test/pdf/**`、`test/toc/**`
- 未改动：`src/docx/**`、`src/markdown/**`、`src/contracts/**`、`package.json`、`examples/**`、`architecture.md`、`requirements.md`、`test-cases.md`

## 1. 交付物与 LOC（E3 预算 330–550，code-only 统计）

| 文件 | 状态 | code LOC | 说明 |
|---|---|---|---|
| `src/toc/outline.js` | 新开发 | **396**（预算 250–400） | PDF 书签解析：对象扫描 / ObjStm / 页树映射 / 命名目的地 / UTF-16BE 标题 |
| `src/toc/index.js` | 新开发 | **147**（预算 80–150） | planTocNumbers / verifyTocConvergence / convergeToc（重试一次）/ renderWithToc |
| **合计** | | **543**（预算 330–550） | 独立预算，未占用 docx-render / markdown-parser 额度 |
| `src/pdf/index.js` | 原地扩展 | — | engine 按 §3.1.5（kitVersion/backend/libreOfficeVersion?）、missingFonts 去重、超时清理沿用 |
| `src/kit/index.js` | 原地扩展 | — | probeEngine 增加 libreOfficeVersion（best-effort）；解析顺序与 D-004 硬失败不变 |

测试与证据：`test/toc/{toc-convergence,outline,degrade}.test.mjs`、`test/pdf/{kit-locator,render-pdf}.test.mjs`、`test/pdf/two-pass-check.mjs`、`test/pdf/e2e-real-pipeline.mjs`；报告 JSON：`test/pdf/two-pass-report.json`、`test/pdf/e2e-report.json`。

## 2. 验收结果

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 34 标题 fixture 页码 34/34 | **PASS** | two-pass-check：fixture-34 → 8 页两遍一致、matched 34/34、converged=true、重试 0，pass1 2.6s / pass2 2.5s |
| 2 | 两次分页一致 | **PASS** | 同上 8/8；S-01 140/140；S-02 27/27 |
| 3 | 真实管线端到端 | **PASS** | e2e-real-pipeline：examples/headings.md 25/25、examples/long-50.md 134/134，TOC 页码与最终 PDF 书签逐条相等，updateFields=0，passes=2 |
| 4 | docx-only 无引擎 → 降级（WARN/占位/0） | **PASS** | degrade.test：mode=degraded、converged=false、passes=1、warnings=[toc-degraded] 且文案等于 requirements §6.2 固定文案、docx 产出、不抛错（占位字符见 C-PDF-01） |
| 5 | both 无引擎 → 退出码 4 | **PASS** | 同上 pdf-engine-missing、exitCode=4、outdir 无产物；render-pdf 单测 kit=null 同样断言 |
| 6 | 中文 + 空格路径 | **PASS** | render-pdf.test：`中文 空格 输出/示例 文档.pdf` 落盘，engine.kitVersion=0.1.5、sha256 64 位大写、可重复覆盖；CLI 冒烟 exit=0 |
| 7 | node --test 通过 | **PASS** | 21/21：`node --test --test-isolation=none test/toc/toc-convergence.test.mjs test/toc/outline.test.mjs test/toc/degrade.test.mjs test/pdf/kit-locator.test.mjs test/pdf/render-pdf.test.mjs` |
| 8 | TC-TOC-02（重试一次 + 告警） | **PASS** | run2：首轮漂移→恰好 3 次 measure→converged、retries=1；run3：持续漂移→converged=false、告警码 toc-not-converged、不抛错（退出码语义 0） |
| 9 | 不修改 docx-render / markdown | **PASS** | 本轮 diff 仅上述 4 个模块 + 测试；src/docx/**、src/markdown/** 未触碰 |

## 3. S-01 / S-02 稳定性验证（首日补测，R-01 / R-02 关闭）

| 样本 | 构造 | 页数 | 条目 | 页码一致 | 两遍页数 | 耗时 | 结论 |
|---|---|---|---|---|---|---|---|
| **S-01**（>99 页三位页码） | _spike/mkdocx.mjs --chapters=110，660 条目录，占位强制 `000` | **140** | 660 | **660/660** | 140/140 | 2.6s + 2.8s | R-01 关闭：三位页码不改变行数/分页，C1–C3 全过、重试 0 |
| **S-02**（浮动图片 + 跨页表格） | 自建 fixture（two-pass-check 内置 OOXML 生成器）：8 章 × 3 级标题、wp:anchor + wrapSquare 浮动 PNG、60 行 × 3 列跨页表格 | **27** | 24 | **24/24** | 27/27 | 2.3s + 2.2s | R-02 关闭：浮动对象与跨页表格未破坏两遍分页 |

复现：`node test/pdf/two-pass-check.mjs --json=test/pdf/two-pass-report.json`（真实 kit，退出码 0 = 全过）。

## 4. 遗留问题（需裁决 / 交接）

### C-PDF-01（接口缺口，需裁决）docx-render 无法表达「降级占位」
- 现象：§3.5 冻结语义只有 `tocNumbers: null → 页码写 "00"`；§7.3.3 G2 与 TC-TOC-DEGRADED 却要求降级时目录写全角破折号 `——`。两者在冻结签名下无法同时满足。
- 已做：renderWithToc 降级分支额外传 additive optional `tocPlaceholder`（当前 docx-render 忽略，故实现里仍是 "00"）。
- 建议裁决：给 `DocxRenderOptions` 增补 optional `tocPlaceholder?: "dashes"`（或允许 `tocNumbers === "degraded"`），由卡 3 在 TOC 数字处输出 `——`；本卡调用点已就绪。

### C-PDF-02（契约文件滞后）PdfRenderResult.engine 字段名
- architecture §3.1.5 写 `{ kitVersion, backend, libreOfficeVersion? }`；src/contracts/index.js 的 JSDoc 仍写 `{ version, backend }`。
- 已做：同时输出 `kitVersion` 与 `version`（别名）；contracts 为只读，未改。

### C-PDF-03（风险，未复现）引用内标题会进 PDF 书签、不进目录
- collectTocEntries 只取顶层 blocks（引用内标题不进目录），但 docx-render 会给引用内标题写书签 → 书签数 > 目录条目数 → planTocNumbers 判 C4 失败 → 降级（WARN toc-degraded）。
- 影响：含引用内标题的长文页码会退化为占位。建议后续用「书签与目录条目按 bookmark 名对齐」替代纯顺序对齐，属 §3.8 映射规则变更，需架构裁决；本卡按冻结规则实现。

### C-PDF-04（测试数据与用例不一致）
- examples/headings.md 实际 H1–H3 = 25 条（总标题 26，含 1 条 H4）；examples/long-50.md 实际 H1–H3 = 134 条，而 test-cases.md 写 34 / 135。
- 本卡 e2e 按实际值断言（25/25、134/134）；TC-LONG-TOC-CONV 的「条目数 = 135」需用例侧修正。

### C-PDF-05（交接卡 5 / dev-cli）CLI 已接 renderWithToc，注意三点
- CLI 传 `outDir: dirname(docxPath)`，本卡按输入文件名推基名，嵌套目录（-r）与单文件命名均一致（无需新增参数）。
- `--format docx` + 长文 + 引擎可用：本卡执行「2 次 DOCX + 2 次 PDF」以完成 C1–C3 校验并支持重试一次；§3.8 表写「1 次 DOCX + 1 次 PDF」。这是有意偏差：单次导出无法校验也无法重试。实测 140 页约 +2.6 s，仍在 NFR-004 预算内；如需严格省一次导出请裁决。
- 降级 WARN 文案不含文件名（requirements §6.2 固定文案），而 §9.4 的 `WARN <code>: <file>:` 模板会在 CLI 层再加文件名；TC-TOC-DEGRADED 断言「恰有 1 条不带文件名的固定文案」，请 CLI 侧确认拼接口径。

### 测试路径命名
- test-cases.md 的 TC-TOC-02 命令写 `tests/toc-convergence.test.mjs`（tests/），本卡写入范围只允许 `test/toc/**`，故文件为 `test/toc/toc-convergence.test.mjs`；命令见第 6 节。建议用例侧同步路径。

## 5. 残余风险

| 编号 | 状态 | 说明 |
|---|---|---|
| R-01（3 位页码） | **已关闭** | S-01：140 页 / 660 条 / 660-660 一致 / 两遍 140-140 |
| R-02（浮动图片、跨页表格） | **已关闭** | S-02：27 页 / 24 条 / 24-24 一致 |
| R-03（H4–H6 干扰映射） | 已处理 | 按 level <= 2 过滤，不按标题文本；spike 与单测双证 |
| R-04（Word 分页不同） | 不变 | README 声明，不承诺 Word 页码 |
| PDF 字节级可复现 | 说明 | PDF 只承诺版式/内容级（D3）；render-pdf 测试不断言两次 sha 相同 |

## 6. 复现命令

~~~powershell
cd docconvert
node --test --test-isolation=none test/toc/toc-convergence.test.mjs test/toc/outline.test.mjs test/toc/degrade.test.mjs test/pdf/kit-locator.test.mjs test/pdf/render-pdf.test.mjs
node test/pdf/two-pass-check.mjs --json=test/pdf/two-pass-report.json
node test/pdf/e2e-real-pipeline.mjs --json=test/pdf/e2e-report.json
~~~
