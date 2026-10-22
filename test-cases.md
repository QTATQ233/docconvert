# docconvert 测试用例设计（阶段 0）

> 角色：测试设计者（泳道 C）　版本：v1 草稿　日期：2026-10-22
> 状态：**只设计、不执行**。参数名已按 `architecture.md` 附录 F 与 `requirements.md` §7 回填（入口 `docconvert`、`--format`、退出码 0/1/2/3/4/5）；仍未定的项明确标注「待需求定稿」或「待实现方提供」。
> 依赖输入：`workspace-survey.md`（阶段 -1）、技术负责人 5 项裁决、失败模式表（11 条）。
> 配套样本：`examples/`（本任务交付）。

---

## 1. 目的与范围

本文件定义 docconvert 的可执行验收用例，目标是让**任何执行者（人或 AI）照抄命令就能判定通过/失败**，不依赖"看着挺好"这类主观标准。

范围内：.md/.txt → .docx/.pdf 的转换正确性、排版可判定项、错误处理、可复现性、依赖缺失行为、模板来源唯一性。

范围外（v1 明确不做，不在本文件设用例）：浏览器/HTML 渲染路线、LaTeX 路线、数学公式排版、语法高亮、脚注与任务列表、跨平台（macOS/Linux）实机验证（只做字体回退的存在性检查）。

## 2. 执行前约定

### 2.1 工作目录、入口与参数（已按 architecture.md 附录 F 定稿）

所有命令都以 **`docconvert/` 项目根**为工作目录执行：

```powershell
Set-Location <工作区>\docconvert
```

入口为命令 `docconvert`（npm `bin: docconvert` → `bin/docconvert.js`）。未做全局安装时，用仓库内入口代替，**只替换这一处**：

```powershell
function docconvert { & node .\bin\docconvert.js @args }
```

参数集合（requirements §7.1，**仅此七项**，其余一律 `usage-error`=2）：

| 参数 | 取值 | 默认 |
| --- | --- | --- |
| `<input>` | 文件或目录 | 必填 |
| `-o, --outdir` | 目录 | `<输入所在目录>/docconvert-out/` |
| `-r, --recursive` | 开关 | 关 |
| `--format` | `docx` / `pdf` / `both` | `both` |
| `--continue-on-error` | 开关 | 关 |
| `-h, --help` | — | — |
| `-V, --version` | — | — |

> 不存在任何**覆盖类参数**（字体、字号、颜色、边距、页面尺寸、模板、参考文档、主题、样式覆盖、页眉页脚内容、编码覆盖、PDF 引擎路径、并发度、日志路径、输出文件名；REQ-CLI-003）；传入即 `usage-error`（2）。相关用例记 N/A 或改由 TC-CLI-01 断言。

### 2.2 dsoffice（PDF 引擎 CLI）的解析方式（禁止硬编码路径）

架构附录 F 明确：产品与用例**都不得**硬编码 `_npx/<hash>`。用项目依赖解析，或从环境变量指定的 kit 包目录取 `lib/cli.js`：

```powershell
# 方式 1：从项目依赖解析（推荐）
$KIT = node -p "require('path').join(require('path').dirname(require.resolve('@deepseek-ai/libreoffice-kit/package.json')),'lib','cli.js')"
node $KIT capabilities   # 自检：conversions 含 docx → pdf

# 方式 2：显式指定 kit 包目录（用于依赖缺失/降级用例）
$env:DOCONVERT_LIBREOFFICE_KIT = "C:\no\such\kit"        # 值为 kit 包目录，不是 cli.js
$KIT = Join-Path $env:DOCONVERT_LIBREOFFICE_KIT "lib\cli.js"
```

渲染（P0 视觉验收统一使用）：

```powershell
node $KIT render --input <文件> --output-dir <尚不存在的目录> --pages "1,2,3"
```

**两个硬性注意点**（kit 实测行为，踩中会假失败）：`--output-dir` 必须**尚不存在**；`convert` 的 `--output` 文件必须**不存在**（独占写入）。

### 2.3 证据格式

每个用例执行后，在 `test-report.md` 记录四样东西：

1. 实际命令（可复制）；
2. 退出码；
3. 命令输出中用于判定的原始行（页数、书签数、哈希、错误信息）；
4. 视觉验收：渲染出的 PNG 路径 + 一句"看到什么/没看到什么"。

**判定只认证据，不认"应该没问题"**。没有渲染图或没有命令输出的用例，按"未执行"计，不算通过。

### 2.4 视觉验收的写法约定

每条 P0 用例的视觉验收写清三件事：**渲染哪几页 → 看什么 → 看到什么算通过**。示例：

> 渲染第 2 页：表格首行应是表头（含"序号、观测日期、样区、时段、天气、物种、数量、备注"八个字段），下方接数据行。首行是数据行 ⇒ 失败。

禁止出现"检查排版是否美观""确认样式合理"这类不可判定表述。

---

## 3. 样本与期望值基线

`examples/` 的计数已逐项核对，可直接作为断言值（任何人改样本必须同步改本表）：

| 样本 | 关键计数 | 用途 |
| --- | --- | --- |
| `headings.md` | H1=4、H2=7、H3=14、H4=1（合计 26 个标题） | ① 标题层级 |
| `table.md` | 表 1：表头 + 6 行数据（8 列）；表 2：表头 + 60 行数据（8 列） | ② 表格 |
| `code.md` | 6 个围栏代码块；1 行超长单行（>200 字符） | ③ 代码块 |
| `image.md` | 4 张图片：1200×400、600×1800、96×96、900×520 | ④ 图片 |
| `cjk.md` | 9 个标题、3 段引用、13 个列表项、1 条长链接、3 个超长英文词 | ⑤ 中英混排 |
| `long-50.md` | 46,978 字符、134 个标题（H1=28 / H2=101 / H3=5）、316 行表格、14 个代码围栏 | ⑥ 长文档、TOC 页码收敛 |
| `notes.txt` | 首行标题 + 5 个中文序号小节 + 4 个无序项 + 4 个有序项 | ⑦ .txt |
| `errors/` | 见 `examples/errors/README.md`（E1–E6） | ⑧ 错误输入 |
| `conflict/` | 2 份同名 `reference.docx` 干扰文件 | ⑩ 模板冲突 |

期望页数为**估算区间**（默认模板定稿后以实测为准）；唯一硬指标是 `long-50.md` ≥ 50 页。

> **计数口径（C-PDF-04）**：`headings.md` 的 H1–H3 = **25**（书签 **26**，含 H4×1）；`long-50.md` 的 H1–H3 = **134**（H1=28 / H2=101 / H3=5，均不含代码块与引用内的伪标题）。**34 条标题 / 12 页**是 spike t3 的**合成 fixture**，不对应 `examples/` 下任何文件；正文提到 34 时仅指该 spike 结论。

---

## 4. 用例清单

用例 ID 规则：`TC-<类别>-<序号>`，类别缩写见 §5 矩阵。优先级：**P0 = 闸门 2 必须全过**；P1 = 应当通过，失败需记录但不阻塞闸门 2；P2 = 增强项。

### 4.1 ① 多级标题：Word 导航层级与 PDF 书签

#### TC-H-01 三级标题生成大纲层级（P0）

- **输入**：`examples/headings.md`（H1=4、H2=7、H3=14、H4=1）
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-H-01 -ErrorAction SilentlyContinue
docconvert examples/headings.md -o out/TC-H-01 --format docx
Copy-Item out/TC-H-01/headings.docx out/TC-H-01/check.zip -Force
Expand-Archive out/TC-H-01/check.zip -DestinationPath out/TC-H-01/unzip -Force
$xml = Get-Content out/TC-H-01/unzip/word/document.xml -Raw
"H1 via outlineLvl: " + ([regex]::Matches($xml, 'w:outlineLvl w:val="0"')).Count
"H2 via outlineLvl: " + ([regex]::Matches($xml, 'w:outlineLvl w:val="1"')).Count
"H3 via outlineLvl: " + ([regex]::Matches($xml, 'w:outlineLvl w:val="2"')).Count
"H1 via pStyle:   " + ([regex]::Matches($xml, 'w:pStyle w:val="Heading1"')).Count
"H2 via pStyle:   " + ([regex]::Matches($xml, 'w:pStyle w:val="Heading2"')).Count
"H3 via pStyle:   " + ([regex]::Matches($xml, 'w:pStyle w:val="Heading3"')).Count
```

- **期望（可判定）**：对每一级，`outlineLvl` 计数与 `pStyle` 计数**至少一者**等于 H1=4、H2=7、H3=14。两种实现都接受（样式名实现或以大纲级别实现），但同一级别不允许两者都为 0。
- **失败判据**：任一级别两种计数都为 0；或计数与实际标题数不符（多一个或少一个）；或 `word/document.xml` 不含 `w:outlineLvl` 且不含 `Heading` 样式引用。
- **视觉验收（P0 必做）**：

```powershell
docconvert examples/headings.md -o out/TC-H-01 --format pdf
node $KIT render --input out/TC-H-01/headings.pdf --output-dir out/TC-H-01/render --pages "1,2"
```

渲染第 1、2 页，看到以下三点算通过：① 一级标题（"城市湿地公园观测手册""第一章 湿地类型与分区"）字号明显大于正文，二级标题小于一级但大于正文；② 中文无方块、无空白洞；③ 同一级标题的字号/字重在页内一致（不存在"有的粗有的不粗"）。

- **关联失败模式**：看起来能跑但质量差；模板硬编码（层级写死导致换模板后失效）。
- **备注**：H4（"归档目录示例"）不参与 P0 断言；见 TC-H-03。

#### TC-H-02 PDF 书签包含标题层级（P0）

- **输入**：同 TC-H-01 产出的 `out/TC-H-01/headings.pdf`
- **命令**：

```powershell
$enc = [Text.Encoding]::GetEncoding(28591)
$s = $enc.GetString([IO.File]::ReadAllBytes("out/TC-H-01/headings.pdf"))
"has /Outlines: " + $s.Contains("/Outlines")
"bookmark count: " + ([regex]::Matches($s, '/Title<FEFF')).Count
```

> 说明：LibreOffice 导出的书签标题是 UTF-16BE 十六进制串（形如 `/Title<FEFF4E0030015F158A00>`），所以用 `/Title<FEFF` 作为书签计数锚点。该形态已在工作区既有 PDF（12 页、29 个书签）上实测确认。

- **期望**：`has /Outlines: True`；书签数 = H1–H6 = **26**（`bookmarkDepth=6`）；目录条目仍仅 H1–H3 = **25**。
- **失败判据**：`/Outlines` 不存在；书签数为 0；书签数明显少于标题数（例如只有 4，说明只导出了一级）；书签数与声明深度不符。
- **视觉验收（P0 必做）**：用 PDF 阅读器打开 `headings.pdf` 的书签面板，看到 4 个一级条目，其中"第一章…""第二章…""第三章…"各带若干二级条目，二级下再有三级的缩进条目，层级缩进可见即通过。若执行环境无 GUI 阅读器，改用渲染第 1 页 + 上述计数断言，并在 test-report 写明"书签面板未人工确认"。
- **关联失败模式**：看起来能跑但质量差；模板硬编码（标题样式未挂大纲级别）。
- **依赖**：书签是否由引擎自动生成，与 spike（t3，PDF TOC 页码验证）结论相关；若 t3 判定"引擎不生成书签"，本用例改判为"docx 中有大纲级别 + 文档声明书签能力不支持"，并升级为闸门 2 的阻塞问题。

#### TC-H-03 四级标题不破坏层级（P1）

- **输入**：`headings.md`（含 1 个 H4）
- **命令**：复用 TC-H-01 的 `out/TC-H-01/unzip`
- **期望**：H4 段落存在且被渲染为标题样式（字号 > 正文，或字重为粗体），且**新增**书签（`bookmarkDepth=6`，书签总数 26），但**不**进入目录（目录仍 25 条）。
- **失败判据**：H4 被渲染成正文（与相邻段落无可区分差异）；或 H4 导致书签数变成 26+ 且未在文档中声明深度 4。
- **视觉验收（P1 可选）**：渲染含"归档目录示例"的页，看该行是否加粗且比正文略大。
- **关联失败模式**：规范分裂（文档说支持 6 级，实现只到 3 级）。

### 4.2 ② 多列表格：样式、跨页表头重复

#### TC-TB-01 长表跨页后表头重复（P0）

- **输入**：`examples/table.md`（表 2 共 61 行：1 行表头 + 60 行数据，8 列）
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-TB-01 -ErrorAction SilentlyContinue
docconvert examples/table.md -o out/TC-TB-01 --format both
node $KIT render --input out/TC-TB-01/table.pdf --output-dir out/TC-TB-01/render --pages "2,3"
(Get-Content out/TC-TB-01/render/manifest.json -Raw | ConvertFrom-Json) | Select pageCount, missingFonts
```

- **期望（可判定）**：
  1. `pageCount >= 3`（表 2 必然跨页；若为 1–2 页，说明表格被压扁，直接失败）；
  2. docx 中表头行带重复表头标记：解压后 `word/document.xml` 含 `w:tblHeader`（计数 ≥ 2，对应两张表），且表 2 的行中含 `w:cantSplit`（行不跨页）；
  3. 渲染第 2 页（或表 2 的续页），**首行是表头**：序号｜观测日期｜样区｜时段｜天气｜物种｜数量｜备注。
- **失败判据**：续页首行是数据行（如"13｜2026-10-07｜A1｜…"）；`w:tblHeader` 计数为 0；表格行在同一页被截断成两半（半行文字在页底、半行在页首）；`missingFonts` 非空。
- **视觉验收（P0 必做）**：渲染表 2 的续页，看到表头行**原样重复**、字号与第一页表头一致、下方直接接数据行；表头单元格不换行成两行（列宽足够时）。若续页首行不是表头 ⇒ 失败。
- **关联失败模式**：表格跨页表头丢失；看起来能跑但质量差。

#### TC-TB-02 宽表列宽与内容不裁切（P0）

- **输入**：`examples/table.md` 表 1（8 列，含长表头"主要优势种""植被盖度（%）"）
- **命令**：复用 `out/TC-TB-01`，解析 docx 表格属性：

```powershell
Copy-Item out/TC-TB-01/table.docx out/TC-TB-01/check.zip -Force
Expand-Archive out/TC-TB-01/check.zip -DestinationPath out/TC-TB-01/unzip -Force
$xml = Get-Content out/TC-TB-01/unzip/word/document.xml -Raw
"tblHeader: " + ([regex]::Matches($xml, 'w:tblHeader')).Count
"cantSplit: " + ([regex]::Matches($xml, 'w:cantSplit')).Count
"tblW: " + ([regex]::Matches($xml, '<w:tblW w:w="(\d+)"')).Count
```

- **期望**：两张表都有固定布局（`w:tblLayout w:type="fixed"`，计数 ≥ 2）；表格总宽不超过版心（A4 宽 21 cm − 左右边距 4 cm = 17 cm ≈ 9639 twips；允许 ±5%）；表 1 的 6 行数据全部存在（文本可搜到"A1""C2"）。
- **失败判据**：表格使用自动布局（无 `tblLayout`）；表格宽度超过 10120 twips（17 cm 的 105%）；渲染第 1 页时最右列被页边距裁切（右侧文字断在页边距外）。
- **视觉验收（P0 必做）**：渲染第 1 页，看到 8 列完整显示、"主要优势种"列的文字（如"芦苇、菹草"）在单元格内换行而不是被裁掉、表格右边界在页边距以内。
- **关联失败模式**：只在开发者机器能跑（列宽按字体算，换机器就乱）；看起来能跑但质量差。

#### TC-TB-03 表格样式在 PDF 中保持（P1）

- **命令**：`node $KIT render --input out/TC-TB-01/table.pdf --output-dir out/TC-TB-01/render-style --pages "1"`
- **期望**：表头行有可辨识的底纹或加粗（与数据行视觉可区分）；表格单元格字号明显小于正文（约 8.5 pt vs 12 pt）；无竖线错位、无单元格文字压到边框上。
- **失败判据**：表头与数据行完全无视觉差异；单元格字号与正文相同导致列宽爆炸；文字与边框重叠。
- **关联失败模式**：看起来能跑但质量差。

### 4.3 ③ 代码块：等宽字体与长行换行

#### TC-CD-01 超长代码行不被裁切（P0）

- **输入**：`examples/code.md`（第 2 节超长单行 > 200 字符）
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-CD-01 -ErrorAction SilentlyContinue
docconvert examples/code.md -o out/TC-CD-01 --format both
node $KIT render --input out/TC-CD-01/code.pdf --output-dir out/TC-CD-01/render --pages "1,2"
```

- **期望**：超长行在页面内**换行显示**，其结尾片段 `photo: "20261018_A2_003.jpg" };` 完整可见；任何代码行都不越过正文右边界；页面右边缘 1 cm 内没有代码字符。
- **失败判据**：超长行被裁切（找不到结尾片段）；代码伸出页边距（渲染图上字符贴到页面边缘或落在页边距内）；代码块内出现横向滚动条痕迹（PDF 不该有）。
- **视觉验收（P0 必做）**：渲染含超长行的页，逐字符看结尾 `photo: "20261018_A2_003.jpg" };` 是否完整；再看整页右侧页边距是否干净（无字符侵入）。
- **关联失败模式**：看起来能跑但质量差（长行裁切是最典型的"跑通但不可用"）。

#### TC-CD-02 代码块使用等宽字体（P1）

- **命令**：解析 docx 样式与 PDF 字体：

```powershell
Copy-Item out/TC-CD-01/code.docx out/TC-CD-01/check.zip -Force
Expand-Archive out/TC-CD-01/check.zip -DestinationPath out/TC-CD-01/unzip -Force
Select-String -Path out/TC-CD-01/unzip/word/styles.xml -Pattern 'Consolas|Courier|Mono|Menlo' -AllMatches | Measure-Object
$enc = [Text.Encoding]::GetEncoding(28591)
$s = $enc.GetString([IO.File]::ReadAllBytes("out/TC-CD-01/code.pdf"))
([regex]::Matches($s, '/BaseFont/([^\s/<>\[\]]+)') | ForEach-Object { $_.Groups[1].Value }) | Sort-Object -Unique
```

- **期望**：`styles.xml` 中出现至少一个等宽字体族（Consolas/Courier/Mono/Menlo 任一）；PDF 字体表中出现同一族名（若被替换，需在 `--version` 中声明实际字体）。
- **失败判据**：代码块使用与正文相同的比例字体；PDF 字体表里找不到等宽族；中文字符在代码块中显示为方块。
- **视觉验收（P1）**：渲染代码页，看到缩进对齐成列（`const`、`for`、`if` 的缩进起点在同一条竖线上）；中文注释与英文代码基线齐平。
- **关联失败模式**：中文变方块；看起来能跑但质量差。

### 4.4 ④ 图片：相对路径与尺寸

#### TC-IM-01 相对路径图片可解析且按版心缩放（P0）

- **输入**：`examples/image.md` + `examples/assets/`（4 张图）
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-IM-01 -ErrorAction SilentlyContinue
docconvert examples/image.md -o out/TC-IM-01 --format both
Copy-Item out/TC-IM-01/image.docx out/TC-IM-01/check.zip -Force
Expand-Archive out/TC-IM-01/check.zip -DestinationPath out/TC-IM-01/unzip -Force
Get-ChildItem out/TC-IM-01/unzip/word/media | Select-Object Name, Length
$xml = Get-Content out/TC-IM-01/unzip/word/document.xml -Raw
([regex]::Matches($xml, '<wp:extent cx="(\d+)" cy="(\d+)"')) | ForEach-Object { $_.Groups[1].Value + " x " + $_.Groups[2].Value }
node $KIT render --input out/TC-IM-01/image.pdf --output-dir out/TC-IM-01/render --pages "1,2"
```

- **期望（可判定）**：
  1. `word/media` 下恰好 4 个图片部件（PNG 或转换后的等价格式）；
  2. 宽图（1200×400）的 `cx` ≤ **6,120,000 EMU**（17 cm 版心宽），且宽高比保持 3:1（±2%）；
  3. 高图（600×1800）的 `cy` ≤ **8,640,000 EMU**（24 cm 可用页高，留出页眉页脚余量），宽高比 1:3（±2%）；
  4. 小图（96×96）的 `cx` = 914,400 EMU（96 px @96 dpi = 1 in，允许 ±5%），**不被放大**。
- **失败判据**：`word/media` 少于 4 个（图片丢失）；任一 `cx` > 6,120,000 或 `cy` > 8,640,000（溢出页面）；宽高比偏离 > 2%（变形）；小图 `cx` 接近版心宽度（被强行放大）；命令行无警告却缺图。
- **视觉验收（P0 必做）**：渲染第 1、2 页：① 条形图完整显示、三个色块比例与源图一致（蓝:绿:橙 ≈ 340:280:300 px 宽度关系不乱）；② 图 1 的图注紧随图片下方；③ 图片右边缘在正文右边界以内，不压页边距。
- **关联失败模式**：只在开发者机器能跑（按 CWD 解析路径）；看起来能跑但质量差（图片溢出/变形）。

#### TC-IM-02 高图不跨页断裂（P1）

- **命令**：`node $KIT render --input out/TC-IM-01/image.pdf --output-dir out/TC-IM-01/render-tall --pages "2,3"`
- **期望**：竖版生境图完整出现在**同一页**内，上下边界均在页内，图上方的标题"图 2"与图在同一页。
- **失败判据**：图片被切成两页（上一页只有上半部分）；图片被裁掉底部；图注跑到上一页与图分离。
- **视觉验收（P1）**：找到竖图所在页，确认图上、下都留白、图注在图下方同一页。
- **关联失败模式**：看起来能跑但质量差。

#### TC-IM-03 图片缺失时明确警告且不中断（P1）

- **准备**：临时把 `examples/assets/icon-dot.png` 改名（**执行后必须改回**）：

```powershell
Rename-Item examples/assets/icon-dot.png icon-dot.png.bak
try {
  Remove-Item -Recurse -Force out/TC-IM-03 -ErrorAction SilentlyContinue
  docconvert examples/image.md -o out/TC-IM-03 --format both 2> out/TC-IM-03.err
  "exit=$LASTEXITCODE"
  Get-Content out/TC-IM-03.err
} finally {
  Rename-Item examples/assets/icon-dot.png.bak icon-dot.png
}
```

- **期望**：进程以 0 退出（缺图不阻塞转换），stderr 出现一条警告，包含缺失文件名 `icon-dot.png` 与相对路径 `assets/icon-dot.png`；其余三张图正常。
- **失败判据**：直接崩溃；静默跳过且无任何提示；因为一张图缺失导致整个转换失败。
- **关联失败模式**：静默降级；批量一失败全中断。
- **备注**：requirements 已定稿为**降级告警**（`image-degraded`，退出码 0，REQ-ELEM-28），不存在硬失败分支。断言追加：日志 `warnings` 中含 `image-degraded` 且 `code`/`line` 字段齐全。

### 4.5 ⑤ 中英混排与中文标点

#### TC-CJ-01 中文无方块、中西文基线对齐（P0）

- **输入**：`examples/cjk.md`
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-CJ-01 -ErrorAction SilentlyContinue
docconvert examples/cjk.md -o out/TC-CJ-01 --format both
node $KIT render --input out/TC-CJ-01/cjk.pdf --output-dir out/TC-CJ-01/render --pages "1,2,3"
(Get-Content out/TC-CJ-01/render/manifest.json -Raw | ConvertFrom-Json) | Select pageCount, missingFonts
$enc = [Text.Encoding]::GetEncoding(28591)
$s = $enc.GetString([IO.File]::ReadAllBytes("out/TC-CJ-01/cjk.pdf"))
([regex]::Matches($s, '/BaseFont/([^\s/<>\[\]]+)') | ForEach-Object { $_.Groups[1].Value }) | Sort-Object -Unique
```

- **期望（可判定）**：
  1. `missingFonts` 为空数组；
  2. PDF 字体表中至少有一个中文字体（名字含 SimSun / SimHei / YaHei / KaiTi / Noto / SourceHan / PingFang 任一）；
  3. 渲染图中**没有** U+FFFD 替换字符、方块或空白洞（逐页看中文正文区域）；
  4. 英文术语（`UTF-8`、`Calibri`、`Ardeidae`）与相邻中文处于同一基线：英文单词的下缘与中文下缘偏差不超过正文行高的 1/4。
- **失败判据**：`missingFonts` 非空；字体表中无中文字体；任一页出现方块/空白洞；英文明显下沉或上浮（肉眼可见 > 半个字高）；标点被渲染成半角（例如中文逗号显示为 `,` 且后无间隔）。
- **视觉验收（P0 必做）**：渲染第 1、2 页，看到：① "观测记录统一使用 UTF-8 编码" 一行中英文高度一致；② 全角标点（，。、）与汉字等宽、无额外空隙；③ 引用块（第 2 页）左边框竖直、文字不压框线。
- **关联失败模式**：中文变方块；规范分裂（字体在配置里是一套、导出是另一套）。

#### TC-CJ-02 中文标点避头尾与长词断行（P1）

- **期望**：逐页检查行首字符，**不允许**出现行首为"。"、"，"、"、"、"："、"？"、"！"的行（避头尾生效）；长英文词（`pseudopseudohypoparathyroidism` 等）在行尾完整换行，不被从中间截断成两行而无连字符。
- **失败判据**：出现行首标点；长英文词被硬切成两段且不加连字符；长链接导致整行溢出页边距。
- **视觉验收（P1）**：渲染第 3 页，看到"省略号使用……"与"破折号使用——"两行的省略号/破折号占满两个汉字宽度，不被压缩成一个字符。
- **关联失败模式**：看起来能跑但质量差。

### 4.6 ⑥ 50 页以上长文档：TOC 页码与性能

#### TC-LG-01 长文档页数与目录页码（P0）

- **输入**：`examples/long-50.md`（46,978 字符、134 个标题、316 行表格）
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-LG-01 -ErrorAction SilentlyContinue
$sw = [Diagnostics.Stopwatch]::StartNew()
docconvert examples/long-50.md -o out/TC-LG-01 --format both
$sw.Stop(); "elapsed_s=" + [math]::Round($sw.Elapsed.TotalSeconds, 1)
node $KIT render --input out/TC-LG-01/long.pdf --output-dir out/TC-LG-01/render --pages "1,2"
(Get-Content out/TC-LG-01/render/manifest.json -Raw | ConvertFrom-Json) | Select pageCount, missingFonts
$enc = [Text.Encoding]::GetEncoding(28591)
$s = $enc.GetString([IO.File]::ReadAllBytes("out/TC-LG-01/long.pdf"))
"bookmarks: " + ([regex]::Matches($s, '/Title<FEFF')).Count
```

- **期望（可判定）**：
  1. `pageCount >= 50`（硬指标）；
  2. `elapsed_s <= 180`（docx+pdf 总耗时；**待需求定稿**，若实现阶段实测偏高，由技术负责人调整阈值并记录，不允许执行者私下放宽）；
  3. 书签数 ≥ 100（134 个标题中深度 3 的部分；至少应远大于 50，证明长文档未退化为纯文本）；
  4. 目录页存在且页码列非空（见下条视觉验收）。
- **失败判据**：页数 < 50（要么模板太挤，要么长文档被截断）；耗时 > 180 s；内存溢出/中途崩溃；书签数 < 50。
- **视觉验收（P0 必做）**：渲染第 1 页（目录页）：
  - 看到"目录"标题，其下是条目列表（一级条目顶格、二级缩进）；
  - 每个条目**右侧有页码数字**（不是空白、不是全部为 1）；
  - 目录条目数量与文档结构相符（一级条目 ≥ 28 个，含"第一章…"到"第十章…"与附录 A–I）；
  - 若目录跨页，续页仍有页码列。
- **依赖**：目录页码能否由引擎在导出时更新，取决于 spike（t3）结论。若 t3 判定"引擎不更新域"，则本用例的页码断言降级为"docx 中有 TOC 域 + 文档明确声明页码需在 Word 中更新"，并作为闸门 2 的已知限制记录，不得静默放过。
- **关联失败模式**：看起来能跑但质量差；缺 TeX 类依赖（若选择需外部排版引擎的路线则长文档直接不可用）。

#### TC-LG-02 长文档样式不漂移（P1）

- **命令**：在 `out/TC-LG-01/render` 之上，额外渲染末页：`node $KIT render --input out/TC-LG-01/long.pdf --output-dir out/TC-LG-01/render-last --pages "60"`（若总页数不足 60，用实际末页号）
- **期望**：第 1 页与末页的正文样式一致：正文字号、行距、页边距相同；标题层级在同级别内字号一致；页脚页码连续（末页页码 = pageCount）。
- **失败判据**：出现过"后半部分字号变小/行距变窄"（常见于手工分节）；页码重置或跳号；末页缺少页脚。
- **视觉验收（P1）**：对比第 1 页与末页的正文段落高度，肉眼一致即可。
- **关联失败模式**：看起来能跑但质量差；规范分裂。

### 4.7 ⑦ .txt 输入：结构化合理性

#### TC-TX-01 无结构文本的合理结构化（P0）

- **输入**：`examples/notes.txt`（首行标题 + 5 个中文序号小节 + 4 个无序项 + 4 个有序项）
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-TX-01 -ErrorAction SilentlyContinue
docconvert examples/notes.txt -o out/TC-TX-01 --format both
Copy-Item out/TC-TX-01/notes.docx out/TC-TX-01/check.zip -Force
Expand-Archive out/TC-TX-01/check.zip -DestinationPath out/TC-TX-01/unzip -Force
$xml = Get-Content out/TC-TX-01/unzip/word/document.xml -Raw
"H1: " + ([regex]::Matches($xml, 'w:outlineLvl w:val="0"')).Count
"numPr(list items): " + ([regex]::Matches($xml, '<w:numPr>')).Count
"paragraphs: " + ([regex]::Matches($xml, '<w:p[ >]')).Count
```

- **期望（可判定）**：
  1. 首行"城市湿地公园志愿者例会纪要"成为文档标题（H1 或 Title 样式，计数 ≥ 1）；
  2. 正文段落数 ≥ 10（空行分段生效，不允许整篇变成一段）；
  3. 列表项被识别为列表（`numPr` 计数 ≥ 8，对应 4 个无序项 + 4 个有序项）；
  4. "一、上季度观测小结"等中文序号小节**不被**误判为标题（除非需求明确要求识别），即 H1 计数应为 1；
  5. 页数 2–4 页。
- **失败判据**：全文只有 1 个段落（空行未生效）；列表被渲染成普通段落（`numPr`=0）；中文序号被误判成标题（H1 > 1）且文档未声明该规则；首行标题丢失；乱码/方块。
- **视觉验收（P0 必做）**：渲染第 1、2 页：① 标题字号明显大于正文且居中或左对齐一致；② "二、存在的问题"下的 4 条以项目符号呈现（圆点或短横），左缩进一致；③ "三、下季度安排"下的 4 条以数字编号呈现；④ 中文无方块。
- **关联失败模式**：规范分裂（.txt 规则未文档化）；看起来能跑但质量差。

#### TC-TX-02 关闭首行标题（N/A）

- **状态**：v1 **不提供**关闭标题的开关（REQ-CLI-003 禁止覆盖类参数）。
- **原断言去向**：首行标题的识别由 TC-TX-01 断言；.txt 三示例逐字一致由 TC-TX-04 断言。
- **若将来新增该能力**：本用例恢复为 P1，命令形态待需求定稿后补。

### 4.8 ⑧ 错误输入：信息可操作

> 通用判定：**退出码按 requirements §7.2 的具体码（2/3/4/5）+ stderr 含「发生了什么 + 该怎么办」+ 不留残缺产物**。场景准备步骤见 `examples/errors/README.md`。

#### TC-ER-01 输入文件不存在（P0）

- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-ER-01 -ErrorAction SilentlyContinue
docconvert examples/errors/does-not-exist.md -o out/TC-ER-01 2> out/TC-ER-01.err
"exit=$LASTEXITCODE"
Get-Content out/TC-ER-01.err
Get-ChildItem out/TC-ER-01 -ErrorAction SilentlyContinue
```

- **期望**：退出码 **3**（`input-not-found`）；stderr 为 `ERROR input-not-found: <说明>` + 一行 `hint:`（含"检查路径拼写"或"路径含空格时加引号"）；`out/TC-ER-01` 为空或不存在。
- **结构断言**：`SELECT ERROR 行数 = 1`、`hint 行数 = 1`、无 `    at ` 堆栈行。
- **失败判据**：退出码 0；打印 Node 堆栈而不给人类可读信息；只写"Error: ENOENT"这类原始系统错误；留下 0 字节的 .docx/.pdf。
- **关联失败模式**：看起来能跑但质量差（错误不可操作）。

#### TC-ER-02 输出目录不可写（P0，ACL 或 EPERM 均可触发）

- **命令**（准备与清理见 `examples/errors/README.md` E2）：

```powershell
New-Item -ItemType Directory -Force out/TC-ER-02 | Out-Null
icacls out/TC-ER-02 /deny "$($env:USERNAME):(OI)(CI)(W)" | Out-Null
try {
  docconvert examples/errors/readonly-target.md -o out/TC-ER-02 2> out/TC-ER-02.err
  "exit=$LASTEXITCODE"
  Get-Content out/TC-ER-02.err
  Get-ChildItem out/TC-ER-02
} finally {
  icacls out/TC-ER-02 /remove:d "$env:USERNAME" | Out-Null
}
```

- **权限来源**：`output-not-writable` 的触发源可以是 OS ACL（真实只读目录），也可以是沙箱/受限环境抛出的 `EPERM`/`EACCES`。二者都必须映射到同一个 `exit 4 + errorCode=output-not-writable`。
- **本环境备选验证（DSH 沙箱下 icacls 改 DACL 会失败，改用不可创建的目标路径）**：

```powershell
# 父目录为系统保护目录，任何进程都无法在其下创建 docconvert-should-fail/
docconvert examples/errors/readonly-target.md -o "C:\Windows\System32\docconvert-should-fail"
"exit=$LASTEXITCODE"
```

- **期望**：退出码 **4**；stderr 指出"无法写入/无法创建输出目录"并给出绝对路径；不产生 0 字节产物；不得自动改写到其它目录。日志 `errorCode` 必须是 `output-not-writable`（requirements §9.1 已登记，环境类 / 4）。
- **失败判据**：退出码 0；静默换目录；崩溃堆栈；留下半成品文件；errorCode ≠ `output-not-writable`。
- **关联失败模式**：只在开发者机器能跑；静默降级。

#### TC-ER-03 空输入文件（P1）

- **命令**：`docconvert examples/errors/empty.md -o out/TC-ER-03`（先清理目录）
- **期望**：退出码 **3**（`empty-input`），**不产出任何文件**（requirements §9.1 与 REQ-IN-003 写死；v1 不提供"空文件产出空文档"的分支）。stderr 为 `ERROR empty-input: …` + 一行 `hint:`。
- **失败判据**：崩溃；产出 0 字节文件；退出码 0 且无任何提示、产物无法打开。
- **关联失败模式**：看起来能跑但质量差；静默降级。

#### TC-ER-04 扩展名不受支持（P1）

- **命令**：`docconvert examples/errors/unsupported.txt.bin -o out/TC-ER-04`
- **期望**：退出码 **3**（`unsupported-extension`）；stderr 为 `ERROR unsupported-extension: …` + `hint: 支持：.md .txt`，并列出实际扩展名 `.bin`。
- **失败判据**：尝试按文本解析并产出乱码文档；错误信息不含支持的格式列表。
- **关联失败模式**：看起来能跑但质量差。

#### TC-ER-05 输出路径被文件占用（P2）

- **命令**：

```powershell
Set-Content out/TC-ER-05 -Value "occupied"
docconvert examples/headings.md -o out/TC-ER-05
"exit=$LASTEXITCODE"
Get-Content out/TC-ER-05
```

- **期望**：退出码 **2**（`usage-error`：`-o` 指向已存在文件）；文件内容仍为 `occupied`（未被覆盖）。
- **失败判据**：覆盖了文件；或静默改写到别处。
- **关联失败模式**：覆盖源文件。

#### TC-ER-06 模板覆盖参数被拒绝（N/A，改由 TC-CLI-01 断言）

- **状态**：v1 不存在模板覆盖入口（REQ-CLI-003、REQ-TPL-001）。
- **断言去向**：传入所有被禁的覆盖类参数 → `usage-error`（2），见 TC-CLI-01；模板来源唯一性见 TC-CF-01。

#### TC-ER-07 输出不得覆盖输入（P1）

- **命令**：

```powershell
$before = (Get-FileHash examples/headings.md -Algorithm SHA256).Hash
docconvert examples/headings.md -o examples/headings.md
"exit=$LASTEXITCODE"
$after = (Get-FileHash examples/headings.md -Algorithm SHA256).Hash
"unchanged=" + ($before -eq $after)
```

- **期望**：退出码 **2**（`usage-error`：`-o` 指向已存在的文件，requirements §7.2 参数错误；实测即返回 `ERROR usage-error: -o 指向的文件已存在，不是目录`）；`unchanged=True`；outdir 内零产物。
- **口径说明**：虽然本场景的输出路径恰等于输入文件，CLI 仍按「`-o` 不是目录」归类为 `usage-error`（2），而不是 `output-conflict`（后者用于多个输入映射到同一输出）。断言只认「exit=2 + 源文件哈希不变」。
- **失败判据**：源文件被改写/删除（`unchanged=False`）；退出码 0；errorCode 既不是 `usage-error` 也不是 `output-conflict`。
- **关联失败模式**：覆盖源文件。

### 4.9 ⑨ 复用一致性：新入口 vs 直接 dsoffice

#### TC-RU-01 同一 DOCX 的两条 PDF 路径结构一致（P1）

- **目的**：证明 docconvert 没有偷偷做"第二次排版"，PDF 与"直接拿它的 docx 交给 dsoffice"结果一致。
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-RU-01 -ErrorAction SilentlyContinue
docconvert examples/cjk.md -o out/TC-RU-01 --format docx
node $KIT convert --input out/TC-RU-01/cjk.docx --output out/TC-RU-01/direct.pdf
docconvert examples/cjk.md -o out/TC-RU-01 --format pdf
node $KIT render --input out/TC-RU-01/direct.pdf --output-dir out/TC-RU-01/render-direct
node $KIT render --input out/TC-RU-01/cjk.pdf   --output-dir out/TC-RU-01/render-app
$a = Get-Content out/TC-RU-01/render-direct/manifest.json -Raw | ConvertFrom-Json
$b = Get-Content out/TC-RU-01/render-app/manifest.json -Raw | ConvertFrom-Json
"pages direct=" + $a.pageCount + " app=" + $b.pageCount
$enc = [Text.Encoding]::GetEncoding(28591)
$sd = $enc.GetString([IO.File]::ReadAllBytes("out/TC-RU-01/direct.pdf"))
$sa = $enc.GetString([IO.File]::ReadAllBytes("out/TC-RU-01/cjk.pdf"))
"bookmarks direct=" + ([regex]::Matches($sd, '/Title<FEFF')).Count + " app=" + ([regex]::Matches($sa, '/Title<FEFF')).Count
$fd = ([regex]::Matches($sd, '/BaseFont/([^\s/<>\[\]]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique) -join ","
$fa = ([regex]::Matches($sa, '/BaseFont/([^\s/<>\[\]]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique) -join ","
"fonts equal=" + ($fd -eq $fa); "fonts=" + $fa
```

- **期望**：页数相等、书签数相等、字体集合相等（三者全同）。
- **失败判据**：任一不等；或 docconvert 的 PDF 不是由同一份 docx 导出（例如页数差 1 页以上）。
- **关联失败模式**：重复造轮子（自造 PDF 管线）；规范分裂（两条路径两套排版）。
- **备注**：这是"复用优先"的可判定证据，属技术负责人裁决 ① 的验收。

#### TC-RU-02 字体与页数不因入口而异（P1）

- **命令**：把 `TC-RU-01` 的两份 PDF 各渲染第 1 页，比较：

```powershell
node $KIT render --input out/TC-RU-01/direct.pdf --output-dir out/TC-RU-01/png-direct --pages "1"
node $KIT render --input out/TC-RU-01/cjk.pdf    --output-dir out/TC-RU-01/png-app --pages "1"
Get-FileHash out/TC-RU-01/png-direct/*.png -Algorithm SHA256
Get-FileHash out/TC-RU-01/png-app/*.png -Algorithm SHA256
```

- **期望**：两张 PNG 的 SHA-256 **相同**（同一份 docx 经同一引擎渲染应像素一致）；若因元数据导致 PDF 字节不同但渲染一致，哈希相同正好证明"版式级可复现"。
- **失败判据**：哈希不同（说明两条路径的版式真的不同）。
- **关联失败模式**：规范分裂；只在开发者机器能跑。

### 4.10 ⑩ 模板冲突：只认内置 reference.docx

#### TC-CF-01 干扰模板不被采纳（P1）

- **输入**：`examples/conflict/`（含 `reference.docx` 与 `templates/reference.docx` 两份干扰副本）
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-CF-01 -ErrorAction SilentlyContinue
Push-Location examples/conflict
try {
  docconvert headings.md -o ../../out/TC-CF-01/local --format docx
} finally { Pop-Location }
Remove-Item -Recurse -Force out/TC-CF-01/root -ErrorAction SilentlyContinue
docconvert examples/headings.md -o out/TC-CF-01/root --format docx

# 比较两次产出的样式表（模板相同 ⇒ styles.xml 逐字节相同）
Copy-Item out/TC-CF-01/local/headings.docx out/TC-CF-01/local.zip -Force
Copy-Item out/TC-CF-01/root/headings.docx  out/TC-CF-01/root.zip  -Force
Expand-Archive out/TC-CF-01/local.zip -DestinationPath out/TC-CF-01/local-unzip -Force
Expand-Archive out/TC-CF-01/root.zip  -DestinationPath out/TC-CF-01/root-unzip  -Force
Get-FileHash out/TC-CF-01/local-unzip/word/styles.xml -Algorithm SHA256
Get-FileHash out/TC-CF-01/root-unzip/word/styles.xml  -Algorithm SHA256
```

- **期望**：两次 `styles.xml` 的 SHA-256 相同；stderr 若提示"检测到同名模板"，必须写明已忽略的路径；不得出现"使用 examples/conflict/reference.docx"。
- **失败判据**：两份 styles.xml 哈希不同（说明工作目录里的干扰模板被采纳）；程序静默使用干扰模板；因同名文件而报错退出。
- **关联失败模式**：模板硬编码（按 CWD 搜索模板）；只在开发者机器能跑（路径依赖）。
- **备注**：干扰文件是《钓鱼鱼类调查报告.docx》的两份副本，格式与内置模板不同，采纳后会立刻改变标题字号与表格样式，因此差异可判定。

#### TC-CF-02 内置模板来源可追溯（P2）

- **命令**：`docconvert --version` 与 `Get-FileHash templates/reference.docx -Algorithm SHA256`
- **期望**：`--version` 输出里包含内置模板的路径与 SHA-256，且与文件实际哈希一致；路径指向项目内 `templates/reference.docx`。
- **失败判据**：版本清单缺少模板信息；或路径指向工作目录/用户目录。
- **关联失败模式**：只在开发者机器能跑；规范分裂。

### 4.11 ⑪ 缺依赖：必须明确报错，不静默降级

#### TC-DP-01 PDF 引擎缺失时明确失败（P0）

- **准备**（二选一，优先 A；两者都必须可回滚）：

**方式 A（推荐）**：若程序支持环境变量指定引擎路径（参数名待需求定稿，例如 `DOCONVERT_LIBREOFFICE_KIT`），指向一个不存在的路径：

```powershell
$env:DOCONVERT_LIBREOFFICE_KIT = "C:\no\such\dsoffice.js"
try { docconvert examples/headings.md -o out/TC-DP-01 --format pdf } finally { Remove-Item Env:DOCONVERT_LIBREOFFICE_KIT }
```

**方式 B（兜底）**：临时改名项目内的引擎目录，**必须**在 finally 中恢复：

```powershell
$kitDir = "node_modules\@deepseek-ai\libreoffice-kit"
if (Test-Path $kitDir) {
  Rename-Item $kitDir "libreoffice-kit.hidden"
  try {
    docconvert examples/headings.md -o out/TC-DP-01 --format pdf 2> out/TC-DP-01.err
    "exit=$LASTEXITCODE"; Get-Content out/TC-DP-01.err
  } finally {
    Rename-Item "node_modules\@deepseek-ai\libreoffice-kit.hidden" "libreoffice-kit"
  }
} else { "SKIP: 项目内无引擎目录，改用方式 A 或确认安装方式后重跑" }
```

- **期望**：退出码 **4**（`pdf-engine-missing`）；stderr 为 `ERROR pdf-engine-missing: …` + 一行 `hint:`（安装 `@deepseek-ai/libreoffice-kit@0.1.5`、检查 `DOCONVERT_LIBREOFFICE_KIT`、或改用 `--format docx`）；不得产出 0 字节 PDF；不得以退出码 0 结束。
- **失败判据**：退出码 0（静默降级）；只产 docx 却说成功；堆栈直出无人类可读信息；`out/TC-DP-01` 里出现损坏的 PDF。
- **关联失败模式**：缺 TeX 类依赖（引擎缺失）；静默降级；看起来能跑但质量差。

#### TC-DP-02 依赖缺失只影响 PDF，不影响 DOCX（P1）

- **准备**：同 TC-DP-01 方式 B
- **命令**：`docconvert examples/headings.md -o out/TC-DP-02 --format docx`
- **期望**：`--format docx` 下退出码 **0**，docx 正常产出（引擎与 PDF 无关，预检不得因引擎缺失而失败）；stderr 无 `pdf-engine-missing`。
- **反向断言**：同环境下改跑 `--format both` → 退出码 **4**，零产物（预检先于写文件）。
- **失败判据**：docx 也失败（把可选能力做成了硬依赖）；或没有任何提示。
- **关联失败模式**：静默降级；批量一失败全中断（若默认 `--format both` 时）。
- **备注**：与 TC-DP-01 的期望必须一致：**请求了 pdf 却没给 pdf ⇒ 失败**；**没请求 pdf ⇒ 成功**。

### 4.12 附加用例（不属于 11 类，但直接对应技术负责人裁决与失败模式）

#### TC-RP-01 DOCX 字节级可复现（P0，对应裁决 ④）

- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-RP-01 -ErrorAction SilentlyContinue
docconvert examples/headings.md -o out/TC-RP-01/a --format docx
Start-Sleep -Seconds 2
docconvert examples/headings.md -o out/TC-RP-01/b --format docx
(Get-FileHash out/TC-RP-01/a/headings.docx -Algorithm SHA256).Hash
(Get-FileHash out/TC-RP-01/b/headings.docx -Algorithm SHA256).Hash
```

- **期望**：两个哈希**相同**（间隔 2 秒执行，排除时间戳巧合）。
- **失败判据**：哈希不同。若不同，进一步解压比对 `docProps/core.xml`（`dcterms:created`/`dcterms:modified`）与 ZIP 条目时间戳，把差异位置写进 test-report。
- **关联失败模式**：可复现性缺失（裁决 ④ 的核心承诺）。

#### TC-RP-02 PDF 版式级可复现（P1，对应裁决 ④）

- **命令**：对 `out/TC-RP-01/a`、`b` 中的 PDF（若存在）各渲染第 1 页并比较哈希；同时比较两次 PDF 的页数与书签数。
- **期望**：渲染 PNG 哈希相同；页数、书签数相同；**不要求** PDF 字节哈希相同。
- **失败判据**：渲染像素不同；页数/书签数不同。
- **关联失败模式**：看起来能跑但质量差。

#### TC-BT-01 批量模式单点失败不中断（P1，对应"批量一失败全中断"）

- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-BT-01 -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force out/TC-BT-01-input | Out-Null
Copy-Item examples/headings.md, examples/table.md out/TC-BT-01-input
Set-Content out/TC-BT-01-input/broken.md -Value "<!-- 占位：此文件故意为空 -->"
Clear-Content out/TC-BT-01-input/broken.md
docconvert out/TC-BT-01-input -o out/TC-BT-01 --format docx
"exit=$LASTEXITCODE"
Get-ChildItem out/TC-BT-01
```

- **期望**：按 REQ-BATCH-003 默认**快速失败**（无 `--continue-on-error`）：退出码 **3**（首个失败文件 `broken.md` 的类别码 `empty-input`）；已成功的产物保留；后续文件记 `skipped`；日志出现 `status:skipped`。
- **对照跑**：加 `--continue-on-error` 后仍是退出码 **3**，但全部文件处理完，`SUMMARY total=3 ok=2 failed=1 skipped=0`，`FAILED:` 行含 `broken.md`。
- **失败判据**：遇到空文件立刻停止，后续文件未产出；或退出码 0 却漏产。
- **关联失败模式**：批量一失败全中断。
- **备注**：批量入口形态（目录参数 vs 通配符）待需求定稿。

#### TC-CL-01 干净环境可运行（P2，对应"只在开发者机器能跑"）

- **命令**：在 `$env:TEMP` 下新建空目录，把项目复制过去（不含 node_modules），按 README 的安装步骤装依赖后跑一条用例。
- **期望**：按 README 步骤能跑通；失败时错误信息指出缺什么、怎么装。
- **失败判据**：依赖本机缓存路径（如 DSH npx 缓存）而未声明；README 步骤缺失。
- **关联失败模式**：只在开发者机器能跑；依赖冲突。


#### TC-LONG-TOC-CONV 长文档 TOC 页码收敛（P0，技术负责人 2026-10-22 增补）

- **输入**：`examples/long-50.md`（46,978 字符；H1=28、H2=101、H3=5，**H1–H3 合计 134**；316 行表格；估算 52–56 页，硬指标 ≥50 页）
- **目的**：证明目录页码不是写死的 1 或占位符，而是与正文实际页码逐条一致，且重复运行稳定。
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TOC-CONV -ErrorAction SilentlyContinue
$sw = [Diagnostics.Stopwatch]::StartNew()
docconvert examples/long-50.md -o out/TOC-CONV/run1          # 默认双格式
$sw.Stop(); "run1_s=" + [math]::Round($sw.Elapsed.TotalSeconds,1)
$sw2 = [Diagnostics.Stopwatch]::StartNew()
docconvert examples/long-50.md -o out/TOC-CONV/run2
$sw2.Stop(); "run2_s=" + [math]::Round($sw2.Elapsed.TotalSeconds,1)

node $KIT render --input out/TOC-CONV/run1/long-50.pdf --output-dir out/TOC-CONV/render1
(Get-Content out/TOC-CONV/render1/manifest.json -Raw | ConvertFrom-Json) | Select pageCount, missingFonts

# 用 kit 自带的 docx → txt 导出取目录文本（capabilities 已声明支持）
node $KIT convert --input out/TOC-CONV/run1/long-50.docx --output out/TOC-CONV/run1.txt
node $KIT convert --input out/TOC-CONV/run2/long-50.docx --output out/TOC-CONV/run2.txt
```

- **提取与比对**（把下面整段存成 `out/TOC-CONV/check.ps1` 后执行，或逐段粘贴）：

```powershell
function Get-TocMap([string]$txtPath) {
  $pages = (Get-Content $txtPath -Raw) -split "`f"
  $toc = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $pages.Count; $i++) {
    foreach ($line in ($pages[$i] -split "\r?\n")) {
      if ($line -match '^(?<title>[^\s].*?)[\.\s]{2,}(?<page>\d+)\s*$') {
        [void]$toc.Add([pscustomobject]@{ title = $Matches['title'].Trim(); page = [int]$Matches['page']; tocPage = $i + 1 })
      }
    }
  }
  return [pscustomobject]@{ pages = $pages; toc = $toc }
}

$m1 = Get-TocMap out/TOC-CONV/run1.txt
$m2 = Get-TocMap out/TOC-CONV/run2.txt
"txt_pages=" + $m1.pages.Count
"toc_entries=" + $m1.toc.Count
$m1.toc | Select-Object -First 5

# 逐条核对：目录页码应等于该标题在正文中首次出现的页（跳过目录页自身）
$tocPages = $m1.toc | ForEach-Object { $_.tocPage } | Sort-Object -Unique
$bad = 0
foreach ($e in $m1.toc) {
  $actual = -1
  for ($p = 0; $p -lt $m1.pages.Count; $p++) {
    if (($p + 1) -in $tocPages) { continue }
    if ($m1.pages[$p].Contains($e.title)) { $actual = $p + 1; break }
  }
  if ($actual -ne $e.page) { $bad++; "MISMATCH: " + $e.title + " toc=" + $e.page + " actual=" + $actual }
}
"mismatch_count=" + $bad
"toc_page_span=" + $tocPages.Count

# 两次运行的目录表是否逐条一致
$diff = Compare-Object ($m1.toc | ForEach-Object { $_.title + "@" + $_.page }) ($m2.toc | ForEach-Object { $_.title + "@" + $_.page })
"run_diff_count=" + @($diff).Count
```

- **验收（七条，全过才算通过）**：

| # | 判据 | 期望 | 依据 |
| --- | --- | --- | --- |
| ① | PDF 页数 | `pageCount >= 50` | render manifest |
| ② | 目录条目数 | `toc_entries = 134`（= H1 28 + H2 101 + H3 5；若实现声明目录深度不同，按声明值且写进文档） | `$m1.toc.Count` |
| ③ | 页码偏差 | `mismatch_count = 0`（逐条：目录页码 = 正文中该标题首次出现的页） | 上面的循环 |
| ④ | 重复运行一致 | `run_diff_count = 0` | Compare-Object |
| ⑤ | 目录跨页 | `toc_page_span >= 2`（目录占 ≥2 页仍正确） | `$tocPages.Count` |
| ⑥ | 两遍法开销 | 若实现采用「转换 → 刷新域 → 再导出」，总耗时 ≤ 2 × 单遍基线 | `run1_s`、`run2_s` 与基线 |
| ⑦ | 降级必须显式 | 无法计算页码（占位/空页码）时必须 stderr 警告，且**本用例判失败** | stderr + 页码为 0/空 |

---

#### TC-TOC-DEGRADED 引擎缺失时长文 TOC 显式降级（P1）

- **输入**：`examples/long-50.md`（134 个 H1–H3 标题：H1=28 / H2=101 / H3=5，C-PDF-04 实测）
- **命令**：

```powershell
Remove-Item -Recurse -Force out/TC-TOC-DEGRADED -ErrorAction SilentlyContinue
$env:DOCONVERT_LIBREOFFICE_KIT = "C:\no\such\kit"
try {
  docconvert examples/long-50.md -o out/TC-TOC-DEGRADED --format docx 2> out/TC-TOC-DEGRADED.err
  "exit=$LASTEXITCODE"
  Get-Content out/TC-TOC-DEGRADED.err
  Test-Path out/TC-TOC-DEGRADED/long-50.docx
} finally { Remove-Item Env:DOCONVERT_LIBREOFFICE_KIT }

Copy-Item out/TC-TOC-DEGRADED/long-50.docx out/TC-TOC-DEGRADED/check.zip -Force
Expand-Archive out/TC-TOC-DEGRADED/check.zip -DestinationPath out/TC-TOC-DEGRADED/unzip -Force
$xml = Get-Content out/TC-TOC-DEGRADED/unzip/word/document.xml -Raw
"placeholder_dashes=" + ([regex]::Matches($xml, '——')).Count
"bookmarks=" + ([regex]::Matches($xml, 'w:bookmarkStart')).Count
"updateFields=" + ([regex]::Matches($xml, 'w:updateFields')).Count
```

- **期望（7 条全过）**：
  1. `exit=0`（REQ-TOC-003 降级分支；不得返回 `pdf-engine-missing`——该码只在 `--format` 含 pdf 时适用）；
  2. `out/TC-TOC-DEGRADED/long-50.docx` 存在且可解压；
  3. **目录条目完整**：占位符 `——`（两个全角破折号，C-PDF-01 裁决）计数 = 134，且 `bookmarks ≥ 134`；
  4. **页码为占位符**：目录区不出现数字页码（抽查 3 条：条目行末尾为 `——`）；
  5. `updateFields` 计数 = 0（打开不弹窗，REQ-TOC-010）；
  6. stderr 恰有 1 条 `WARN toc-degraded: PDF 引擎不可用，目录页码以占位符显示（见 README 已知限制）`；除该行外 stderr 无其它 WARN/ERROR；摘要输出只允许 `OK/FAIL/SKIP/SUMMARY` 四类行（D-001）；
  7. 日志 `toc.mode="degraded"`、`toc.converged=false`、`pdfKit=null`、`status="ok"`；`--version` 仍报 `toc: two-pass`。
- **失败判据**：退出码非 0；无 docx；目录缺失或条目数 ≠ 134；页码出现数字或空白；无警告；日志 toc 仍写 two-pass/converged=true；出现弹窗或阻塞等待输入。
- **视觉验收（P1 可选）**：引擎正是缺失项，无法 render；改为解压检查 TOC 段落文本，第一条应形如 `第一章 文档转换的基本模型………——`。
- **关联失败模式**：静默降级；看起来能跑但质量差。

### 4.13 自动化契约用例（architecture.md 附录 A.18 回填，15 条）

> 覆盖 CLI 契约、日志 schema、模板校验、批处理细则、平台与鲁棒性；补齐后 A.18 的 `AUTO` 临时断言可下线。全部 P0。视觉验收不适用者以「文本/文件证据」为准，证据格式见 §2.3。

#### TC-CLI-01 非法与禁止选项、--help 六要素（P0，CLI-002/003/004）

- **命令**：

```powershell
docconvert examples/headings.md --bogus 2> out/CLI1.err; "exit=$LASTEXITCODE"; Get-Content out/CLI1.err
docconvert 2> out/CLI1b.err; "exit=$LASTEXITCODE"
docconvert examples/headings.md --format html 2> out/CLI1c.err; "exit=$LASTEXITCODE"
$forbidden = (Select-String -Path requirements.md -Pattern '`--(font|margin|color|template|reference|theme|page-size|engine|jobs|log|encoding)`' -AllMatches).Matches.Value | Sort-Object -Unique
foreach ($f in $forbidden) { docconvert examples/headings.md $f x 2>$null; "$f -> $LASTEXITCODE" }
docconvert --help | Out-File out/CLI1-help.txt -Encoding utf8
```

- **期望**：前三类非法调用退出码均为 **2**，stderr 为 `ERROR usage-error: …` + 一行 `hint:`；`$forbidden` 每项退出码 **2**；`--help` 含六要素：用法行、选项表（含默认值）、支持的扩展名、默认输出目录规则（`docconvert-out`）、退出码表（0/1/2/3/4/5）、一条可复制示例；`--help` 全文不含 `$forbidden` 中任何字符串。
- **失败判据**：任一非法调用退出码 ≠ 2；`--help` 缺要素或出现禁用参数名；打印堆栈。
- **关联失败模式**：规范分裂；覆盖源文件（缺预检）。

#### TC-CLI-02 --version 七行固定键序（P0，CLI-005）

- **命令**：

```powershell
docconvert --version | Tee-Object out/CLI2.txt
"lines=" + (Get-Content out/CLI2.txt).Count
$env:DOCONVERT_LIBREOFFICE_KIT = "C:\\no\\such\\kit"
try { docconvert --version; "exit=$LASTEXITCODE" } finally { Remove-Item Env:DOCONVERT_LIBREOFFICE_KIT }
```

- **期望**：恰好 7 行，键序固定 `docconvert`、`node`、`template`、`pdf-kit`、`pdf-engine`、`toc`、`fonts`，格式 `key: value`；`toc: two-pass`；引擎不可用时 `pdf-engine: unavailable` 且退出码仍 **0**。
- **失败判据**：行数 ≠ 7；键序变化；引擎缺失时退出码非 0 或输出堆栈。
- **关联失败模式**：规范分裂；只在开发者机器能跑。

#### TC-CLI-03 错误格式、hint、无堆栈、无 ANSI（P0，CLI-006/007）

- **命令**：

```powershell
docconvert examples/errors/does-not-exist.md 2> out/CLI3-1.err; "exit=$LASTEXITCODE"
docconvert examples/errors/unsupported.txt.bin 2> out/CLI3-2.err; "exit=$LASTEXITCODE"
$env:DOCONVERT_LIBREOFFICE_KIT = "C:\\no\\such\\kit"
try { docconvert examples/headings.md -o out/CLI3-3 --format pdf 2> out/CLI3-3.err } finally { Remove-Item Env:DOCONVERT_LIBREOFFICE_KIT }
Get-Content out/CLI3-*.err
$esc = [char]27
"esc_hit=" + ((Get-Content out/CLI3-*.err -Raw) -match [regex]::Escape($esc))
"stack_hit=" + ((Get-Content out/CLI3-*.err -Raw) -match '(?m)^\s+at ')
```

- **期望**：各错误 stderr 匹配 `^ERROR [a-z-]+: .+`，至多一行 `^hint: `；`esc_hit=False`；`stack_hit=False`；信息为中文。
- **失败判据**：缺 `ERROR ` 前缀；出现堆栈；出现 ANSI 转义；重复刷屏。
- **关联失败模式**：看起来能跑但质量差。

#### TC-BAT-01 输入收集、码点序与汇总行（P0，BATCH-001/002/006）

- **准备**：构造 `out/BAT1/`：`b.md`、`a.md`、`sub/c.md`、`.hidden.md`、`node_modules/x.md`、`docconvert-out/old.md`、`d.TXT`。
- **命令**：

```powershell
docconvert out/BAT1 -o out/BAT1-out | Tee-Object out/BAT1.log
"exit=$LASTEXITCODE"
docconvert out/BAT1 -r -o out/BAT1-out-r | Tee-Object out/BAT1-r.log
$summary = (Get-Content out/BAT1.log)[-2]
"summary_ok=" + ($summary -match '^SUMMARY total=\d+ ok=\d+ failed=\d+ skipped=\d+ elapsed=\d+\.\ds$')
"last_line_ok=" + ((Get-Content out/BAT1.log)[-1] -match '^OUTPUT .+')
```

- **期望**：不加 `-r` 仅第一层（`a.md`、`b.md`、`d.TXT`），跳过 `.hidden.md`、`node_modules`、`docconvert-out`；加 `-r` 含 `sub/c.md`；顺序按输出相对路径 Unicode 码点升序（两次运行一致）；`summary_ok=True`、`last_line_ok=True`。
- **失败判据**：处理集合不符；顺序随枚举变化；汇总行不匹配。
- **关联失败模式**：只在开发者机器能跑。

#### TC-BAT-02 快速失败 / partial / 冲突预检（P0，BATCH-003/004/005/010）

- **命令**：

```powershell
docconvert out/BAT2 -o out/BAT2-out; "exit=$LASTEXITCODE"
Get-Content out/BAT2-out/conversion-log.jsonl | Select-String 'skipped'
$env:DOCONVERT_LIBREOFFICE_KIT = "C:\\no\\such\\kit"
try { docconvert out/BAT2b -o out/BAT2b-out --continue-on-error; "exit=$LASTEXITCODE" } finally { Remove-Item Env:DOCONVERT_LIBREOFFICE_KIT }
docconvert out/BAT2c -o out/BAT2c-out; "exit=$LASTEXITCODE"
Get-ChildItem out/BAT2c-out -ErrorAction SilentlyContinue
```

- **期望**：快速失败 → 退出码 **3**、已成功产物保留、第 3 个文件日志记 `skipped`；`--continue-on-error` 且 PDF 不可用 → 退出码 **4**、该文件 `status=partial`、docx 保留、pdf 不存在、`SUMMARY failed=1`；冲突预检 → 退出码 **2**（`output-conflict`）、outdir 零新增产物。
- **失败判据**：快速失败后仍处理后续；partial 删掉已成功 docx；冲突仍产出文件。
- **关联失败模式**：批量一失败全中断；覆盖源文件。

#### TC-LOG-01 日志 schema、覆盖写、真实哈希、隐私（P0，LOG-001~005）

- **命令**：

```powershell
docconvert examples/headings.md -o out/LOG1 --format both
docconvert examples/cjk.md -o out/LOG1 --format both
$j = Get-Content out/LOG1/conversion-log.jsonl | ForEach-Object { $_ | ConvertFrom-Json }
"records=" + $j.Count + " file=" + ($j | Where-Object type -eq "file").Count + " run=" + ($j | Where-Object type -eq "run").Count
$last = $j[-1]; $last | Select-Object type, exitCode, outdir, tocMode, counts
$f = $j | Where-Object type -eq "file" | Select-Object -First 1
$f.outputs | ForEach-Object { "sha_match=" + ($_.sha256 -eq (Get-FileHash $_.path -Algorithm SHA256).Hash.ToLower()) }
"body_leak=" + ((Get-Content out/LOG1/conversion-log.jsonl -Raw).Contains("城市湿地公园"))
$required = "type","schemaVersion","program","template","pdfKit","fonts","command","input","outputs","status","errorCode","warnings","toc","startedAt","endedAt","durationMs","platform"
"missing_fields=" + (($required | Where-Object { $f.PSObject.Properties.Name -notcontains $_ }) -join ",")
```

- **期望**：第二次运行后日志**只含第二次**记录（`file=1`、`run=1`，旧记录不残留）；file 记录含 §10.1 全部 17 个必填字段（`missing_fields` 为空）；run 记录 counts 与 SUMMARY 一致、`exitCode=0`、`tocMode="two-pass"`；每个产物 `sha_match=True`；`body_leak=False`。
- **失败判据**：追加而非覆盖；缺字段；哈希不一致；日志含正文片段；run 记录不是最后一行。
- **关联失败模式**：看起来能跑但质量差；可复现性缺失。

#### TC-TPL-01 模板唯一入口、无内容、版本、黑名单（P0，TPL-001~006）

- **命令**：

```powershell
$h = (Get-FileHash templates/reference.docx -Algorithm SHA256).Hash.ToLower()
"tpl_sha12=" + $h.Substring(0,12)
docconvert --version | Select-String "template:"
Copy-Item templates/reference.docx out/TPL1.zip -Force
Expand-Archive out/TPL1.zip -DestinationPath out/TPL1 -Force
$docXml = Get-Content out/TPL1/word/document.xml -Raw
"visible_text=" + ([regex]::Matches($docXml, '<w:t[^>]*>[^<]+</w:t>')).Count
"blacklist_hits=" + ((Get-Content config/default.yml -Raw | Select-String -Pattern 'path|url|http|template|reference|date|time|random|seed|theme' -AllMatches).Matches.Count)
```

- **期望**：`visible_text=0`（模板不含正文，空段落不计）；`--version` 的 `template:` 值 = `tpl_sha12`；`blacklist_hits=0`；在 CWD 放入同名配置后产物字号不变（REQ-TPL-004）；任意覆盖类参数 → 2（TC-CLI-01）。
- **失败判据**：模板含正文；版本与哈希不符；配置可被外部覆盖；黑名单关键词命中。
- **关联失败模式**：模板硬编码；规范分裂。

#### TC-TOC-01 DOCX 目录缓存齐全且打开不弹窗（P0，TOC-003/010）

- **命令**：

```powershell
docconvert examples/long-50.md -o out/TOC1 --format docx
Copy-Item out/TOC1/long-50.docx out/TOC1.zip -Force
Expand-Archive out/TOC1.zip -DestinationPath out/TOC1-unzip -Force
$xml = Get-Content out/TOC1-unzip/word/document.xml -Raw
"bookmarks=" + ([regex]::Matches($xml, 'w:bookmarkStart')).Count
"updateFields=" + ([regex]::Matches($xml, 'w:updateFields')).Count
"toc_field=" + ([regex]::Matches($xml, 'TOC')).Count
$tocParas = [regex]::Matches($xml, '<w:p\b[\s\S]*?</w:p>') | Where-Object { $_.Value -match 'TOC[1-3]' }
"toc_para_total=" + $tocParas.Count
"toc_entries=" + ($tocParas | Where-Object { $_.Value -notmatch '<w:instrText>' }).Count
```

- **期望**：`updateFields=0`（打开不弹窗）；`toc_field ≥ 1`；目录预置完整缓存 —— **`toc_entries = 134`**（即 134 个 H1–H3 条目；DOCX 中另有 **1 个 TOC 域指令段落**，故 `toc_para_total = 135`，统计时必须排除 `<w:instrText>` 段落）；页码为数字；`bookmarks ≥ 134`。
- **失败判据**：`updateFields > 0`；目录空/无缓存；书签缺失；`toc_entries ≠ 134`（把域指令段落计成条目同样判失败）。
- **视觉验收（P0）**：引擎可用时 `node $KIT render --input out/TOC1/long-50.pdf …` 需 PDF——本用例只跑 docx，故视觉验收由 TC-LONG-TOC-CONV 覆盖；本用例以 XML 证据判定。
- **关联失败模式**：看起来能跑但质量差。

#### TC-TOC-02 分页漂移注入 → 重试一次 → 显式告警（P0，TOC-005）

- **准备**：模块级测试（node:test）——直接 import `verifyTocConvergence`，注入合成的 pass1/pass2 outline 数据（页码差 1 页），验证重试一次与告警返回值；**不得新增 CLI 参数或环境变量钩子**（CLI 契约冻结，D-003）。
- **命令**（测试文件由实现方在 `tests/` 下提供，不在本文件内写实现）：

```powershell
node --test test/toc/toc-convergence.test.mjs
"exit=$LASTEXITCODE"
```

- **断言**：① 传入不一致的 pass1/pass2 outline → 返回 `{converged:false, retried:true, pages:[…]}`（或等价结构）且仅重试 1 次；② 返回的告警码为 `toc-not-converged`；③ 传入一致的 outline → `converged:true`、`retried:false`；④ 测试进程内不读取任何环境变量作为输入，CLI 无新增参数。
- **期望**：最多重试一次；仍不一致 → 文件照常输出、stderr 一行 `WARN toc-not-converged: …`、日志 `toc.converged=false`、退出码 **0**；禁止静默。
- **失败判据**：静默输出不一致页码；退出码非 0；无限重试。
- **关联失败模式**：静默降级；看起来能跑但质量差。

#### TC-REP-03 产物不含日期/路径/用户名（P0，REP-003）

- **命令**：

```powershell
docconvert examples/headings.md -o out/REP3 --format both
Copy-Item out/REP3/headings.docx out/REP3.zip -Force
Expand-Archive out/REP3.zip -DestinationPath out/REP3-unzip -Force
$blob = (Get-ChildItem out/REP3-unzip -Recurse -File | Where-Object { $_.Extension -in ".xml",".rels" } | ForEach-Object { Get-Content $_.FullName -Raw }) -join [Environment]::NewLine
"date_hits=" + ([regex]::Matches($blob, '20\d\d-\d\d-\d\d|20\d\d年\d+月')).Count
"user_hits=" + ($blob -match [regex]::Escape($env:USERNAME))
"drive_hits=" + ($blob -match '[A-Z]:\\\\Users')
```

- **期望**：`date_hits=0`、`user_hits=False`、`drive_hits=False`；PDF 文本层不含日期（用 kit 的 docx→txt 辅助核对）。
- **失败判据**：任一命中。
- **关联失败模式**：可复现性缺失。

#### TC-MD-01 CJK 拼接、畸形降级、反斜杠转义（P0，MD-002/004/006）

- **准备**：构造 `out/MD1/in.md`，至少含：两行中文（上一行末字「字」、下一行首字「符」）、两行英文、未闭合 `**` 粗体、列数不一致的表格行、孤立围栏、`\*` 转义星号。
- **命令**：

```powershell
docconvert out/MD1/in.md -o out/MD1-out --format docx 2> out/MD1.err
"exit=$LASTEXITCODE"; Get-Content out/MD1.err
Copy-Item out/MD1-out/in.docx out/MD1.zip -Force
Expand-Archive out/MD1.zip -DestinationPath out/MD1-unzip -Force
$xml = Get-Content out/MD1-unzip/word/document.xml -Raw
"cjk_join=" + ($xml -match "字符")
"warn_lines=" + ((Get-Content out/MD1.err) | Where-Object { $_ -match '^WARN ' }).Count
```

- **期望**：退出码 **0**（畸形不中断整篇）；两行中文拼接**无空格**（`字符` 连续出现），两行英文拼接**恰一个空格**；`warn_lines ≥ 1` 且每条含 `:行号:`；转义星号渲染为字面 `*` 且不倾斜。
- **失败判据**：整篇失败；拼接规则反了；畸形结构被丢弃；转义仍触发强调。
- **关联失败模式**：看起来能跑但质量差；规范分裂。

#### TC-TX-04 §2.3.4 三示例逐字一致与零改写（P0，TXT-001~006）

> **ID 说明**：附录 A.18 建议用 TC-TX-02，但该 ID 已分配给「关闭首行标题（N/A）」用例，故顺延为 TC-TX-04，并在索引中登记。

- **准备**：把 requirements §2.3.4 的 3 个输入/输出示例分别存为 `out/TX4/s1.txt`、`s2.txt`、`s3.txt`。
- **命令**：

```powershell
foreach ($i in 1..3) {
  docconvert "out/TX4/s$i.txt" -o out/TX4-out --format docx
  Copy-Item "out/TX4-out/s$i.docx" "out/TX4-out/s$i.zip" -Force
  Expand-Archive "out/TX4-out/s$i.zip" -DestinationPath "out/TX4-out/u$i" -Force
  $xml = Get-Content "out/TX4-out/u$i/word/document.xml" -Raw
  "s$i paragraphs=" + ([regex]::Matches($xml, '<w:p[ >]')).Count + " numPr=" + ([regex]::Matches($xml, '<w:numPr>')).Count
}
```

- **期望**：三个示例的输出块序列（块类型 + 文本）与 requirements §2.3.4 逐字相同；「去空白 + 去换行」后源文本与产物文本字符序列一致（列表符号/边框除外）；连续 3 个空行不产生空段落。
- **失败判据**：任一示例块类型或文本不符；字符被改写（全半角/繁简/标点替换）；出现空段落。
- **关联失败模式**：规范分裂；看起来能跑但质量差。

#### TC-DEP-03 断网一致与错误码全集（P0，DEP-003/004）

- **命令**：

```powershell
docconvert examples/cjk.md -o out/DEP3 --format both; "exit=$LASTEXITCODE"
$codes = (Select-String -Path requirements.md -Pattern '^\| ([a-z][a-z-]+) \| (参数|输入|依赖|转换|内部|环境) \|' -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
"req_codes=" + $codes.Count
$src = Get-ChildItem -Recurse -File -Include *.js,*.mjs | Where-Object { $_.FullName -notmatch 'node_modules|_spike|out' }
$missing = $codes | Where-Object { -not ($src | Select-String -SimpleMatch $_ -Quiet) }
"missing_codes=" + ($missing -join ",")
"net_imports=" + (($src | Select-String -Pattern 'node:https?|require\("https?"\)' -AllMatches).Matches.Count)
```

- **期望**：无网环境下 `--format both` 退出码 **0**；`req_codes=14`（§9.1 现含 `output-not-writable` 这一「环境」类码）且 `missing_codes` 为空（实现覆盖全部已登记码）；`net_imports=0`（无联网模块导入）。
- **失败判据**：断网失败；缺码；存在联网导入。
- **关联失败模式**：缺 TeX 类依赖；只在开发者机器能跑。

#### TC-PLAT-01 中文空格路径、长路径、大小写冲突（P0，PLAT-001/005/006）

- **命令**：

```powershell
New-Item -ItemType Directory -Force "out/PLAT1/中文 目录" | Out-Null
Copy-Item examples/headings.md "out/PLAT1/中文 目录/标题 样本.md"
docconvert "out/PLAT1/中文 目录/标题 样本.md" -o "out/PLAT1/中文 目录/docconvert-out"
"cn_exit=$LASTEXITCODE"
$deep = "out/PLAT1/longpath"
for ($i = 0; $i -lt 12; $i++) { $deep = Join-Path $deep ("segment-" + ("x" * 20)) }
New-Item -ItemType Directory -Force $deep | Out-Null
Copy-Item examples/headings.md (Join-Path $deep "a.md")
docconvert (Join-Path $deep "a.md") -o (Join-Path $deep "docconvert-out"); "long_exit=$LASTEXITCODE"
New-Item -ItemType Directory -Force out/PLAT1/case | Out-Null
Set-Content out/PLAT1/case/a.md "# A"; Set-Content out/PLAT1/case/a.txt "# A"
docconvert out/PLAT1/case -o out/PLAT1/case/out; "conflict_exit=$LASTEXITCODE"
```

- **期望**：`cn_exit=0` 且产物存在；`long_exit=0`（路径 > 260 字符）；`conflict_exit=2`（`output-conflict`）且 outdir 零产物。
- **失败判据**：任一路径失败；长路径 ENOENT；大小写冲突未被预检。
- **关联失败模式**：只在开发者机器能跑；覆盖源文件。

#### TC-NFR-01 畸形输入不崩溃、不越界写、输入不变（P0，NFR-001/002/003）

- **准备**：`out/NFR1/` 放 20 个畸形样本（空文件、超长单行、50 层列表、未闭合围栏、二进制改名 .md、GB18030 文本、超深引用、超大表格行等；脚本生成，不写入 examples/）。
- **命令**：

```powershell
$before = (Get-ChildItem out/NFR1 -File | Get-FileHash -Algorithm SHA256).Hash -join ","
$cwdBefore = (Get-ChildItem -File).Name -join ","
docconvert out/NFR1 -o out/NFR1-out --continue-on-error 2> out/NFR1.err
"exit=$LASTEXITCODE"
$after = (Get-ChildItem out/NFR1 -File | Get-FileHash -Algorithm SHA256).Hash -join ","
"inputs_unchanged=" + ($before -eq $after)
"cwd_new=" + (((Get-ChildItem -File).Name -join ",") -ne $cwdBefore)
"stack_hit=" + ((Get-Content out/NFR1.err -Raw) -match '(?m)^\s+at ')
```

- **期望**：无未捕获异常（退出码不为 1）；每个失败样本都有 errorCode 并写入日志；`inputs_unchanged=True`；`cwd_new=False`；`stack_hit=False`。
- **失败判据**：崩溃/退出码 1；输入被修改；CWD 出现新文件；outdir 之外有写入。
- **关联失败模式**：覆盖源文件；只在开发者机器能跑。

---

## 5. 11 类覆盖矩阵（缺一不可）

| # | 类别 | 用例 | P0 覆盖 | P0 视觉验收 | 主要失败模式 |
| --- | --- | --- | --- | --- | --- |
| ① | 多级标题（Word 导航层级 / PDF 书签） | TC-H-01、TC-H-02、TC-H-03 | ✅ TC-H-01、TC-H-02 | 渲染第 1–2 页：一级 > 二级 > 正文字号；无方块；书签面板层级缩进可见 | 看起来能跑但质量差；模板硬编码 |
| ② | 多列表格（样式 / 跨页表头重复） | TC-TB-01、TC-TB-02、TC-TB-03 | ✅ **TC-TB-01（跨页表头）**、TC-TB-02 | 续页首行必须是表头八个字段；宽表最右列不被裁切 | 表格跨页表头丢失；看起来能跑但质量差 |
| ③ | 代码块（等宽字体 / 长行换行） | TC-CD-01、TC-CD-02 | ✅ TC-CD-01 | 超长行结尾片段完整可见，右侧页边距无字符 | 看起来能跑但质量差 |
| ④ | 图片（相对路径 / 尺寸） | TC-IM-01、TC-IM-02、TC-IM-03 | ✅ TC-IM-01 | 条形图完整、比例不变、右边缘在版心内；小图不被放大 | 只在开发者机器能跑；看起来能跑但质量差 |
| ⑤ | 中英混排 + 中文标点（字体回退 / 断行） | TC-CJ-01、TC-CJ-02 | ✅ TC-CJ-01 | 中西文同基线；全角标点等宽；无方块/空白洞 | 中文变方块；规范分裂 |
| ⑥ | 50 页+ 长文档（TOC 页码 / 性能） | TC-LG-01、TC-LG-02、**TC-LONG-TOC-CONV** | ✅ TC-LG-01、**TC-LONG-TOC-CONV** | 目录每条右侧页码右对齐且逐条等于正文实际页；≥50 页；两次运行一致 | 看起来能跑但质量差；缺 TeX 类依赖 |
| ⑦ | .txt 输入（结构化合理性） | TC-TX-01、TC-TX-02 | ✅ TC-TX-01 | 标题字号大于正文；项目符号与数字编号分别正确；段落数 ≥10 | 规范分裂；看起来能跑但质量差 |
| ⑧ | 错误输入（不存在 / 只读 / 缺依赖） | TC-ER-01 ~ TC-ER-07 | ✅ TC-ER-01、TC-ER-02 | 不适用（文本证据为主）；要求退出码非 0 + 可操作信息 + 无残缺产物 | 看起来能跑但质量差；静默降级 |
| ⑨ | 复用一致性（新入口 vs 直接 dsoffice） | TC-RU-01、TC-RU-02 | ⬜ P1（不阻塞） | 两路径第 1 页 PNG 哈希相同 | 重复造轮子；规范分裂 |
| ⑩ | 冲突用例（两份 reference.docx 只认内置） | TC-CF-01、TC-CF-02 | ⬜ P1（不阻塞） | 不适用；以 styles.xml 哈希相同为判据 | 模板硬编码；只在开发者机器能跑 |
| ⑪ | 缺依赖（隐藏/改名 kit 必须明确报错） | TC-DP-01、TC-DP-02 | ✅ TC-DP-01 | 不适用；以退出码与 stderr 文本为判据 | 缺 TeX 类依赖；静默降级 |
| 附加 | 可复现性（裁决 ④） | TC-RP-01、TC-RP-02 | ✅ TC-RP-01 | 不适用；以 SHA-256 相同为判据 | 可复现性缺失 |
| 附加 | 批量原子性 | TC-BT-01 | ⬜ P1 | 不适用 | 批量一失败全中断 |
| 附加 | 干净环境 | TC-CL-01 | ⬜ P2 | 不适用 | 只在开发者机器能跑；依赖冲突 |
| 附加 | **自动化契约（附录 A.18，15 条）** | TC-CLI-01~03、TC-BAT-01/02、TC-LOG-01、TC-TPL-01、TC-TOC-01/02、TC-REP-03、TC-MD-01、TC-TX-04、TC-DEP-03、TC-PLAT-01、TC-NFR-01 | ✅ 全部 P0 | 不适用（CLI/文件/schema 证据）；TC-TOC-01 的目录页码视觉断言由 TC-LONG-TOC-CONV 覆盖 | 规范分裂；只在开发者机器能跑；批量一失败全中断 |
| 附加 | **TOC 显式降级（引擎缺失）** | TC-TOC-DEGRADED | ⬜ P1 | 无法 render（引擎即缺失项）；以解压 TOC 段落文本判定 | 静默降级；看起来能跑但质量差 |

**矩阵自检**：11 类全部有用例；P0 覆盖 ①③④⑤⑥⑦⑧⑪ + ②的跨页表头（TC-TB-01），符合任务硬要求。⑨⑩ 为 P1，若阶段 3 时间允许再提升为 P0。

**增补记录（2026-10-22，技术负责人）**：⑥ 类新增 P0 用例 **TC-LONG-TOC-CONV**（长文档 TOC 页码收敛），样本 `examples/long-50.md`（≥50 页）。它把「目录页码正确」从视觉抽查升级为逐条比对 + 双跑一致性，补强 TC-LG-01 中较弱的页码断言。

## 6. 失败模式 → 用例反查表

技术负责人的 11 条失败模式，每条至少对应用例，避免"列了但没测"：

| 失败模式 | 对应用例 | 一句话判据 |
| --- | --- | --- |
| 重复造轮子 | TC-RU-01、TC-RU-02 | 同一 docx 经 docconvert 与 dsoffice 导出的 PDF 页数/字体/书签一致 |
| 规范分裂 | TC-H-03、TC-TX-02、TC-RU-01、TC-CF-02 | 文档声明的行为与实测一致（参数存在、深度声明、模板来源） |
| 依赖冲突 | TC-CL-01、TC-DP-01 | 干净环境可按 README 跑通；缺依赖有明确报错 |
| 只在开发者机器能跑 | TC-IM-01（CWD 无关）、TC-CF-01、TC-CF-02、TC-CL-01、TC-RU-02 | 换工作目录、换机器仍一致 |
| 缺 TeX 类依赖 | TC-DP-01、TC-LG-01 | 引擎缺失必须非零退出；长文档不依赖外部 TeX |
| 模板硬编码 | TC-H-01、TC-CF-01、TC-H-02 | 层级来自模板/样式；模板来源唯一且可追溯 |
| 批量一失败全中断 | TC-BT-01、TC-IM-03 | 单点失败后其余文件仍产出 |
| 覆盖源文件 | TC-ER-07、TC-ER-05 | 输入哈希不变；输出路径冲突时报错 |
| 中文变方块 | TC-CJ-01、TC-CD-02、TC-TX-01 | missingFonts 为空 + 字体表有中文字体 + 渲染无方块 |
| 表格跨页表头丢失 | TC-TB-01 | 续页首行 = 表头 |
| 看起来能跑但质量差 | 全部 P0 的视觉验收 | 有渲染图 + 具体观察项，不接受"看起来还行" |

## 7. 退出码约定（requirements §7.2，写死）

| 退出码 | 含义 | 触发条件 | 典型 errorCode |
| --- | --- | --- | --- |
| 0 | 全部成功 | 所有文件成功；或 `--help` / `--version` | — |
| 1 | 未预期内部错误 | 未捕获异常 | `internal-error` |
| 2 | **参数错误** | 未知选项、缺少 input、`--format` 非法值、`-o` 指向已存在文件、输出冲突 | `usage-error` / `output-conflict` |
| 3 | **输入错误** | 路径不存在、扩展名不支持、空文件、解码失败、目录内无输入文件、无读取权限 | `input-not-found` / `unsupported-extension` / `empty-input` / `decode-error` / `no-input-files` / `input-permission` |
| 4 | **依赖 / 环境缺失** | Node 版本过低、内置模板缺失或损坏、PDF 引擎不可用（且 format 含 pdf）、输出目录不可写或无法创建 | `runtime-unsupported` / `template-missing` / `pdf-engine-missing` / `output-not-writable` |
| 5 | **转换失败** | 解析/生成/导出过程中的单文件失败 | `convert-failed` |

单文件模式返回该文件的失败类别码；批量模式预检错误（2/4）整体退出，转换期失败返回**首个失败文件**的类别码；`--continue-on-error` 不改变「有失败即非 0」。

## 8. 执行顺序与时间预算（闸门 2 用）

建议按"先结构、后视觉、最后破坏性"的顺序执行，破坏性用例（改名、只读）放最后并确保回滚：

1. 冒烟：TC-H-01（docx）→ TC-H-02（pdf）→ 确认工具链通。
2. 结构与排版：TC-TB-01、TC-TB-02、TC-CD-01、TC-IM-01、TC-CJ-01、TC-TX-01。
3. 长文档：TC-LG-01（耗时最长，单独跑，记录耗时）。
4. 可复现：TC-RP-01、TC-RP-02。
5. 一致性：TC-RU-01、TC-RU-02、TC-CF-01。
6. 破坏性：TC-DP-01、TC-DP-02、TC-ER-01 ~ TC-ER-07、TC-IM-03、TC-BT-01、TC-TOC-DEGRADED（每步前后确认环境已恢复）。
7. 自动化契约（A.18，15 条）：TC-CLI-01~03 → TC-BAT-01/02 → TC-LOG-01 → TC-TPL-01 → TC-REP-03 → TC-MD-01 → TC-TX-04 → TC-DEP-03 → TC-PLAT-01 → TC-NFR-01 → TC-TOC-01/02。前 7 条可在冒烟后立刻跑，NFR/PLAT 放最后（构造样本耗时）。

> TC-LONG-TOC-CONV 与 TC-LG-01 共用 `long-50.md`，建议一次转换两处取数：先跑 TC-LONG-TOC-CONV 的 run1，其 pageCount 直接供 TC-LG-01 断言。

时间预算（估）：1–3 约 20 分钟；TC-LG-01 单独 ≤ 5 分钟（含渲染）；4–5 约 10 分钟；6 约 10 分钟。合计约 45 分钟（不含安装依赖与排障）。

## 9. 参数名回填对照（architecture.md 附录 F，已生效）

本文正文已按定稿参数书写，下表仅用于历史对照与审计，**不需要再替换**：

| 旧写法（v1 草稿） | 定稿（v1） | 说明 | 受影响用例 |
| --- | --- | --- | --- |
| `docconvert <input> -o <outdir>` | `docconvert <input> -o <outdir>` | 入口 = `bin/docconvert.js` | 全部 |
| 旧格式参数（逗号列表写法） | `--format both` | 单值枚举，不是逗号列表 | 全部 |
| 旧模板覆盖参数 | **不存在**（传入 → 2） | v1 无模板覆盖入口 | TC-ER-06 记 N/A；TC-CLI-01 断言 |
| 旧「关闭首行标题」参数 | **不存在** | v1 不提供 | TC-TX-02 记 N/A |
| 旧「引擎 CLI 路径」环境变量 | `DOCONVERT_LIBREOFFICE_KIT=<kit 包目录>` | 值是 kit 包目录，不是 cli.js | TC-DP-01 / TC-TOC-DEGRADED |
| 硬编码 `_npx/…/cli.js` | 依赖解析（见 §2.2） | 禁止硬编码 | 全部渲染命令 |
| 退出码 0/1/2/3（旧提案） | **0/1/2/3/4/5**（requirements §7.2） | 引擎缺失=4；转换失败=5 | TC-ER 系列、TC-DP-01 |

## 10. 未决事项与风险

| # | 未决事项 | 影响 | 处理 |
| --- | --- | --- | --- |
| 1 | ~~CLI 入口与参数名未定稿~~ **已闭环（附录 F）** | 全部用例 | 已回填 `docconvert`、`--format`、退出码 0–5；§9 保留历史对照供审计 |
| 2 | ~~TOC 页码能否由引擎刷新~~ **已闭环（spike t3：两遍法写死）** | TC-LONG-TOC-CONV、TC-TOC-DEGRADED | 正常路径按两遍法严格判定；引擎缺失走显式降级分支（exit 0 + WARN toc-degraded） |
| 3 | PDF 书签生成 | TC-H-02、TC-TOC-01 | spike 已证实书签天然覆盖全部标题层级；缺失仍属闸门 2 阻塞问题 |
| 4 | 缺图/空文件的默认策略（失败还是警告） | TC-IM-03、TC-ER-03 | 由 requirements.md 定稿；两种都可判定，但必须写进文档 |
| 4b | TOC 页码实现路径已由 spike t3 定论（两遍法：PDF#1 书签 → 回填 → PDF#2） | TC-LONG-TOC-CONV | 已闭环；若实现偏离两遍法且无页码，按第 ⑦ 条判失败 |
| 5 | 长文档耗时阈值 | TC-LG-01、TC-LONG-TOC-CONV | 改用 requirements REQ-NFR-004 口径：单文件 both ≤30s（冷启 ≤45s），50 页长文两遍法额外成本 ≤5s；超阈值由技术负责人校准 |
| 6 | `long-50.md` 实测页数 | TC-LG-01 / TC-LONG-TOC-CONV 的 ≥50 页 | 本样本 46,978 字符、134 个 H1–H3 标题，按基线密度（既有 12 页文档 ≈ 778 字符/页）估算 52–56 页；若默认模板更紧凑导致不足 50 页，**记录实测页数并按模板验收项处理**，不得修改样本来凑数 |
| 7 | macOS/Linux 字体可用性 | ⑤ 的跨平台部分 | v1 只验证 Windows；跨平台列为 roadmap |

## 11. 用例索引（速查）

| 用例 | 优先级 | 类别 | 输入样本 |
| --- | --- | --- | --- |
| TC-H-01 | P0 | ① | headings.md |
| TC-H-02 | P0 | ① | headings.md |
| TC-H-03 | P1 | ① | headings.md |
| TC-TB-01 | P0 | ② | table.md |
| TC-TB-02 | P0 | ② | table.md |
| TC-TB-03 | P1 | ② | table.md |
| TC-CD-01 | P0 | ③ | code.md |
| TC-CD-02 | P1 | ③ | code.md |
| TC-IM-01 | P0 | ④ | image.md + assets/ |
| TC-IM-02 | P1 | ④ | image.md |
| TC-IM-03 | P1 | ④ / 批量 | image.md + assets/ |
| TC-CJ-01 | P0 | ⑤ | cjk.md |
| TC-CJ-02 | P1 | ⑤ | cjk.md |
| TC-LG-01 | P0 | ⑥ | long-50.md |
| TC-LG-02 | P1 | ⑥ | long-50.md |
| TC-LONG-TOC-CONV | P0 | ⑥ | long-50.md |
| TC-TX-01 | P0 | ⑦ | notes.txt |
| TC-TX-02 | P1 | ⑦ | notes.txt |
| TC-ER-01 | P0 | ⑧ | errors/（不存在路径） |
| TC-ER-02 | P0 | ⑧ | errors/readonly-target.md |
| TC-ER-03 | P1 | ⑧ | errors/empty.md |
| TC-ER-04 | P1 | ⑧ | errors/unsupported.txt.bin |
| TC-ER-05 | P2 | ⑧ | headings.md |
| TC-ER-06 | P2 | ⑧ | headings.md |
| TC-ER-07 | P1 | ⑧ | headings.md |
| TC-RU-01 | P1 | ⑨ | cjk.md |
| TC-RU-02 | P1 | ⑨ | cjk.md |
| TC-CF-01 | P1 | ⑩ | conflict/ |
| TC-CF-02 | P2 | ⑩ | templates/reference.docx |
| TC-DP-01 | P0 | ⑪ | headings.md |
| TC-DP-02 | P1 | ⑪ | headings.md |
| TC-RP-01 | P0 | 附加 | headings.md |
| TC-RP-02 | P1 | 附加 | headings.md |
| TC-BT-01 | P1 | 附加 | headings.md/table.md + 空文件 |
| TC-CL-01 | P2 | 附加 | 全部 |
| TC-CLI-01 | P0 | 自动化（A.18） | headings.md + requirements 禁用清单 |
| TC-CLI-02 | P0 | 自动化（A.18） | —（--version） |
| TC-CLI-03 | P0 | 自动化（A.18） | errors/ |
| TC-BAT-01 | P0 | 自动化（A.18） | 临时构造 out/BAT1 |
| TC-BAT-02 | P0 | 自动化（A.18） | 临时构造 out/BAT2* |
| TC-LOG-01 | P0 | 自动化（A.18） | headings.md + cjk.md |
| TC-TPL-01 | P0 | 自动化（A.18） | templates/reference.docx + config/default.yml |
| TC-TOC-01 | P0 | 自动化（A.18） | long-50.md |
| TC-TOC-02 | P0 | 自动化（A.18） | 模块级测试 `test/toc/toc-convergence.test.mjs`（import `verifyTocConvergence`，合成 outline） |
| TC-REP-03 | P0 | 自动化（A.18） | headings.md |
| TC-MD-01 | P0 | 自动化（A.18） | 临时构造 out/MD1/in.md |
| TC-TX-04 | P0 | 自动化（A.18） | requirements §2.3.4 三示例 |
| TC-DEP-03 | P0 | 自动化（A.18） | cjk.md + requirements 错误码表 |
| TC-PLAT-01 | P0 | 自动化（A.18） | headings.md（中文空格/长路径） |
| TC-NFR-01 | P0 | 自动化（A.18） | 20 个畸形样本（脚本生成） |
| TC-TOC-DEGRADED | P1 | ⑥ / 降级 | long-50.md + 失效 kit 变量 |

统计：共 **51 条**用例（P0 **29** 条、P1 **17** 条、P2 3 条、N/A 2 条）。P0 清单：TC-H-01、TC-H-02、TC-TB-01、TC-TB-02、TC-CD-01、TC-IM-01、TC-CJ-01、TC-LG-01、TC-LONG-TOC-CONV、TC-TX-01、TC-ER-01、TC-ER-02、TC-DP-01、TC-RP-01，以及 A.18 回填的 15 条自动化用例（TC-CLI-01~03、TC-BAT-01/02、TC-LOG-01、TC-TPL-01、TC-TOC-01/02、TC-REP-03、TC-MD-01、TC-TX-04、TC-DEP-03、TC-PLAT-01、TC-NFR-01）。N/A：TC-TX-02、TC-ER-06（v1 无对应参数，断言转由 TC-CLI-01 / TC-TX-01 / TC-TX-04 承担）。

---

## 12. 本文件的边界声明

1. 本文件**不包含**任何实现代码、不假设内部 API；所有命令要么是 `dc` 入口（形态待定稿），要么是已实测可用的 `dsoffice`。
2. 本文件**未执行**任何用例；所有"期望值"来自样本计数（已核对）与既有产物实测（PDF 书签形态、kit 独占写入行为），不包含猜测的实测结果。
3. 样本中的数值型内容（观测记录、数量、日期）为**示例数据**，仅用于排版与计数断言，不得作为科研引用。
4. 若实现阶段发现某条用例的期望与需求冲突，**以 requirements.md 为准**，并在 test-report 中记录冲突点与裁决来源，不得私自改判定。
