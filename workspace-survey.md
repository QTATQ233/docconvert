# docconvert 工作区现状盘点（阶段 -1）

> 盘点员：workspace-surveyor（docconvert 团队，task t1 / attempt bc9f317b）  
> 盘点时间：2026-10-21 23:00–23:40（Asia/Shanghai）  
> 工作区：`<workspace>`  
> 约束：只盘点，不写代码、不装依赖、不改源文件；唯一新增文件为本文件。  
> 盘点清单覆盖：必查项 **8/8**、附加项 **4/4**，覆盖率 **100%**；结论置信度 **约 90%**（未验证项见 §6.3）。

---

## 1. 摘要与结论

### 1.1 一句话结论

当前工作区**没有任何可用的 md→docx / md→pdf 转换入口**。唯一已经验证跑通的转换能力是 DSH 自带的 **LibreOffice Kit 0.1.5（native 引擎）**：本机既有的 PDF 就是它导出的。DOCX 侧只有一份 python-docx 生成的成品、一个表格后处理脚本和 uv 缓存里的 python-docx wheel，**没有可复用的生成器或模板**。因此建议：**DOCX 作为母版，PDF 由 LibreOffice Kit 从同一份 DOCX 导出**；解析器、生成器、模板系统、CLI 需要新开发，版式规则与调用约定尽量复用。

### 1.2 PDF 路线建议（明确）

**首选路线：Markdown → DOCX（本程序生成）→ PDF（LibreOffice Kit `dsoffice convert`）。** 同一份 DOCX 的排版就是 PDF 的排版，天然满足“内容与排版分离”和版式一致性。

证据：

- `dsoffice capabilities` 实测返回 `runtime.version=0.1.5`、`backend=native`，转换矩阵包含 `doc/docx/odt → pdf`（完整输出见 §6.2）。
- 既有 `钓鱼鱼类调查报告.pdf` 的 XMP 元数据：`<pdf:Producer>LibreOfficeDev 26.8.0.3 (X86_64)</pdf:Producer>`、`<xmp:CreatorTool>Writer</xmp:CreatorTool>`，证明该引擎在本机真实执行过 docx→pdf。
- `.dsh-office-mvi68z1x/render/manifest.json`：`"backend":"native"`、`"rasterEngine":"pdfium"`、`"missingFonts":[]`、`"pageCount":12`，中文渲染无缺字。
- `@deepseek-ai/libreoffice-kit@0.1.5` 的 `package.json`：引擎包覆盖 `win32-x64`、`win32-arm64`、`darwin-x64`、`darwin-arm64`，Linux 走 WASM；要求 Node `>=22.19.0`，本机 Node `24.19.0` 满足。

**次选（不推荐主路线）：HTML → Chromium/Edge 打印 PDF。** 本机 Playwright 1.56.0 + chromium-1194 已安装，Edge 155.0.4283.62 存在，技术上可行；但它要求为 PDF 再维护一套 HTML/CSS 版式，DOCX 与 PDF 会变成两套排版，违背“内容与排版分离”的一致性和可维护性，且依赖浏览器体积大。列为待裁决的备用路线（§5.7）。

**不推荐路线：**

- LaTeX（`xelatex`/`pdflatex`/`lualatex` 全部未安装；中文字体配置重、安装体积大、当前无网络）。
- Pandoc（未安装；且缺 LaTeX/浏览器时同样无法产出 PDF）。
- wkhtmltopdf / md2pdf（未安装，且项目维护状态差）。

### 1.3 建议实现形态（供需求阶段决策，非本阶段结论）

**推荐：Node.js 24 单运行时 CLI**（`package.json` 的 `bin` 暴露 `docconvert`）：

- Markdown 解析：受控 GFM 子集解析器（当前无可用库，见 §4）。
- DOCX 生成：直接写 OOXML + 内置 reference 模板（Node 内置 `zlib` 足够实现 ZIP，无第三方依赖）。
- PDF：复用 `@deepseek-ai/libreoffice-kit` 的 `dsoffice convert`。
- 收益：一个运行时贯穿 md→docx→pdf；Windows 优先、macOS/Linux 有对应引擎；不依赖 MS Office、LaTeX、浏览器；本机可离线跑通。

**备选：Python 3.10 CLI**（python-docx 生成 DOCX + `dsoffice` 子进程导出 PDF）。优势是既有报告正是 python-docx 产物、`_tools/fix_docx_layout.py` 是 Python、Jinja2/reportlab 在缓存中；劣势是 **python-docx 当前未安装**、uv 离线复用被 ACL 阻断，且 PDF 仍需要 Node，形成双运行时。若技术负责人坚持 Python，需先解决 python-docx 依赖（§5.2、§5.6）。

### 1.4 盘点覆盖度

| 项目 | 结果 |
|---|---|
| 必查 8 项 | 8/8 已执行命令探测 |
| 附加 4 项（中文字体、可写性、命名冲突、既有输出质量） | 4/4 已探测 |
| 清单覆盖率 | **100%** |
| 结论置信度 | **约 90%**：macOS/Linux 字体与安装可达性无法在本机验证；uv 离线复用被沙箱 ACL 拒绝；`load_workspace_dependencies` 不在本会话工具集 |

**结论：建议进入需求阶段**，但需求阶段开始前需先完成 §5 的三项前置裁决：PDF 引擎随包分发方式（§5.1）、实现语言（§5.2）、模板来源与“可复现”定义（§5.3、§5.4）。

---

## 2. 表 1｜已有能力清单

| 能力 | 现有工具或文件 | 位置 | 版本或质量 | 是否可用 |
|---|---|---|---|---|
| md→docx 转换入口 | 无 | — | 无 `*.sh`、`Makefile`、`package.json`、`pyproject.toml` | ❌ 未找到 |
| md→pdf 转换入口 | 无 | — | 关键词 grep 仅命中 `fix_docx_layout.py` 的注释“md2docx 产物后处理”，无 pandoc/weasyprint/wkhtmltopdf 调用 | ❌ 未找到 |
| 既有 DOCX 成品（版式参考） | `钓鱼鱼类调查报告.docx` | 工作区根 | 53,920 B；python-docx 生成；A4（11906×16838 twips）；页边距上下 2.2 cm、左右 2.0 cm；Normal = Calibri + eastAsia 微软雅黑 12pt；H1 18pt / H2 15pt / H3 13pt；7 张表；29 个标题段（其中 H1 9 个）；40 处编号列表；页脚含 PAGE 域；**无代码块样式** | ⚠️ 版式可参考，不能直接当程序模板（含具体内容、无占位符、无代码块/封面/目录） |
| 既有 PDF 成品 | `钓鱼鱼类调查报告.pdf` | 工作区根 | 911,465 B；`%PDF-1.7`；12 页；XMP Producer = `LibreOfficeDev 26.8.0.3 (X86_64)`，CreatorTool = `Writer`，CreateDate = `2026-10-21T22:25:36+08:00`；嵌入 `MicrosoftYaHei` | ✅ 证明 docx→pdf 引擎在本机跑通 |
| DOCX 表格后处理 | `_tools/fix_docx_layout.py` | `_tools/` | 103 行；A4 页面、固定列宽、表头跨页重复、行不跨页、表格 8.5pt、微软雅黑 eastAsia、表后间距；依赖 python-docx | ⚠️ 规则可改造复用；当前 python-docx 未安装（`pip show python-docx` → not found） |
| PDF 导出引擎 | `@deepseek-ai/libreoffice-kit@0.1.5` + `@deepseek-ai/libreoffice-kit-win32-x64@0.1.5` | DSH npx 缓存 `...\_npx\<hash>\node_modules\@deepseek-ai\` | `dsoffice capabilities` 正常；native 后端；docx→pdf 支持；Node >=22.19 | ✅ 可用，但仅是 DSH 缓存副本，**不在项目依赖内**（关键缺口，见 §5.1） |
| 浏览器 / HTML→PDF | Playwright 1.56.0 + chromium-1194；Edge 155.0.4283.62 | `%LOCALAPPDATA%\ms-playwright`；`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` | 已安装，可直接驱动 | ✅ 技术可用；不推荐作为 PDF 主路线 |
| Markdown 解析库 | markdown-it-py 4.0.0（uv 缓存 wheel） | `%LOCALAPPDATA%\uv\cache\archive-v0\...` | 缓存存在，但未安装；`uv run --offline` 被沙箱 ACL 拒绝（`os error 5`） | ❌ 当前不可用 |
| DOCX 库（Python） | python-docx 1.2.0（uv 缓存 wheel） | 同上 | 缓存存在，但 `pip show` 未找到；离线调用失败 | ❌ 当前不可用（候选依赖） |
| 其他 Python 文档库 | reportlab 5.0.1、pypdf 6.4.0、mammoth、lxml 6.0.2、html4docx 1.2.0 | uv 缓存 | 均为缓存 wheel，未安装 | ❌ 当前不可用（候选依赖） |
| 系统中文字体 | Microsoft YaHei、YaHei UI、SimSun、SimHei、KaiTi、FangSong、DengXian | Windows 系统字体 | 已安装（System.Drawing 探测） | ✅ 可用；**Noto Sans CJK SC / Source Han Sans SC 未安装** |
| DSH Office Skill（DOCX） | `office-docx` | DSH npx 缓存 `dsh-skill-office/assets/office-docx` | 要求 python-docx + `load_workspace_dependencies` 返回的 Python | ❌ 当前会话不可用（缺 python-docx；该工具不在本会话工具集） |
| DSH Office Skill（PDF/渲染） | `office-export-pdf`、`office-render` | 同上 | 依赖 LibreOffice Kit CLI，给出 `dsoffice convert/render` 标准调用 | ✅ 可用（调用约定可复用） |
| 第三方 DOCX 工具脚本（只读） | WorkBuddy `docx` 插件：`scripts/office/{pack,unpack,validate}.py` + 20 KB SKILL.md | `%USERPROFILE%\.workbuddy\plugins\marketplaces\codebuddy-plugins-official\plugins\docx` | 另一 agent 平台的插件缓存；OOXML 打包/校验脚本（Python） | ⚠️ 仅作实现参考，不纳入运行时 |
| 第三方 PDF skill 文档（只读） | WorkBuddy `pdf` 插件：`skills/pdf/{SKILL,reference,forms}.md` | `...\plugins\pdf` | 指引文档，未发现转换脚本 | ⚠️ 仅参考 |
| 测试输入样例 | `钓鱼鱼类调查报告.md`（22 KB，8 章 / 6 表）、`research/{marine,freshwater,fantasy}.md` | 工作区 | 真实中文 GFM 文档，含宽表、长列表、引用 | ✅ 可复用为基线输入 |
| 期望输出 | 既有 docx / pdf | 工作区 | 人工检查质量可接受，但无生成脚本、无版本记录、PDF 含时间戳 | ⚠️ 只能做人眼参考，不能做自动 golden |
| 版本控制 | Git 2.51.1；仓库根 `<home>` | 工作区位于用户主目录仓库内，`git status` 显示 `?? ./` | 无项目级独立仓库 | ⚠️ 本阶段不动 Git；实现阶段建议新建独立项目目录/仓库 |
| 项目配置约定 | 无 `config.*`、`*.toml`、`*.yml` 项目配置 | 工作区 | 唯一可继承的是既有 DOCX 的版面参数 | ❌ 未找到 |
| CI / 容器 / 版本声明 | 无 README、CONTRIBUTING、`.nvmrc`、`.tool-versions`、Dockerfile、CI | 工作区 | — | ❌ 未找到 |

---

## 3. 表 2｜缺口清单

| 缺口 | 影响 | 建议补法 |
|---|---|---|
| Markdown 解析器（标题/段落/列表/表格/代码/引用/链接/强调） | 没有内容入口，无法开始转换 | 新开发受控 GFM 子集；用既有中文 md 回归；网络恢复后优先换用 markdown-it-py / markdown-it |
| DOCX 生成器 + 内置模板 | 无法产出“美化排版”的 docx | 新开发 OOXML 生成；内置 reference 模板；样式从既有 docx 抽取并重新参数化 |
| 模板体系（封面/目录/页眉页脚/代码块/图注/表格样式） | “美化排版”不达标 | 内置 1 套默认主题 + 可选 `--reference` 覆盖；内容与样式 token 分离 |
| 富元素（代码块、引用、图片、脚注、任务列表） | 真实文档渲染缺失 | v1 明确范围；逐项实现或显式降级并告警 |
| `.txt` 输入语义（标题识别/分段） | 无法满足 .txt 输入 | 规则化：空行分段、`#` 标题、首行标题；或纯段落模式 + `--title` |
| PDF 引擎随包分发 | 目标机没有 DSH 缓存时无法出 PDF | 把 `@deepseek-ai/libreoffice-kit` 声明为依赖（安装期下载）；或提供外部 `--pdf-engine` 命令 |
| 可复现性（版本清单/时间戳/PDF ID） | 输出无法审计复现 | `--version` 记录程序、模板、kit、engine、字体；DOCX core 时间戳固定；PDF 元数据后处理或声明“版式可复现、字节不保证” |
| 字体回退（macOS/Linux） | 跨平台中文排版崩坏 | 字体栈：Windows 雅黑/宋体；macOS PingFang SC/Songti SC；Linux Noto Sans CJK；导出前检测并告警 |
| CLI 入口 / 打包 / 帮助 / 错误码 | 无法“一条命令”使用 | npm `bin` + `docconvert <input.md> -o <outdir>`；统一退出码与错误信息 |
| 测试基线（fixtures + golden） | 无法回归验证 | 复用既有 md 输入；新增最小样例（中英混排、宽表、长代码、图片）；以结构断言为主 |
| 页码 / 目录 / 交叉引用 | 长文体验差 | DOCX 域代码 TOC + PAGE；PDF 由 LibreOffice 导出时验证域更新 |
| 依赖锁定 / 离线安装 | 目标机不可复现 | `package-lock.json` + `engines` 字段；文档说明离线缓存/内网镜像方式 |

---

## 4. 表 3｜复用 / 改造 / 新开发决策

| 模块 | 决策 | 理由（含“新开发”的不可复用/不可改造说明） |
|---|---|---|
| PDF 导出引擎 | **复用** `@deepseek-ai/libreoffice-kit@0.1.5`（`dsoffice convert`） | 已安装且 `capabilities` 验证；docx→pdf 在支持矩阵内；本机既有 PDF 由其导出；跨平台引擎齐全；无需改造。前提：必须声明为项目依赖随包安装（当前仅有 DSH 缓存副本）。 |
| DOCX 版式种子（A4、边距、中文字体、标题字号、表格 8.5pt、页脚页码） | **改造** 既有 `钓鱼鱼类调查报告.docx` 的样式 + `fix_docx_layout.py` 的规则，抽成内置 reference 模板 | 现有产物质量基本达标，但它绑定具体内容、没有占位符、没有代码块/封面/目录样式，不是模板文件；改造点：抽样式、去内容、补代码块/图注/封面/目录、参数化字体与字号。直接复用会把一次性报告的偶然样式固化。 |
| 表格后处理逻辑（固定列宽/表头重复/行不跨页/字号） | **改造**（逻辑复用，按最终语言重写或移植） | `fix_docx_layout.py` 依赖 python-docx，只能处理“已存在的 docx”，不能生成文档；其规则可完整移植到生成器。若最终选 Python 且能安装 python-docx，可直接复用该脚本。 |
| Markdown 解析 | **新开发**（受控 GFM 子集） | 工作区无解析器；pandoc 未安装；markdown-it-py 仅在 uv 缓存且离线调用被 ACL 拒绝；Node 侧没有 markdown 库。现有工具不可复用（不存在可导入实现），也不可改造（无源码、不可安装）。若实现阶段网络恢复，本行降级为“复用 markdown-it-py/markdown-it”。 |
| DOCX 生成器 | **新开发**（OOXML 直写）或复用 python-docx（若选 Python 且可安装） | 工作区无生成器；python-docx 当前未安装，uv 缓存离线不可用；`fix_docx_layout.py` 只能后处理。新开发理由：没有现成“md→docx”代码可复用或改造。 |
| 模板系统（内置默认主题 + 可选 reference 覆盖） | **新开发** | 工作区没有任何 `.docx`/`.tex`/`.css` 模板，既有 docx 只是成品；没有可复用或可改造的模板对象。 |
| CLI 与配置（零配置默认值、输出命名） | **新开发** | 无 `package.json`/`pyproject.toml`/脚本入口，无既有配置约定；没有入口可改造。 |
| 可复现性元数据（版本清单/固定时间戳） | **新开发** | 现有产物无版本记录；`.dsh-office-*/manifest.json` 只是 DSH 渲染缓存，不是程序版本清单；无对象可复用。 |
| 测试基线 | **复用** 输入（`钓鱼鱼类调查报告.md`、`research/*.md`）+ **新开发** golden | 输入真实、覆盖中文宽表；既有 docx/pdf 不能作自动 golden（无生成脚本、PDF 时间戳不稳定），需新建结构断言。 |
| `office-export-pdf` 的调用约定 | **复用**（CLI 契约） | 已有文档明确 `dsoffice convert --input <docx> --output <pdf>` 与 `%PDF-` 校验方式，直接沿用，避免自造协议。 |
| `office-docx` skill | **不复用**（当前不可用） | 依赖 python-docx + `load_workspace_dependencies`；本会话无该工具、系统 Python 无 python-docx，无法按 skill 原样执行。后续若安装依赖可改为“复用（实现参考）”。 |
| Pandoc / LaTeX / wkhtmltopdf / md2pdf | **不复用**（未安装/不适用） | 全部 `Get-Command` 未找到；LaTeX 中文字体与安装体积大；当前无网络。既不存在可复用实现，也没有可改造对象。 |
| Chromium/Playwright HTML→PDF | **待技术负责人裁决（不推荐主路线）** | 已安装可用，但与“同一份 DOCX 排版”冲突、需维护第二套 CSS、浏览器体积大；若采用会出现 DOCX 与 PDF 两套版式，违背内容/排版分离的一致性目标。 |
| WorkBuddy DOCX OOXML 脚本 | **仅参考，不复用** | 属于另一 agent 平台的插件缓存，无版本契约、依赖其 Python 环境；可参考其 pack/unpack/validate 思路，不纳入运行时。 |
| 中文字体 | **复用** Windows 系统字体 | 雅黑/宋体/黑体/楷体/仿宋齐全；跨平台需新增字体回退逻辑（属新开发，但字体本身可复用）。 |

---

## 5. 冲突与待裁决事项

### 5.1 【阻塞级】PDF 引擎如何随包分发

`@deepseek-ai/libreoffice-kit` 目前只存在于 DSH npx 缓存，**不是工作区/项目依赖**。若不在目标机安装它，docconvert 无法产出 PDF。选项：

| 选项 | 说明 | 评价 |
|---|---|---|
| A. 声明为 npm 依赖，安装时下载 | `npm install -g docconvert` 拉到 kit + 对应平台引擎 | **推荐**；需要安装期联网，包体较大 |
| B. 项目内 vendored 引擎 | 把 LibreOffice 引擎随包提交 | 体积巨大（数百 MB），不现实 |
| C. 要求用户预装 LibreOffice | 调用系统 `soffice` | 违背零配置；本机系统 soffice 也未安装 |

**请裁决：**“零配置”是否允许**安装期联网**？若不允许，PDF 路线需要重新评估（退化到浏览器路线同样需要安装浏览器，无法真正零安装）。

### 5.2 实现语言（Node vs Python）

- Node 方案：单运行时；PDF 引擎原生 Node；DOCX/解析器需自研或等网络装库。
- Python 方案：可继承既有 python-docx 经验与 `fix_docx_layout.py`；但 python-docx 当前缺失，PDF 仍要用 Node，形成双运行时。

**建议 Node；请技术负责人裁决。**

### 5.3 模板来源

用既有 `钓鱼鱼类调查报告.docx` 的样式做种子，会继承一次报告的偶然参数（H1 18pt、表格 8.5pt、2.2/2.0 cm 边距等）。建议以它为**参考基线**重新设计 token，而不是照搬。请裁决是否接受既有参数作为默认主题起点。

### 5.4 “输出可复现”的定义

PDF 由 LibreOffice 导出会写入创建时间与文档 ID（既有 PDF XMP `CreateDate=2026-10-21T22:25:36+08:00`），**字节级不可复现**。请裁决：

- 口径 A：版式与内容可复现即可（推荐；记录版本清单 + 结构断言）；
- 口径 B：PDF 字节级哈希稳定（需要对 PDF 做元数据归一化后处理，复杂度更高）。

### 5.5 当前会话无网络

`Invoke-WebRequest https://registry.npmjs.org/-/ping` 8 秒超时；`uv run --offline` 因 ACL 拒绝失败。若实现阶段必须新增 npm/pip 依赖，将被阻塞。**请裁决实现阶段是否允许联网/等待网络恢复。**

### 5.6 `office-docx` skill 的复用预期

该 skill 文档要求通过 `load_workspace_dependencies` 获取内置 Python + python-docx，但本会话工具集没有该工具，`~/.dsh` 下也未发现 `runtime.json` / 内置 `python.exe`，系统 Python 无 python-docx。**请裁决是否将其视为不可用能力**，避免实现阶段误以为 DOCX 生成可“开箱复用”。

### 5.7 浏览器路线是否保留

Playwright 1.56.0 + chromium-1194 与 Edge 155 均可用，可作为未来 HTML 预览或应急 PDF 后端；不建议进入 v1 主路线。请裁决是否纳入 roadmap。

---

## 6. 盘点方法与证据

### 6.1 执行过的命令（按探测项）

| # | 探测项 | 命令（摘要） |
|---|---|---|
| 1 | 工作区结构 | `Get-ChildItem -Force -Recurse -Depth 2`；扩展名统计 `Group-Object Extension` |
| 2 | 已有入口 | `Get-ChildItem -Recurse -File -Include *.py,*.js,*.ts,*.sh,*.md,*.json,*.toml,*.yml` + `Select-String` 关键词 |
| 3 | CLI 探测 | `Get-Command pandoc,xelatex,pdflatex,lualatex,typst,chromium,chrome,msedge,soffice,libreoffice,wkhtmltopdf,md2pdf,python,pip,node,npm,git`；`Test-Path` 常见安装路径 |
| 4 | 版本 | `python --version`；`pip --version`；`node --version`；`npm --version`；`git --version`；`(Get-Item msedge.exe).VersionInfo` |
| 5 | Python 依赖 | `python -m pip list`；`python -m pip show pypandoc python-docx weasyprint markdown` |
| 6 | npm 依赖 | `npm ls -g --depth=0`；工作区 `npm ls --depth=0`（无 package.json） |
| 7 | LibreOffice Kit | `node <npx>\@deepseek-ai\libreoffice-kit\lib\cli.js capabilities` |
| 8 | 既有 PDF 元数据 | Python `zipfile`/正则读取 XMP（`LibreOfficeDev 26.8.0.3`） |
| 9 | 既有 DOCX 质量 | Python `zipfile` 解析 `word/styles.xml`、`word/document.xml`、`word/footer1.xml` |
| 10 | 渲染能力证据 | 读取 `.dsh-office-*/render/manifest.json` |
| 11 | 浏览器 | `Get-ChildItem %LOCALAPPDATA%\ms-playwright`；`Get-Command msedge`；`Test-Path` Edge 路径 |
| 12 | 字体 | PowerShell `System.Drawing.FontFamily` 逐个探测 |
| 13 | 离线依赖 | `uv run --offline --no-project --with python-docx python -c ...`；`Invoke-WebRequest` npm ping |
| 14 | 配置/技能/插件 | `Get-ChildItem ~/.dsh`、`~/.workbuddy/plugins/...`、`.claude/skills`、`dsh-*` 包目录 |
| 15 | Git / 命名冲突 | `git rev-parse --show-toplevel`；`Get-ChildItem` 搜索 `docconvert` |

### 6.2 关键输出摘要

```text
python --version          → Python 3.10.11
py -0p                    → 3.10 *  <home>\AppData\Local\Programs\Python\Python310\python.exe
                            Astral/CPython3.12.12  <home>\AppData\Roaming\uv\python\...
pip --version             → pip 26.2.1 (python 3.10)
node --version            → v24.19.0
npm --version             → 11.17.0
git --version             → git version 2.51.1.windows.1
Get-Command pandoc        → NOT FOUND
Get-Command xelatex       → NOT FOUND
Get-Command pdflatex      → NOT FOUND
Get-Command soffice       → NOT FOUND
Get-Command wkhtmltopdf   → NOT FOUND
Get-Command md2pdf        → NOT FOUND
Edge                      → C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe，155.0.4283.62
Playwright                → 1.56.0；%LOCALAPPDATA%\ms-playwright 下 chromium-1194 / chromium_headless_shell-1194
```

```json
// dsoffice capabilities（节选）
{"runtime":{"version":"0.1.5","backend":"native", ...},
 "conversions":[{"inputs":["doc","docx","odt"],"outputs":["pdf","docx","odt","txt"]}, ...]}
```

```text
PDF XMP：<pdf:Producer>LibreOfficeDev 26.8.0.3 (X86_64)</pdf:Producer>
         <xmp:CreatorTool>Writer</xmp:CreatorTool>
         <xmp:CreateDate>2026-10-21T22:25:36+08:00</xmp:CreateDate>
DOCX：pgSz 11906×16838；pgMar top/bottom 1247、left/right 1134；
      Normal = Calibri + eastAsia 微软雅黑 + 12pt；H1 18pt / H2 15pt / H3 13pt；
      7 张表；29 个标题段（H1 9）；40 处 numPr；footer1.xml 含 PAGE 域；无代码样式
manifest："backend":"native", "rasterEngine":"pdfium", "missingFonts":[], "pageCount":12
pip list 相关：Jinja2 3.1.6、MarkupSafe 3.0.3、numpy 2.2.6、pillow 12.0.0、
              playwright 1.56.0、pyecharts 2.0.9、pydantic 2.12.5
uv 缓存相关：python-docx 1.2.0、markdown-it-py 4.0.0、html4docx 1.2.0、
            mammoth、lxml 6.0.2、reportlab 5.0.1、pypdf 6.4.0
网络：Invoke-WebRequest https://registry.npmjs.org/-/ping → 8s 超时
字体：YaHei / YaHei UI / SimSun / SimHei / KaiTi / FangSong / DengXian /
      Times New Roman / Arial / Calibri / Cambria / Consolas 已安装；
      Noto Sans CJK SC、Source Han Sans SC、Carlito、Caladea 未安装
```

### 6.3 未执行 / 未验证（如实声明）

- 未实际执行 md→docx/pdf 转换：本阶段规则禁止写输出文件；PDF 路线依据既有产物元数据 + `dsoffice capabilities`。
- 未验证 macOS/Linux 引擎与字体可用性（本机仅有 Windows 环境）。
- 未验证 npm/pip 安装（当前无网络）。
- 未验证 `load_workspace_dependencies`（该工具不在本会话工具集；也未在 `~/.dsh` 下发现内置 Python payload）。
- 未安装任何依赖、未修改任何源文件；未读取 `.credentials` 等敏感文件。

### 6.4 可写性与命名冲突

- **工作区可写**：本文件已成功写入 `docconvert/workspace-survey.md`（新建 `docconvert/` 目录）。
- **无同名项目**：全工作区只有 `.agent-teams/docconvert/`（团队状态目录，非项目代码）；用户 Documents/Desktop 下未发现 `docconvert` 项目。

---

## 7. 附：建议继承的默认版式参数（来自既有产物）

| 参数 | 既有值 | 建议 |
|---|---|---|
| 页面 | A4（11906×16838 twips） | 继承 A4；预留 `--page` 覆盖 |
| 页边距 | 上下 2.2 cm，左右 2.0 cm | 继承为默认值 |
| 正文字体 | Calibri（ASCII）+ 微软雅黑（eastAsia），12pt | 继承；补 macOS/Linux 回退 |
| 标题 | H1 18pt / H2 15pt / H3 13pt | 继承并补 H4–H6、段前段后 |
| 表格 | 8.5pt、固定列宽、表头重复、行不跨页 | 继承 `fix_docx_layout.py` 规则 |
| 页脚 | PAGE 域页码 | 继承；补“第 X 页 / 共 Y 页”可选 |
| 代码块 | 无 | **新增**等宽字体（Consolas / Cascadia Mono）+ 浅底 |
| 封面 / 目录 | 无 | **新增**（可选） |

---

*本文件为阶段 -1 盘点交付物，不含实现代码；所有结论均基于 §6 的命令与输出。*
