# docconvert 外部同类工具盘点（阶段 0.5，闸门 1 硬前置）

> 调研员：workspace-surveyor（task t5 / attempt b69a334b）  
> 时间：2026-10-22 00:42–01:05（Asia/Shanghai）  
> 范围：只做外部工具调研；未安装、未运行任何工具，未改其他文件。  
> 说明：本机 PowerShell 直连 npm registry 超时；web_search / web_fetch 可用，registry 走 npmmirror 镜像、包内容走 unpkg、GitHub raw 走 ghproxy。

---

## 1. 结论速览表

| 工具 | 是否存在 | 一条命令双产出 | 模板内置 | 零配置 | 判定 |
|---|---|---|---|---|---|
| npm `docconvert-cli` | ✅ 存在，v1.0.3 | ❌ 一次只出一种（默认 docx，PDF 需 `-t pdf`） | ⚠️ 有 templates/ 目录，但需 `--template` 手动指定 | ❌ 需手动装 Python 3.6+、Pandoc、xelatex | **不满足**（缺 a、c；且 bin 名与本项目冲突） |
| npm `markdownforge` | ✅ 存在，v0.0.4 | ✅ 默认 `pdf,docx` 同时产出 | ✅ 内置 default/github/academic 主题 + DOCX 内置格式，无需用户提供模板 | ✅ Node≥16；DOCX 纯 Node；PDF 用 Puppeteer（安装期自动拉 Chromium）；源码中 Pandoc 检查恒为可用 | **三条件满足（静态核验）→ 存在可薄封装候选**，但与 5 项裁决冲突 |
| `md2pdf-skill`（GitHub） | ✅ 存在（cy070812/md2pdf-skill） | ❌ 只出 PDF，无 DOCX | ⚠️ 内置 CSS 主题，可 `-c` 覆盖 | ⚠️ 需 Python 3.8+ + `pip install -r requirements.txt`；浏览器用系统 Edge/Chrome（Windows 自带 Edge 可满足） | **不满足**（缺 a；浏览器路线与裁决冲突） |
| `pandoc-docker` | ❌ npm 无此包；存在 Docker 镜像/仓库路线（pandoc/dockerfiles） | ❌ pandoc 一次只出一种格式 | ⚠️ `pandoc/extra` 含模板/字体，但需自己组合 | ❌ 需手动安装并运行 Docker；PDF 需 latex 镜像（TeX 数 GB） | **不满足**（缺 a、c） |
| 附加：npm `md2x` | ✅ 存在，v0.7.7 | ❌ 一次一种格式（`-f`，默认 pdf） | ✅ 内置主题（`--list-themes`） | ⚠️ Node + Puppeteer；默认 npm 安装会拉 Chromium | **不满足**（缺 a；浏览器路线） |
| 附加：npm `@jabezpauls/md-converter` | ✅ 存在，v1.0.7 | ❌ 一次一种格式（`-f docx` / `-f pdf`） | ⚠️ 内置渲染样式，模板能力未宣称 | ❌ PDF 需本机已装 Chrome/Chromium | **不满足**（缺 a、c） |

**速览结论：四项必查里只有 `markdownforge` 满足三条件；其余均不满足。是否薄封装取决于技术负责人是否接受“PDF 走 Chromium”与已定的 5 项裁决冲突。**

---

## 2. 逐项证据

### 2.1 npm `docconvert-cli`（kyirexy/docconvert-cli）

**存在性与版本**

- npm registry 镜像：`https://registry.npmmirror.com/docconvert-cli` → `dist-tags.latest = 1.0.3`，created `2026-04-19T03:03:03Z`，modified `2026-04-19T05:51:02Z`；版本仅 `1.0.1`、`1.0.3`。
- 包内容：`https://unpkg.com/docconvert-cli@1.0.3/package.json` → `main: docconvert.py`、`bin: {docconvert: ./bin/docconvert.js, docconvert-install: ./scripts/install.js}`、`engines.node >=18`、`dependencies` 仅 `prompts`、`postinstall: node scripts/postinstall.js`。
- README：`https://unpkg.com/docconvert-cli@1.0.3/README.md`。
- 维护状态：仅 2 个版本，集中在 2026-04-19 当天发布；作者仓库 `https://github.com/kyirexy/docconvert-cli`。**license MIT**（README 与 package.json 一致）。

**运行依赖（README“环境要求”原文）**

> Python 3.6+（必需）、Pandoc（必需，`winget install JohnMacFarlane.Pandoc`）、xelatex（仅 PDF，`winget install MikTex.MikTex`）

**是否一条命令同时出 docx + pdf**：❌。README 用法为 `docconvert input.md`（默认 docx）、`docconvert input.md -t pdf`；没有“一次同时输出两种”的选项，属于“一个工具、两次命令”。

**模板是否内置**：⚠️ 部分。README 项目结构含 `templates/` 与 `--template default.docx`，但示例仍要求用户显式 `--template`；未看到“默认自动套模板”的证据。

**是否零配置**：❌。必须手动安装 Python、Pandoc、xelatex；PDF 依赖 LaTeX，安装体积大、中文需额外字体配置。

**中文 / Windows / 输出质量**：README 宣称“中文支持完善”、支持 Windows（winget 安装）；输出质量由 Pandoc + LaTeX 模板决定，README 无示例 PDF 可核验。

**额外风险（名称冲突）**：其 npm bin 名就是 `docconvert`，与本项目目标命令同名；若全局安装会与我们的 `docconvert` 冲突。

**小结论**：不满足薄封装三条件；且它本身依赖 Pandoc+LaTeX，正是我们要避免的重依赖路线。

### 2.2 npm `markdownforge`（rauofthameem/markdownforge）

**存在性与版本**

- `https://registry.npmmirror.com/markdownforge` → latest `0.0.4`；created `2025-07-07T04:42:58Z`，modified `2025-07-12T09:19:45Z`，0.0.4 发布于 `2025-07-10T04:57:41Z`；版本 `0.0.2/0.0.3/0.0.4`。
- `https://unpkg.com/markdownforge@0.0.4/package.json` → `bin: {markdownforge: ./bin/fileconverter.js}`、`engines.node >=16`、license **MIT**、repo `https://github.com/rauofthameem/markdownforge`。
- 依赖：`chalk`、`commander`、`cosmiconfig`、`debug`、`docx ^9.5.1`、`fs-extra`、`joi`、`markdown-it ^14`、`ora`、`puppeteer ^24.11.2`。
- 维护状态：0.0.x 早期版本，最后发布 2025-07-10，距今约 15 个月；README 有完整文档与 CI badge，但属于个人项目。

**是否一条命令同时出 docx + pdf**：✅。README Quick Start 原文：

> `npx markdownforge document.md` — “Forge a Markdown file to both PDF and DOCX”

源码佐证：`bin/fileconverter.js` 的 `--format` 默认值为 `'pdf,docx'`；`src/core/documentProcessor.js` 的 `format: options.format || ['pdf','docx']`；同一次 `processDocument()` 依次调用 PDFConverter 与 DOCXConverter。

**模板是否内置**：✅。README 内置 `default`、`github`、`academic` 三套主题；DOCX 侧有内置 formatting 默认值（字号、颜色、段距、表格），无需用户提供 `reference.docx`、LaTeX 模板或 CSS。注意：README Roadmap 里“Template Support（自定义文档模板）”仍未完成——即“内置主题有、自定义模板无”，但这不违反“用户无需手动提供模板”。

**是否零配置**：✅（静态源码核验；未实际安装运行）。

- 不需要 Pandoc：`src/converters/docxConverter.js` 第 855 行起 `checkPandocAvailability()` 直接返回 `{available: true, version: 'native-docx-library'}`；DOCX 由 npm `docx` 库纯 Node 生成。README 与 Troubleshooting 仍写“需要 Pandoc”，属于**文档滞后**（以 0.0.4 源码为准）。
- 不需要手动装浏览器：PDF 由 `puppeteer ^24.11.2` 启动 Chromium；puppeteer 在安装期自动下载浏览器，属于规则允许的“安装期自动拉依赖”。
- 不需要手动配字体：PDF 用 Chromium 系统字体回退；DOCX 默认 Calibri（无 eastAsia 设置）。

**中文 / Windows / 输出质量**

- 中文：README 未宣称中文优化；PDF CSS 字体栈为 `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto...`，无 CJK 字体栈；DOCX 默认 `fonts.default = 'Calibri'`，没有 `w:eastAsia` 指定。中文可能靠系统回退显示，但**排版质量未验证**，与“中文美化排版”目标存在明显风险。
- Windows：README 宣称 cross-platform（Windows/macOS/Linux）；Puppeteer 支持 Windows。
- 输出质量：内置三主题、Mermaid、Admonitions；DOCX 用 `docx` 库生成表格/图片/标题。质量以 README 为准，未实跑。

**关键风险**

1. 0.0.4 早期版本、维护低频；无稳定 API/模板契约。
2. PDF 路线是 Chromium（Puppeteer），与裁决“PDF 复用 LibreOffice Kit”“浏览器不进 v1”直接冲突。
3. 无中文 eastAsia 字体控制，无法直接复现既有中文版式基线（雅黑、H1 18pt/表格 8.5pt 等）。
4. 输出仅 Markdown 输入，未宣称 `.txt` 支持；无版本清单/可复现声明。

### 2.3 `md2pdf-skill`（GitHub：cy070812/md2pdf-skill）

**存在性与技术路线**

- GitHub 仓库：`https://github.com/cy070812/md2pdf-skill`（web_search 返回标题与描述：“把 Markdown 转成中文排版良好的 A4 PDF｜无需配置字体、无需 GTK 等系统依赖，复用浏览器渲染引擎。也可作为 Agent Skill 使用”）。
- README（经 ghproxy 读取 raw）：`https://ghproxy.net/https://raw.githubusercontent.com/cy070812/md2pdf-skill/main/README.md`。
- **技术路线 = 浏览器 Chromium/Edge 无头打印**，README“工作原理”原文：`Markdown → python-markdown（tables/nl2br/fenced_code）→ HTML 片段 + 打印样式 → 浏览器无头模式 --headless=new --print-to-pdf → A4 PDF`。
- 依赖：Python 3.8+、`pip install -r requirements.txt`（python-markdown）、系统 Edge/Chrome/Chromium（自动查找，可用 `--browser` 指定）。
- license：README“许可”章节写明 **MIT**。

**能力判定**

- 一条命令双产出：❌ 只生成 PDF（`python md2pdf.py 报告.md → ./PDF/报告.pdf`），仓库没有 DOCX 能力。
- 模板内置：⚠️ 默认打印 CSS 内置，可用 `-c` 覆盖；但不是 docx/pdf 双端模板体系。
- 零配置：⚠️ 需 `pip install` 安装 Python 依赖；浏览器用系统已有的 Edge/Chrome（Windows 自带 Edge 可满足），不需要 TeX/Docker/手动配字体。
- 中文/Windows：✅ 明确中文优先、Windows 优先用 Edge；无页码（README FAQ 明确“页码不支持”）。

**小结论**：不满足（缺 DOCX 双产出）；且浏览器路线与 5 项裁决冲突。

### 2.4 `pandoc-docker`（Docker + pandoc 路线）

**存在性**

- npm 包 `pandoc-docker`：❌ 不存在。`https://registry.npmmirror.com/pandoc-docker` 返回 `{"error":"[NOT_FOUND] pandoc-docker not found"}`。
- 实际存在的是 Docker 镜像/仓库路线：官方 Dockerfiles 仓库 `https://github.com/pandoc/dockerfiles`（web_search 证据）；镜像 `pandoc/minimal`、`pandoc/core`、`pandoc/latex`、`pandoc/extra`。
- README（经 ghproxy 读取 sunaoka/pandoc-dockerfiles 的 raw，内容与官方 pandoc/dockerfiles 同源）：`https://ghproxy.net/https://raw.githubusercontent.com/sunaoka/pandoc-dockerfiles/master/README.md`。

**README 关键原文**

> “This repo contains a collection of Dockerfiles to build various pandoc container images.”  
> “latex: builds on top of the core image, and provides a basic LaTeX installation...”  
> “Install Docker if you don't have it already. Start up Docker.”

**能力判定**

- 一条命令双产出：❌ pandoc 一次调用只输出一种格式；要 docx+pdf 至少两次命令 + 两个输出参数，且 PDF 需 `pandoc/latex` 镜像。
- 模板内置：⚠️ `pandoc/extra` 含模板/字体，但用户仍需组合镜像与模板参数；不是“docconvert 内置模板”。
- 零配置：❌ 必须手动安装 Docker（Windows 还需 WSL2/虚拟化），并拉取 GB 级镜像；PDF 依赖 TeX。
- 中文/Windows：取决于镜像内字体与 LaTeX 中文配置；本机无 Docker，未能验证。

**小结论**：不满足；且引入 Docker 与 TeX 是更重的依赖，与本项目方向相反。

### 2.5 附加候选（不替代必查四项）

**npm `md2x` v0.7.7**

- `https://registry.npmmirror.com/md2x` → latest `0.7.7`，modified `2026-01-31T07:08:07Z`，license **ISC**，repo `https://github.com/LarchLiu/md2x`，bin `md2x`，依赖 `puppeteer 24.35.0`、MCP SDK 等。
- README：`https://ghproxy.net/https://raw.githubusercontent.com/LarchLiu/md2x/main/README.md`。支持 `pdf/docx/html/png/jpg/webp`，但 CLI 一次只出一种（`-f`，默认 pdf；示例 `npx md2x input.md` 出 PDF、`-f docx` 出 DOCX），内置主题，默认 Puppeteer/Chromium。
- 判定：不满足 a（非一条命令双产出）；浏览器路线与裁决冲突。

**npm `@jabezpauls/md-converter` v1.0.7**

- `https://registry.npmmirror.com/@jabezpauls%2Fmd-converter` → latest `1.0.7`，modified `2026-07-27T06:54:02Z`，license **MIT**，bin `md-converter`，依赖 `docx`、`puppeteer-core`、`remark`、`shiki` 等。
- README：`https://unpkg.com/@jabezpauls/md-converter@1.0.7/README.md`（registry 摘要亦给出）：“For PDF conversion, you'll also need Chrome or Chromium installed.”；用法 `md-converter document.md -f docx`，一次一种格式。
- 判定：不满足 a、c（PDF 需本机预装 Chrome/Chromium）。

---

## 3. 总判定与对闸门 1 的影响

### 3.1 总判定

**存在可薄封装候选：`markdownforge@0.0.4`。** 三条件静态核验结果：

| 条件 | markdownforge 0.0.4 | 证据 |
|---|---|---|
| a) 一条命令同时出 docx+pdf | ✅ | `--format` 默认 `pdf,docx`；`processDocument()` 一次调用生成两种输出 |
| b) 模板内置 | ✅ | 内置 default/github/academic 主题 + DOCX 内置 formatting；无需用户提供模板 |
| c) 零配置（安装期自动拉依赖可接受） | ✅ | Node≥16；DOCX 纯 `docx` 库；PDF Puppeteer 安装期自动拉 Chromium；源码 Pandoc 检查恒为 true |

**但该候选与已定的 5 项裁决存在 3 处硬冲突**，因此“可薄封装”不等于“可直接采用”：

| 裁决 | markdownforge 现状 | 冲突级别 |
|---|---|---|
| PDF 复用 LibreOffice Kit | PDF 走 Puppeteer/Chromium | **硬冲突（架构级）** |
| 浏览器不进 v1 | 核心依赖 Puppeteer | **硬冲突** |
| 模板以既有版式为基线 | 主题为英文风格，DOCX 默认 Calibri、无 eastAsia | **硬冲突（中文版式）** |
| DOCX 字节级 / PDF 版式级可复现 | 无版本清单/时间戳固定；PDF 由 Chromium 生成 | 中风险（需包装层补） |
| Node 单运行时 | 满足（纯 Node） | 无冲突 |

### 3.2 若走薄封装：封装点与缺口

**封装点（薄）**

1. 子进程：`markdownforge <input.md> --format pdf,docx --output <outdir> --name <base>`；或直接 `require('markdownforge').DocumentProcessor` 调用 API（包 main 为 `src/index.js`，导出 DocumentProcessor）。
2. 包装层补充：`.txt → 临时 .md` 适配、输出命名/目录约定、统一错误码、`--version` 版本清单（markdownforge 版本 + Node 版本 + Chromium 版本）。

**缺口（薄封装无法覆盖，需 fork 或上游 PR）**

1. **PDF 后端**：把 Puppeteer 换成 LibreOffice Kit（docx→pdf），否则违背裁决 1/2；这已不是“薄”封装。
2. **中文版式**：DOCX 需补 `w:eastAsia` 字体、A4 边距、H1/H2/H3 字号、表格 8.5pt、页脚页码；PDF 需中文 CSS 字体栈与页码。现有配置未暴露 eastAsia，需改源码。
3. **`.txt` 输入**：CLI 参数为 Markdown 文件；需包装层转换或上游支持。
4. **可复现性**：固定 DOCX core 时间戳、PDF 元数据；记录模板/主题版本。
5. **维护风险**：0.0.4、个人项目、最后发布 2025-07；采用即承担上游停滞风险。

### 3.3 对闸门 1 的影响

- 本任务已完成“是否存在现成工具”的硬前置调研：**存在一个三条件满足的候选（markdownforge）**，因此架构阶段**不能直接跳过薄封装评估**。
- 但该候选与 5 项裁决中的 PDF/浏览器/中文模板三项硬冲突。**建议架构阶段先做一次“薄封装 vs 新开发”的裁决会**，而不是直接开工：
  - 若坚持 5 项裁决 → 薄封装不可行，新开发成立（本报告即为其旁证）；
  - 若愿意放宽 PDF/浏览器裁决 → 以 markdownforge 为底座做 fork 式改造（替换 PDF 后端 + 中文模板），工作量仍不小，且需接受 0.0.x 维护风险。
- 其余工具（docconvert-cli、md2pdf-skill、pandoc-docker、md2x、md-converter）均不满足三条件，不构成薄封装候选。

---

## 4. 方法与来源清单、未验证项

### 4.1 方法与命令

| 步骤 | 方法/命令 | 结果 |
|---|---|---|
| 1 | `web_search` 四组关键词 | 取得 GitHub/仓库线索（md2pdf-skill、pandoc/dockerfiles、markdownforge 等） |
| 2 | `web_fetch https://registry.npmjs.org/<pkg>` | ❌ `TypeError: fetch failed`（本机直连 registry 不可用） |
| 3 | `web_fetch https://registry.npmmirror.com/<pkg>` | ✅ 取得 docconvert-cli/markdownforge/md2x/md-converter 元数据；md2pdf-skill、pandoc-docker 返回 NOT_FOUND |
| 4 | `web_fetch https://unpkg.com/<pkg>@<ver>/package.json`、`/README.md`、`/?meta` | ✅ 取得包清单、依赖、README、源码文件列表 |
| 5 | `web_fetch https://unpkg.com/markdownforge@0.0.4/src/...` | ✅ 核实 DOCX 纯 Node、PDF Puppeteer、Pandoc 检查恒 true |
| 6 | `web_fetch https://ghproxy.net/https://raw.githubusercontent.com/...` | ✅ 读取 md2pdf-skill、pandoc-dockerfiles、md2x 的 README（GitHub 直连被解析到非公网 IP，被沙箱拒绝） |
| 7 | 本地只读检查 | 未安装任何包；未执行 `npm install` / `pip install` |

### 4.2 来源 URL

- https://registry.npmmirror.com/docconvert-cli
- https://unpkg.com/docconvert-cli@1.0.3/package.json
- https://unpkg.com/docconvert-cli@1.0.3/README.md
- https://registry.npmmirror.com/markdownforge
- https://unpkg.com/markdownforge@0.0.4/package.json
- https://unpkg.com/markdownforge@0.0.4/README.md
- https://unpkg.com/markdownforge@0.0.4/src/core/documentProcessor.js
- https://unpkg.com/markdownforge@0.0.4/src/converters/docxConverter.js
- https://unpkg.com/markdownforge@0.0.4/src/converters/pdfConverter.js
- https://github.com/cy070812/md2pdf-skill
- https://ghproxy.net/https://raw.githubusercontent.com/cy070812/md2pdf-skill/main/README.md
- https://github.com/pandoc/dockerfiles
- https://ghproxy.net/https://raw.githubusercontent.com/sunaoka/pandoc-dockerfiles/master/README.md
- https://registry.npmmirror.com/md2x
- https://ghproxy.net/https://raw.githubusercontent.com/LarchLiu/md2x/main/README.md
- https://registry.npmmirror.com/@jabezpauls%2Fmd-converter
- https://unpkg.com/@jabezpauls/md-converter@1.0.7/README.md

### 4.3 未验证项（如实声明）

- **未实际安装/运行任何工具**（任务禁止安装）：markdownforge 的 PDF/DOCX 实际输出质量、中文渲染效果、Windows 行为均未实跑验证；其“零配置”结论基于源码静态核验。
- markdownforge 0.0.4 源码与 README 对 Pandoc 的表述不一致：源码 `checkPandocAvailability()` 恒返回可用，README/Troubleshooting 仍称需要 Pandoc；本报告以源码为准，但**未实跑证明无 Pandoc 时可正常出 DOCX**。
- GitHub 仓库页面（stars、issue 活跃度、release 记录）无法直连，仅通过 web_search 标题与 raw README 佐证；**下载量、star 数、issue 响应速度未验证**。
- Docker Hub（hub.docker.com）被沙箱拒绝（non-public IP），pandoc 镜像的 tag/大小/更新时间未验证；pandoc-docker 结论基于官方 Dockerfiles README。
- docconvert-cli 的 `templates/` 内容与默认模板是否自动生效，未逐文件核验。
- 未验证 `markdownforge` 对 `.txt` 输入的行为（README 只写 Markdown 文件）。

---

## 5. RESULT JSON

```json
{
  "role": "工作区调研员",
  "stage": 0.5,
  "status": "completed",
  "summary": "外部同类工具盘点完成：npm docconvert-cli（v1.0.3，需 Python+Pandoc+xelatex，一次一种格式）不满足；npm markdownforge（v0.0.4，MIT，默认一条命令同出 pdf+docx，内置主题，DOCX 纯 Node、PDF Puppeteer 自动拉 Chromium，源码中 Pandoc 检查恒为可用）三条件静态满足，是唯一可薄封装候选；md2pdf-skill 只出 PDF（浏览器路线）；pandoc-docker 无 npm 包、需 Docker+TeX；附加 md2x 与 @jabezpauls/md-converter 均一次一种格式、不满足。总判定：存在可薄封装候选（markdownforge），但其 PDF/浏览器/中文模板与 5 项裁决硬冲突，须技术负责人先裁决薄封装 vs 新开发。",
  "artifacts": ["docconvert/external-tools-survey.md"],
  "gate_result": "pass",
  "issues": [
    "markdownforge 0.0.4 三条件满足（静态核验），但 PDF 走 Puppeteer/Chromium，与裁决“PDF 复用 LibreOffice Kit”“浏览器不进 v1”硬冲突",
    "markdownforge 无中文 eastAsia 字体控制、默认 Calibri，无法直接复现既有中文版式基线；PDF CSS 无 CJK 字体栈",
    "markdownforge 为 0.0.x、个人项目、最后发布 2025-07-10，维护风险高；README 与源码对 Pandoc 的表述不一致",
    "docconvert-cli 的 bin 名 docconvert 与本项目目标命令冲突，且需 Python+Pandoc+xelatex，不满足零配置",
    "未实际安装/运行任何工具（任务禁止），输出质量与 Windows 实跑未验证；GitHub 页面、Docker Hub 不可直连"
  ],
  "retry_count": 0,
  "notes": "闸门 1 硬前置已交付。建议架构阶段先裁决：坚持 5 项裁决则走新开发；若放宽 PDF/浏览器裁决，则以 markdownforge 为 fork 底座（替换 PDF 后端 + 中文模板），仍非薄封装。"
}
```

---

*本文件为阶段 0.5 调研交付物；所有版本号与引文均来自上述 URL，未验证项已单列。*
