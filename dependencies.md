# docconvert 依赖清单（dependencies.md · 闸门 1 冻结）

> **状态**：**FROZEN**（2026-10-22）｜**配套文件**：`architecture.md`（§5 D6、§3.7、§10.2）｜**上游证据**：`spike-report.md` §2（Spike 2 离线解析）、`workspace-survey.md` 表 1/表 3。
> **硬约束（裁决②）**：除 `@deepseek-ai/libreoffice-kit@0.1.5` 外，**零第三方运行时依赖**；开发期同样零 npm 依赖（REQ-REUSE-004）。
> **本文件口径**：每项必须标注 6 个属性 —— **已有/新增**、**用户可见/隐藏**、**程序自带/不自带**、**离线可用性**、**版本锁定方式**、**（新增项）理由**。缺一即视为清单不合格。

---

## 1. 六属性总表

| ID | 依赖 | 已有/新增 | 用户可见性 | 程序自带 | 离线可用性 | 版本锁定方式 |
|---|---|---|---|---|---|---|
| D-01 | **Node.js 运行时**（>= 22.19.0，实测 24.19.0） | **已有**（本机 v24.19.0） | **用户可见**（唯一前置） | 不自带（用户环境） | 已安装即离线可用 | `package.json` `engines.node` + `--version` + 日志 `platform.node` |
| D-02 | **`@deepseek-ai/libreoffice-kit@0.1.5`**（PDF 引擎封装 + native 引擎） | **新增**（项目依赖；本机为 DSH npx 缓存副本） | **用户可见**（首次安装联网约 70 MB） | **程序自带**（npm 安装期拉取，不 vendored） | 安装后**离线可用**；DSH 环境零安装（复用缓存）；全新离线机需复制 kit | **精确版本 `"0.1.5"`（无 ^/~）+ package-lock + 运行时 `version === "0.1.5"` 校验** |
| D-03 | **平台引擎包**（`libreoffice-kit-win32-x64@0.1.5` / `darwin-x64` / `darwin-arm64` / `wasm`） | **新增**（随 D-02 自动安装） | 隐藏（按 os/cpu 自动选择） | 程序自带（kit 的 `optionalDependencies`） | 同 D-02 | 由 D-02 声明；运行时校验「同级引擎包存在且版本 0.1.5」 |
| D-04 | `node:fs` / `node:path` / `node:os` / `node:url` / `node:process` | 已有（Node 内置） | 隐藏 | 程序自带 | 离线 | 随 D-01（Node 版本） |
| D-05 | `node:zlib`（ZIP/Deflate） | 已有（Node 内置） | 隐藏 | 程序自带 | 离线 | 随 D-01；**影响 DOCX 字节一致性**（architecture §8.5 L1） |
| D-06 | `node:crypto`（SHA-256） | 已有（Node 内置） | 隐藏 | 程序自带 | 离线 | 随 D-01 |
| D-07 | `node:child_process`（调 `dsoffice` / `npm root -g` best-effort） | 已有（Node 内置） | 隐藏 | 程序自带 | 离线 | 随 D-01 |
| D-08 | `node:stream` / `node:util` / `node:events` / `node:buffer` | 已有（Node 内置） | 隐藏 | 程序自带 | 离线 | 随 D-01 |
| D-09 | `node:test` / `node:assert`（单测） | 已有（Node 内置） | 隐藏（仅开发期） | 程序自带 | 离线 | 随 D-01 |
| D-10 | **系统字体**：微软雅黑 / Calibri / Consolas（Windows）；PingFang SC / Songti / Menlo（macOS）；Noto Sans CJK / DejaVu（Linux） | **已有**（系统资源） | **用户可见**（观感） | **不自带**（不嵌入、不分发，REQ-REUSE-002） | 离线可用 | **回退链写死**（architecture §4.5）+ 运行时探测 + 日志 `fonts` 记录实际使用 |
| D-11 | **Windows VC++ v14 运行库**（kit native 引擎依赖） | 已有（多数 Win10/11 已装） | **用户可见**（缺失需装） | 不自带 | 需预装或联网装 | README 声明 + `docconvert doctor` 探测（引擎 `unavailable` → `pdf-engine-missing`） |
| D-12 | **内置模板 `templates/reference.docx`** | **新增**（本任务交付） | 隐藏（不可指定/不可覆盖） | **程序自带** | 离线 | **模板版本 = 文件 SHA-256 前 12 位**；启动与 `default.yml` 双向校验 |
| D-13 | **`config/default.yml`** + **自写 YAML 子集解析器**（`src/config/**`，≈80–120 LOC） | **新增**（配置随包；解析器自写） | 隐藏 | **程序自带** | 离线 | 白名单/黑名单校验 + 文件内容随包固定 + 与模板一致性校验 |
| D-14 | `tools/build-template.js`（构建期生成模板） | **新增**（开发期工具） | 隐藏 | 不进运行时依赖图 | 离线 | 随版本仓库；不发布为运行入口 |

**统计**：运行时第三方依赖 **1 个**（D-02，含其平台包 D-03）；Node 内置模块 0 个新增；开发期 npm 依赖 **0 个**。

---

## 2. 新增依赖的上报与理由（唯一新增 = kit）

### 2.1 D-02 `@deepseek-ai/libreoffice-kit@0.1.5`（新增，已上报）

| 项 | 内容 |
|---|---|
| 为什么必须新增 | 出 PDF 必须有分页器；裁决① 指定复用 kit；本机已验证 `docx → pdf` 在支持矩阵内（`dsoffice capabilities` 返回 `runtime.version=0.1.5`、`backend=native`，支持 `doc/docx/odt → pdf`）。自研分页器超出项目边界（architecture §5 D1）。 |
| 是否可避免 | **不可**。替代方案（浏览器/LaTeX/系统 LibreOffice/vendored 引擎）分别违背裁决⑤、零配置、零配置与体积约束（`workspace-survey.md` §5.1 三选项评估）。 |
| 体积代价 | kit tarball 104 KB；平台引擎 tarball **71,367,942 B（≈68 MB）**；解压 **190,868,740 B（182 MB）**；磁盘预留 ≥ 250 MB（spike §2.2、§2.7、§2.8）。 |
| 许可 | MIT（随 npm 包声明；平台引擎包同仓库发布）。**注**：LibreOffice 引擎本体为 MPL-2.0/LGPL 系，分发形态由 kit 包决定；发布前由技术负责人做一次许可证复核（见 §7 开放项 O-1）。 |
| 版本为何锁 0.1.5 | 本机缓存同时存在 0.1.2 与 0.1.5（spike §2.2），0.1.2 已实测被版本校验跳过；只有 0.1.5 有完整 spike 证据（两遍法 34/34、300/300）。**升级即需重跑 spike 与可复现测试。** |
| 离线可用性 | ① 已安装 → 完全离线；② DSH 环境 → 复用 npx 缓存，零安装零联网（spike §2.3 D1 实测）；③ 全新目标机 → **首次安装必须联网**（或复制 kit 目录 + 设 `DOCONVERT_LIBREOFFICE_KIT`）；④ 断网但已有 npm 缓存 → 可用，但 `npm install --offline` **未实测**（spike §2.7 声明）。 |
| 版本锁定三重 | (a) `package.json` `"@deepseek-ai/libreoffice-kit": "0.1.5"`（精确，无 `^`/`~`）；(b) 提交 `package-lock.json` 锁定传递依赖（`fflate/fontkit/koffi/saxes` 等）；(c) **运行时**校验 `name/version/cli.js/index.js/同级引擎包版本` 四条件（architecture §3.7）。 |

### 2.2 D-03 平台引擎包（新增，随之自动安装）

- **不写进 `dependencies`**：若强制声明，会让所有平台下载不匹配的包。由 kit 的 `optionalDependencies` 按 `os/cpu` 自动选择（spike §2.4 建议写法）。
- **实测覆盖**：`win32-x64`（本机，spike 全部实验）。`win32-arm64` / `darwin-x64` / `darwin-arm64` / `wasm` **未实测**（architecture §11.2 S-03）。
- **Linux 注意**：kit 的 Linux 引擎版本为 **0.1.1**（与 package 0.1.5 不同，spike §2.5 B 的 `engineVersions` 表），因此 Linux 上 **PDF 不承诺 v1 可用**；REQ-PLAT-002 为 P1，失败须给 `pdf-engine-missing` + hint。

---

## 3. 明确「不依赖」清单（防御性声明，评审逐条核对）

| 不依赖项 | 为什么不能引入 | 对应裁决/需求 |
|---|---|---|
| Pandoc | 表格/样式退化（缺陷 3）；未安装；Pandoc 需 TeX/HTML 后端才能出 PDF | 裁决⑤、REQ-REUSE-001 |
| LaTeX（xelatex/pdflatex/lualatex） | 数 GB、中文字体重、安装门槛高 | 裁决⑤、REQ-REUSE-001 |
| Chromium / Puppeteer / Playwright / Edge 打印 | 页码不可控、需第二套 CSS 版式、体积大 | 裁决①⑤、缺陷 1 |
| 系统 LibreOffice / `soffice` | 版本不可控 → 破坏可复现；本机系统未安装 | 裁决①、缺陷 2 |
| Docker / pandoc-docker | 零配置不可达（需 Docker + TeX 镜像） | 裁决⑤、external-tools-survey §2.4 |
| Python / python-docx | 形成双运行时；本机 python-docx 未安装 | 裁决②、workspace-survey §5.2 |
| `docx` 库 / `docx-lite` | 破坏 ZIP/时间戳控制（字节级可复现）与零依赖裁决 | 裁决②④、缺陷 6 |
| markdown-it / marked / remark | 受控 GFM 子集需精确的降级与告警控制，第三方解析器难对齐 REQ-MD-004/三态矩阵 | 裁决②、REQ-REUSE-004 |
| js-yaml / yaml | 仅需读**固定的内置**配置文件，自写 80–120 LOC 子集解析即可 | 裁决② |
| commander / yargs / chalk / ora | CLI 仅 7 个选项 + 纯文本输出（禁 ANSI），手写解析更可控 | 裁决②、REQ-CLI-007 |
| jest / vitest / mocha / eslint / prettier / typescript | 单测用 `node:test`；无构建步骤（纯 ESM JS + JSDoc） | 裁决②、§10.1 |

---

## 4. 离线可用性矩阵

| 环境 | docx 生成 | PDF 生成 | 需要联网？ | 证据 |
|---|---|---|---|---|
| 本机（已有 DSH npx 缓存） | ✅ | ✅ | **否** | spike §2.3 D1（npx-cache 命中 0.1.5）、§2.7（缓存 tarball 齐全） |
| 本机（项目 `node_modules` 已装） | ✅ | ✅ | 否 | spike §2.3 D2（project 命中） |
| 本机（设 `DOCONVERT_LIBREOFFICE_KIT`） | ✅ | ✅ | 否 | spike §2.3 D3 |
| 全新目标机（无缓存无 kit） | ✅ | ❌ → 安装后 ✅ | **是（首次）** | spike §2.7、§2.8 |
| 离线目标机（复制 kit 目录） | ✅ | ✅ | 否 | spike §2.8 第 4 条 |
| 离线目标机（预置 npm 缓存） | ✅ | ✅ | 否 | spike §2.7（packument + tarball 均在缓存）；`npm install --offline` 未实测 |
| macOS / Linux | ✅（预期） | ⚠️ 未实测（Linux 走 wasm 0.1.1） | 视安装 | architecture §11.2 S-03、REQ-PLAT-002（P1） |

**运行期网络行为（冻结）**：`REQ-IN-005`/`REQ-DEP-003` —— **运行期绝不联网**：不下载远程图片、不查 registry、不做引擎自更新。唯一联网窗口是 `npm install`。

---

## 5. 安装与体积预算（用户可见部分）

| 项 | 值 | 来源 |
|---|---|---|
| 运行时前置 | Node >= 22.19.0（推荐 24.x LTS） | kit `engines`（spike §2.2）；本机 v24.19.0 |
| npm 下载量 | 约 **70 MB**（kit 104 KB + 平台引擎 ≈68 MB + 依赖） | spike §2.7 |
| 解压后磁盘 | 引擎 **182 MB**；建议预留 **≥ 250 MB** | spike §2.2、§2.8 |
| Windows 额外前置 | Microsoft Visual C++ v14 Redistributable | spike §2.8 第 1 条 |
| 首次转换额外开销 | 建立字体元数据缓存（一次性） | spike §2.8 第 1 条 |
| 单次转换耗时 | 8 页 ≈ 3,987 ms；65 页两遍合计 **8,951 ms**（两遍额外 ≈ +4 s/文档） | spike §1.6、§1.9 |

---

## 6. 版本锁定策略（汇总）

| 层 | 手段 | 失效后果 |
|---|---|---|
| Node | `engines.node` + 启动预检（`runtime-unsupported`/4） | 太低 → 明确报错，不尝试降级兼容 |
| kit | 精确版本 + lockfile + 运行时四条件校验 | 版本不符 → `pdf-engine-missing`/4 + 候选失败原因 |
| 平台引擎 | kit 声明 + 运行时「同级包存在且 0.1.5」 | 缺包/DLL → `unavailable` → `pdf-engine-missing` |
| 模板 | 文件 SHA-256 前 12 位（`--version`/日志） | 字节变化 → 版本变化，可审计 |
| 配置 | 随包固定 + 白名单/黑名单 + 与模板一致性校验 | 非法键 → `template-missing`/4 |
| 字体 | 回退链写死 + 探测 + 日志实录 | 换机器 → 版式可能不同（PDF 级可复现限定，§8.5 L2） |

---

## 7. 开放项与升级流程

| 编号 | 开放项 | 影响 | 处置 |
|---|---|---|---|
| O-1 | kit 及其捆绑 LibreOffice 引擎的**许可证复核**（MPL/LGPL 系与 npm 包声明的对应关系） | 发布合规 | 发布前由技术负责人复核；若不允许随包分发，则改用「提示用户自行安装 + `DOCONVERT_LIBREOFFICE_KIT`」并同步改 README 与 D-02 的「程序自带」属性 |
| O-2 | 升级 kit（> 0.1.5） | 分页行为可能变化 → 目录页码与可复现性 | **必须**重跑：`TC-LONG-TOC-CONV`、`TC-RP-01/02`、`TC-H-02`、Spike 1 的两遍法校验；由技术负责人批准后同步本文件 |
| O-3 | Linux/macOS 引擎实测 | 平台承诺 | 闸门 3 前在目标平台跑 `docconvert doctor` + 一次长文转换（S-03） |
| O-4 | `npm install --offline` 未实测 | 离线安装路径文案 | 实现阶段若可联网，补一次实测并回填 §4 矩阵 |

**升级/变更流程**：任何依赖增删改 → 更新本文件（6 属性齐全）→ 技术负责人批准 → 同步 architecture §5 D6 / §10.2 → 若涉及 kit 版本，重跑 O-2 的测试集。

---

## 8. 与闸门 1 检查清单的对应

| gate1-checklist §D | 本文件落点 |
|---|---|
| D1「dependencies.md 标清已有 / 新增 / 离线可用性」 | §1 六属性总表（D-01…D-14）、§4 离线矩阵 |
| D2「kit 解析方案引用 spike 2」 | D-02 的离线可用性行、§4 矩阵、§6 版本锁定；解析顺序的实现在 architecture §3.7 |
| D3「无新增依赖，或新增必须写明理由并上报」 | §2.1（唯一新增 kit，含理由/体积/许可/版本/离线五段），§3 不依赖清单 |

---

*本文件为阶段 0.5 闸门 1 的依赖定稿，与 architecture.md 同步冻结；变更走 §7 流程。*
