# docconvert Spike 报告（阶段 0.5）

> 执行者：spike-executor（task t3 / attempt e8548e56）  
> 时间：2026-10-22 00:00–01:05（Asia/Shanghai）  
> 约束：本报告只做验证，不改 docconvert 源码/模板，不安装任何依赖；实验产物全部在 `docconvert/_spike/`（不进入交付物）。  
> 输入（只读）：`docconvert/workspace-survey.md`；kit 位置仅本地实验使用，产品不得硬编码。

**环境**

| 项 | 值 |
|---|---|
| 工作区 | `<workspace>`（路径含空格与中文，已用于全部实测） |
| Node | v24.19.0 |
| kit | `@deepseek-ai/libreoffice-kit@0.1.5`（native 后端，LibreOfficeDev 26.8.0.3） |
| kit 本次位置 | `<npm-cache>\_npx\<hash>\node_modules\@deepseek-ai\libreoffice-kit`（产品不得硬编码） |
| 网络 | 当前无网（registry.npmjs.org 超时），全部实验离线完成 |

**结论速览**

| Spike | 结论 | 对架构的影响 |
|---|---|---|
| Spike 1｜PDF 目录页码 | **B：两遍法可行**（原生单遍与 `w:updateFields` 均不可行） | PDF 管线固定为「DOCX 预置完整目录缓存 → PDF#1 → 解析 outline → 回填页码 → PDF#2 → 稳定性校验」；DOCX 与 PDF 共用同一份目录页码 |
| Spike 2｜离线依赖解析 | **本机完全离线可行；全新目标机首次安装必须联网（或预置 kit / 复用 DSH npx 缓存）** | kit 发现独立成模块（env → 项目 → 全局 → npx 缓存，精确 0.1.5 + 引擎校验）+ `docconvert doctor`；输出用临时路径原子替换；首次安装说明写进 README |

---

## 1. Spike 1｜PDF 目录页码

### 1.1 问题

LibreOffice（kit 0.1.5 native）在 docx→pdf 时是否刷新 TOC 域（`TOC \o "1-3" \h \z \u`）并生成正确页码？`w:updateFields` 是否被尊重？PDF 书签是否天然覆盖全部标题层级？

### 1.2 实验文档与方法

用内置 `zlib` 手写 OOXML + ZIP（无第三方库）生成最小 DOCX：A4、34 个标题（H1×6 / H2×12 / H3×16）、封面 1 页、目录 1 行占位、6 章正文，正文显式分页。TOC 域指令 `TOC \o "1-3" \h \z \u`；标题带书签供目录超链接使用。生成脚本：`docconvert/_spike/mkdocx.mjs`。

4 个变体，隔离两个自变量（TOC 是否有完整缓存结果 / `w:updateFields` 开关）：

| 变体 | TOC 缓存结果 | `w:updateFields` | PDF 页数 | PDF 大小 |
|---|---|---|---|---|
| A `a-placeholder-update` | 1 行占位「（目录占位：转换时刷新）」 | true | 7 | 175,844 B |
| B `b-placeholder-noupdate` | 同上 | false | 7 | 175,844 B |
| C `c-cached-noupdate` | 34 条完整缓存结果，页码统一预填 `00` | false | 8 | 233,568 B |
| D `d-cached-update` | 同上 | true | 8 | 233,568 B |

命令（4 个变体相同流程，路径变量 `KIT` 指 kit 根目录）：

```powershell
node docconvert\_spike\mkdocx.mjs docconvert\_spike\out\a-placeholder-update.docx --toc=placeholder --update-fields=true
node "$KIT\lib\cli.js" convert --input <abs>\a-placeholder-update.docx --output <abs>\a-placeholder-update.pdf --timeout-ms 180000
```

原始输出（变体 A）：

```json
{"ok":true,"outPath":"...\\a-placeholder-update.docx","tocMode":"placeholder","updateFields":true,"cachedNumbers":0,"headings":34}
{"backend":"native","missingFonts":[],"outputPath":"...\\a-placeholder-update.pdf"}
exit=0 size=175844
```

自写 PDF 解析器（`docconvert/_spike/pdfinfo.mjs`，仅用 Node 内置 `zlib`，无第三方库）提取逐页文本、目录（outline）层级与页码：

```powershell
node docconvert\_spike\pdfinfo.mjs docconvert\_spike\out\a-placeholder-update.pdf --json=<out>\a.json --text
```

### 1.3 发现 1：LibreOffice 不刷新 TOC 域（原生单遍不可行）

变体 A（`w:updateFields=true`）PDF 第 2 页逐页文本原文：

```text
===== PAGE 2 =====
目录  Contents
（目录占位：转换时刷新）
第  2 页
```

占位文字被原样保留 → **`w:updateFields` 未被 LibreOffice 尊重，TOC 域未刷新**。变体 B（无 updateFields）结果相同（同一占位文本、同样 7 页、同样 175,844 B）。

变体 C/D（预置 34 条缓存结果，页码 `00`）PDF 第 2–3 页原文（节选）：

```text
===== PAGE 2 =====
目录
1 Introduction  引言 ........................................................................................................................... 00
1.1 Background  背景 ................................................................................................................................... 00
1.1.1 Scope  范围 ............................................................................................................................................ 00
...
第  2 页
===== PAGE 3 =====
4.2 Reproducibility  可复现 .......................................................................................................................... 00
...
6.2.1 Links  链接 .............................................................................................................................................. 00
第  3 页
```

C 与 D 的目录页码都仍是 `00` → **`w:updateFields=true` 对导出 PDF 的目录页码没有任何影响**。结论：既不能依赖 LibreOffice 自动生成目录页码，也不能靠 updateFields 触发；若 DOCX 只带 1 行占位结果，PDF 目录就是占位文字。

### 1.4 发现 2：PDF 书签天然覆盖全部标题层级

即使 TOC 域完全未刷新（变体 A/B），导出的 PDF outline 仍包含全部 34 个标题，层级 0/1/2 与 H1/H2/H3 对应，标题文本正确，目标是文档内页面对象：

```json
{"pageCount":7,"outlineCount":34,"outline":[
 {"level":0,"title":"1 Introduction 引言","page":2},
 {"level":1,"title":"1.1 Background 背景","page":2},
 {"level":2,"title":"1.1.1 Scope 范围","page":2},
 ...
 {"level":2,"title":"6.2.1 Links 链接","page":6}
]}
```

> 注：解析器输出的 `page` 是 0-based 页索引；PDF 物理页 = 索引 + 1。

**书签与 TOC 域相互独立**：TOC 不刷新也照样有完整书签，层级来自标题的 outline level。这一点对两遍法至关重要——第一遍 PDF 可以直接从书签拿到「标题 → 页」映射。

### 1.5 发现 3：两遍法（B）实测可行

流程与实测：

1. **第一遍 DOCX**：完整缓存目录（34 条，页码占位 `00`，行数与最终一致，超链接锚点已就位）→ 转 PDF#1；
2. **解析 PDF#1 outline**：按文档顺序得到 34 个标题的 0-based 页索引，+1 得到物理页码（4–8）；
3. **回填页码**：把页码写回同一份 DOCX 的目录缓存结果（行数/缩进/制表位不变，只改数字）；
4. **第二遍转换**：PDF#2 的目录直接显示回填页码（LibreOffice 不刷新，因此缓存值原样保留，正是我们要的）；
5. **校验**：PDF#1 与 PDF#2 的分页完全一致，目录页码与书签页码逐条相等。

第一遍 outline → 页码映射（`filltoc.mjs` 输出，节选）：

```json
{"outlineCount":34,
 "numbers":{"1":4,"2":4,"3":4,"4":4,"5":4,"6":4,"7":4,
            "8":5,"9":5,"10":5,"11":5,"12":5,"13":5,
            "14":6,"15":6,"16":6,"17":6,"18":6,"19":6,"20":6,
            "21":7,...,"27":7,"28":8,...,"34":8}}
```

第二遍 DOCX 生成 + 转换：

```powershell
node docconvert\_spike\filltoc.mjs docconvert\_spike\out\c-cached-noupdate.json docconvert\_spike\out\pass1-numbers.json
node docconvert\_spike\mkdocx.mjs docconvert\_spike\out\e-pass2.docx --toc=cached --update-fields=false --numbers=docconvert\_spike\out\pass1-numbers.json
node "$KIT\lib\cli.js" convert --input <abs>\e-pass2.docx --output <abs>\e-pass2.pdf --timeout-ms 180000
```

```text
{"ok":true,...,"cachedNumbers":34,"headings":34}
{"backend":"native","missingFonts":[],"outputPath":"...\\e-pass2.pdf"}
pass2 exit=0
```

PDF#2 目录页原文（节选，页码已回填）：

```text
===== PAGE 2 =====
目录
1 Introduction  引言 ............................................................................................................................. 4
1.1 Background  背景 ...................................................................................................................................... 4
1.1.1 Scope  范围 .............................................................................................................................................. 4
...
2.2.1 Offline  离线 ............................................................................................................................................. 5
3 Implementation  实现 ....................................................................................................................... 5
...
第  2 页
===== PAGE 3 =====
4.2 Reproducibility  可复现 ............................................................................................................................ 7
...
6.2.1 Links  链接 ................................................................................................................................................ 8
第  3 页
```

校验脚本 `docconvert/_spike/verifytoc.mjs` 逐条比对「PDF 目录文本页码」与「outline 页索引 + 1」，并比对两遍分页，全部通过：

```json
{"checks":[
  {"name":"outline-count-equals-toc-entries","ok":true,"detail":{"outline":34,"tocEntries":34}},
  {"name":"page-count-stable","ok":true,"detail":{"pass1":8,"pass2":8}},
  {"name":"outline-pagination-stable","ok":true,
   "detail":{"pass1":"3,3,3,3,3,3,3,4,4,4,4,4,4,5,5,5,...","pass2":"3,3,3,3,3,3,3,4,4,4,4,4,4,5,5,5,..."}},
  {"name":"all-toc-page-numbers-match-outline","ok":true,"detail":{"mismatches":[]}},
  {"name":"bookmarks-cover-three-levels","ok":true,"detail":{"levels":[0,1,2],"count":34}}
 ],
 "findings":[],
 "expectedNumbers":[4,4,4,4,4,4,4,5,5,5,5,5,5,6,...,8],
 "tocNumbers":[4,4,4,4,4,4,4,5,5,5,5,5,5,6,...,8]}
```

关键点：第一遍目录已占 2 页（PDF 共 8 页，正文从第 4 页开始），回填数字没有改变行数，第二遍分页与第一遍**逐项一致**（34/34）。这说明「占位行数 = 最终行数」的约束可以被满足，两遍法不是碰巧。

### 1.6 补充：时间与可复现性

- 单次 docx→pdf（8 页、含引擎启动）：**3,987 ms**（`Measure-Command` 实测）。两遍法额外成本 ≈ 4 s/次。
- 同一 DOCX 重复生成：**字节完全一致**（SHA256 `E7DFDE38…83B6`），DOCX 侧字节级可复现成立。
- 同一 DOCX 连续两次转 PDF：**字节不一致**（`0DF5BB6C…047D` vs `7A147C38…F04E`），差异来自 XMP `CreateDate`（`00:25:33` vs `00:30:21`）等时间戳；页面数/书签/目录内容不变 → **PDF 只能承诺版式与内容级可复现**，与裁决 ④ 一致。
- 视觉证据：`dsoffice render` 渲染目录页与正文页成功（A4 910×1287 @110dpi，`missingFonts:[]`）：`docconvert/_spike/out/render-003023/page-0001.png`（第 2 页目录）、`page-0002.png`（第 4 页正文首章）。

### 1.7 结论：B 两遍法可行（附工作量估计）

- **原生单遍（A）不可行**：LibreOffice 不刷新 TOC 域、不尊重 `w:updateFields`；不预置缓存 → PDF 目录是占位文字；预置缓存 → 页码只能是占位值。
- **两遍法（B）可行且已实测**：34 条 3 级标题、目录跨 2 页、两次分页完全稳定，页码 34/34 正确。
- **工作量估计（v1 实现）**：
  - PDF outline 解析（含 xref/对象流/书签树/页映射，纯 Node 内置模块）：**约 250–400 LOC，0.5–1 人日**（本次 spike 脚本已验证核心路径，可裁剪复用）；
  - 两遍编排 + 回填 + 稳定性校验 + 失败重试：**约 80–150 LOC，0.5 人日**；
  - 额外运行成本：**+1 次转换（约 4 s/文档）**。
- **必须写进 README/架构的约束**：
  1. 生成 DOCX 时目录必须是**完整缓存结果**（行数与最终一致，页码先占位），不能只留 1 行占位；
  2. 页码语义 = **PDF 物理页序号（1-based）**，封面与目录页计入；若未来做分节重新编号需另加偏移；
  3. 第二遍后必须校验「PDF#1 outline 页 == PDF#2 outline 页」，不一致时最多自动重试一次，仍不一致则输出警告并降级（保留目录但不保证页码）；
  4. DOCX 可继续写 `w:updateFields=true`（LibreOffice 忽略、Word 打开时会刷新），但**不得依赖它**；
  5. 目录超链接依赖标题书签（`w:bookmarkStart` + `w:hyperlink w:anchor`），本次实测 PDF 书签独立于 TOC 域，可同时满足 PDF 导航。

**对架构的直接影响（一句话）**：PDF 导出不是「DOCX→PDF」一步，而是「DOCX（完整目录缓存）→PDF#1→解析书签回填页码→PDF#2→分页校验」的确定性两遍管线；DOCX 与 PDF 共享同一份回填后的目录页码。

### 1.8 残余风险（Spike 1）

| 风险 | 影响 | 缓解 |
|---|---|---|
| 第二遍分页漂移（字体/行数变化） | 目录页码错位 | 回填只改右对齐页码数字，不改行数；两遍校验 + 最多重试一次 + 明确告警 |
| H4–H6 标题：TOC `\o "1-3"` 不收录，但 PDF outline 包含更深层 | 按顺序映射会错位 | **已实测（§1.9 补充）**：H1→outline level 0、H2→1、H3→2、H4→3、H5→4，严格对应；过滤 `level<=2` 后 34 条与目录 34 条一一匹配，深层标题不出现在目录页。实现按 outline level 过滤即可 |
| 同名标题重复 | 仅按标题匹配会歧义 | 用「文档顺序 + 过滤后层级」映射，不按标题唯一匹配 |
| Word 与 LibreOffice 分页不同 | DOCX 在 Word 中页码可能不同 | DOCX 写 `w:updateFields=true`；README 声明「PDF 页码以 LibreOffice 分页为准」 |

---


### 1.9 长文档收敛（50+ 页）实测

**目的**：验证两遍法在真实长文档规模（目录跨多页、页码两位数/三位数）下是否一次收敛，而不是只在小样本上成立。

**方法**：同一套实验脚本加 \`--chapters=50\`，生成 50 章 × 6 个标题（H1 50 / H2 100 / H3 150 = **300 条目录**），每章强制分页；流程与 §1.5 相同：缓存目录（页码占位 \`00\`）→ PDF#1 → 解析 outline → 回填页码 → PDF#2 → 校验。

命令：

\`\`\`powershell
node docconvert\_spike\mkdocx.mjs docconvert\_spike\out\g-long.docx --toc=cached --update-fields=false --chapters=50
node "$KIT\lib\cli.js" convert --input <abs>\g-long.docx --output <abs>\g-long-pass1.pdf --timeout-ms 300000
node docconvert\_spike\pdfinfo.mjs <abs>\g-long-pass1.pdf --json=<abs>\g-long-pass1.json
node docconvert\_spike\filltoc.mjs <abs>\g-long-pass1.json <abs>\g-long-numbers.json
node docconvert\_spike\mkdocx.mjs <abs>\g-long-pass2.docx --toc=cached --update-fields=false --chapters=50 --numbers=<abs>\g-long-numbers.json
node "$KIT\lib\cli.js" convert --input <abs>\g-long-pass2.docx --output <abs>\g-long-pass2.pdf --timeout-ms 300000
node docconvert\_spike\pdfinfo.mjs <abs>\g-long-pass2.pdf --json=<abs>\g-long-pass2.json
node docconvert\_spike\verifytoc.mjs <abs>\g-long-pass1.json <abs>\g-long-pass2.json
\`\`\`

**原始输出（关键字段）**：

\`\`\`json
{"ok":true,"tocMode":"cached","updateFields":false,"cachedNumbers":0,"headings":300}
{"backend":"native","missingFonts":[],"outputPath":"...\\g-long-pass1.pdf"}
pass1 exit=0 ms=4269
{"pages":65,"outline":300,"levels":{"0":50,"1":100,"2":150},"firstContentPage":16,"lastOutlinePage":65}
{"outlineCount":300, "numbers": {"1":16, ..., "300":65}}
{"ok":true,"cachedNumbers":300,"headings":300}
{"backend":"native","missingFonts":[],"outputPath":"...\\g-long-pass2.pdf"}
pass2 exit=0 ms=4682
\`\`\`

\`\`\`json
{"checks":[
  {"name":"outline-count-equals-toc-entries","ok":true,"detail":{"outline":300,"tocEntries":300}},
  {"name":"page-count-stable","ok":true,"detail":{"pass1":65,"pass2":65}},
  {"name":"outline-pagination-stable","ok":true,
   "detail":{"pass1":"15,15,15,15,15,15,16,16,...,64,64,64","pass2":"15,15,15,15,15,15,16,16,...,64,64,64"}},
  {"name":"all-toc-page-numbers-match-outline","ok":true,"detail":{"mismatches":[]}},
  {"name":"bookmarks-cover-three-levels","ok":true,"detail":{"levels":[0,1,2],"count":300}}
 ],
 "findings":[],
 "tocPageList":[2,3,4,5,6,7,8,9,10,11,12,13,14,15],
 "tocEntries":300,
 "firstEntries":[{"title":"1 Chapter 1 章节","number":16,"raw":"1 Chapter 1  章节 ...... 16"}],
 "lastEntries":[{"title":"50.2.1 Topic 主题三","number":65,"raw":"50.2.1 Topic  主题三 ...... 65"}]}
\`\`\`

**指标汇总**

| 指标 | 结果 |
|---|---|
| 样本规模 | 300 个标题（H1 50 / H2 100 / H3 150），65 页，目录占 **14 页**（第 2–15 页），正文第 16–65 页 |
| 目录条目数 | 300（outline 300，目录页 300，1:1） |
| 页码一致率 | **300/300 = 100%**（目录文本页码 = outline 页索引 + 1；无 mismatch） |
| 两遍分页一致性 | **完全一致**（65 页；300 条 outline 页序逐项相同） |
| 总耗时（两次转换） | **8,951 ms**（pass1 4,269 ms + pass2 4,682 ms；不含 DOCX 生成/解析，<1 s） |
| 重试次数 | **0**（首轮即收敛，未触发重试） |
| 页码位数变化 | 占位 \`00\`（2 位）→ 实际 16–65（2 位），未改变行数与分页 |

**1.9 补充：H4/H5 的 outline 层级与过滤验证**

在 34 条标题样本上追加 H4×2、H5×1 后重跑（\`--deep=true\`，目录仍只收录 1–3 级）：

\`\`\`json
{"outlineTotal":37,"outlineFiltered":34,"tocEntries":34,"deepInToc":[],
 "numberMismatches":[],"levelCounts":{"0":6,"1":12,"2":16,"3":2,"4":1}}
\`\`\`

→ **PDF outline level 严格对应标题级别（H1→0 … H5→4）**；按 \`level<=2\` 过滤后恰好还原目录条目集（34/34），页码仍全部匹配，H4/H5 不出现在目录页。实现用「过滤 level 后的 outline 顺序」映射目录条目即可，不需要按标题文本做唯一匹配。

**结论**：两遍法在 65 页 / 300 条目录 / 目录跨 14 页的规模下**一次收敛、零重试**，页码一致率 100%，分页两遍完全一致。实现侧仍保留「校验不一致 → 自动重试 1 次 → 仍不一致则告警降级」的保护，因为真实文档的浮动图片、跨页表格等可能在 P0 测试中引入分页差异，本次 Spike 样本未覆盖这些元素。

## 2. Spike 2｜离线依赖解析

### 2.1 结论（先给判定）

| 问题 | 结论 |
|---|---|
| 本机能否完全离线开发与运行？ | **能**。当前网络探测失败（registry.npmjs.org 超时）状态下，kit 0.1.5 从 DSH npx 缓存直接解析，CLI 转换、Node ESM 动态 import、65 页长文档两遍法全部跑通。 |
| 目标机首次安装是否必须联网？ | **是（除非预置 kit）**。docconvert 不 vendored 引擎；全新目标机必须联网安装 kit + 平台引擎（tarball 约 68 MB，解压约 182 MB），或从别的机器复制 kit 目录 / 预置 npm 缓存 / 设置 `DOCONVERT_LIBREOFFICE_KIT`。 |
| 产品能否硬编码本机 kit 路径？ | **不能**。解析顺序固定为：env → 项目 node_modules → `npm root -g`（best-effort）→ npx 缓存扫描；每个候选都做 name/version/引擎校验，失败给出可操作错误。 |

### 2.2 环境与离线状态（实测）

```text
Node v24.19.0 / npm 11.17.0（kit engines: >=22.19.0 满足）
npm root -g = <npm-global>\node_modules   （其中无 kit）
npm cache   = <npm-cache>
npm registry= https://registry.npmmirror.com
npx 缓存    = <npm-cache>\_npx\{<hash>, <hash-b>}
网络探测    = NET_FAIL 基础连接已经关闭: 接收时发生错误。  （Invoke-WebRequest https://registry.npmjs.org/-/ping，5s）
```

```json
// _npx/<hash>/package.json（DSH 安装清单）
{"dependencies":{"@deepseek-ai/dsh":"^0.2.1-rc.2"},
 "_npx":{"packages":["@deepseek-ai/dsh@0.2.1-rc.2"]}}
```

kit 与其依赖、平台引擎都在该 npx 树内：

```text
@deepseek-ai\libreoffice-kit           => True  name=@deepseek-ai/libreoffice-kit version=0.1.5
@deepseek-ai\libreoffice-kit-win32-x64 => True  name=@deepseek-ai/libreoffice-kit-win32-x64 version=0.1.5
fflate => 0.8.3   fontkit => 2.0.4   koffi => 3.1.1   saxes => 6.0.0
engine files=735 bytes=190,868,740 MB=182
```

> 注意：本机缓存里同时存在 kit 0.1.2（另一个 npx 目录）与 0.1.5。解析器必须**精确匹配 0.1.5**，不能“找到就用”。

### 2.3 解析顺序设计与实测

**顺序（产品实现）**

1. 环境变量 `DOCONVERT_LIBREOFFICE_KIT`（显式覆盖，最高优先级；仍做校验）；
2. 项目 **安装目录**（不是 CWD）向上每一级的 `node_modules/@deepseek-ai/libreoffice-kit`（兼容全局安装、workspace 提升）；
3. `npm root -g` 结果拼接（**best-effort**：子进程不可用时跳过，不阻塞）；
4. npm npx 缓存：Windows `%LOCALAPPDATA%\npm-cache\_npx\*\node_modules\@deepseek-ai\libreoffice-kit`；POSIX `~/.npm/_npx/*/node_modules/...`，按目录 mtime 倒序尝试。

**候选校验**（全部通过才可用）：`package.json` 的 `name` 精确匹配、`version === "0.1.5"`、`lib/cli.js` 与 `lib/index.js` 存在、同 `node_modules` 下的平台引擎包（本机 `libreoffice-kit-win32-x64`）存在且版本 0.1.5。任一失败记录原因并继续下一个候选。

**原型脚本** `docconvert/_spike/resolve-kit.mjs` 实测（无硬编码绝对路径，路径来自 env/LOCALAPPDATA/npm）：

```text
--- D1: 无 env，projectRoot=TEMP（无项目 node_modules）---
"chosen": {"source":"npx-cache",
           "path":"<npm-cache>\\_npx\\<hash>\\node_modules\\@deepseek-ai\\libreoffice-kit",
           "valid":true,"version":"0.1.5",
           "enginePath":"...\\@deepseek-ai\\libreoffice-kit-win32-x64","engineVersion":"0.1.5"}
"candidates":[
  {"source":"project:node_modules","valid":false,"reason":"ENOENT ..."},
  {"source":"npm-root-g","valid":false,"reason":"ENOENT ..."},
  {"source":"npx-cache","npxHash":"<hash>","valid":true},
  {"source":"npx-cache","npxHash":"<hash-b>","valid":false,"reason":"version mismatch: 0.1.2"}
]
exitD1=0

--- D2: projectRoot = 某个含 node_modules 的安装根 ---
"chosen": {"source":"project:node_modules","version":"0.1.5","engineVersion":"0.1.5"}   exitD2=0

--- D3: DOCONVERT_LIBREOFFICE_KIT=<kit dir> ---
"chosen": {"source":"env:DOCONVERT_LIBREOFFICE_KIT","version":"0.1.5"}                exitD3=0
```

说明：
- D2 用 npx 安装根作为 `projectRoot` 验证“项目 node_modules 优先于 npx 扫描”；沙箱拒绝创建 junction（`New-Item -ItemType Junction → Access is denied`），因此没有另建假项目目录，但候选顺序与路径拼接已被实测覆盖。
- `npm root -g` 在本会话中由 Node `spawnSync` 调用时被沙箱拒绝（`EPERM/EINVAL`），解析器把它当 best-effort；纯文件系统的 env / 项目 / npx 三条路径已足够跑通（这也是本机离线可用的关键）。
- 在普通 PowerShell 中 `npm root -g` 正常返回 `<npm-global>\node_modules`（其中无 kit，`Test-Path → False`）。

**扫描伪代码（给实现）**

```js
function resolveKit({ installRoot, platformPackage }) {
  const candidates = [];
  if (process.env.DOCONVERT_LIBREOFFICE_KIT)
    candidates.push({ source: "env", dir: process.env.DOCONVERT_LIBREOFFICE_KIT });
  for (const root of ancestorDirs(installRoot))            // 安装目录向上，不依赖 CWD
    candidates.push({ source: "project", dir: join(root, "node_modules/@deepseek-ai/libreoffice-kit") });
  const globalRoot = trySpawnSync("npm", ["root", "-g"]);   // 失败则跳过，不抛错
  if (globalRoot) candidates.push({ source: "global", dir: join(globalRoot, "@deepseek-ai/libreoffice-kit") });
  for (const npxDir of npxCacheDirs().sortByMtimeDesc())    // %LOCALAPPDATA%\npm-cache\_npx\* / ~/.npm/_npx/*
    candidates.push({ source: "npx-cache", dir: join(npxDir, "node_modules/@deepseek-ai/libreoffice-kit") });
  for (const c of candidates) if (isValidKit(c.dir, "0.1.5", platformPackage)) return c;
  throw new Error("libreoffice-kit 0.1.5 not found; install it or set DOCONVERT_LIBREOFFICE_KIT");
}
```

### 2.4 package.json 依赖声明（建议写法）

```json
{
  "name": "docconvert",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22.19.0" },
  "bin": { "docconvert": "bin/docconvert.js" },
  "dependencies": {
    "@deepseek-ai/libreoffice-kit": "0.1.5"
  }
}
```

- **精确版本**（无 `^` / `~`）：保证不同机器拿到同一 kit；平台引擎由 kit 的 `optionalDependencies` 按 os/cpu 自动选择（win32-x64 / win32-arm64 / darwin-* / wasm），无需在 docconvert 里重复声明。
- 提交 `package-lock.json` 锁定 kit 及其传递依赖（fflate/fontkit/koffi/saxes 等），满足裁决 ②“除 kit 外零第三方运行时依赖”的边界。
- 不建议把引擎包写进 `dependencies`：会强制所有平台下载不匹配的包；`optionalDependencies` 由 npm 按平台过滤。

### 2.5 跨目录 CLI 与 Node ESM 动态 import（实测）

**A. 从 `docconvert/` 之外的普通目录调用 CLI**（CWD = `%TEMP%\dsh-8Mhoi7`，输入/输出均为绝对路径）：

```text
CWD=<temp>\dsh-8Mhoi7
node "$KIT\lib\cli.js" convert --input <abs>\e-pass2.docx --output <abs>\outside-cwd-003911.pdf
{"backend":"native","missingFonts":[],"outputPath":"...\\outside-cwd-003911.pdf"}
exitA=0 exists=True bytes=234076
```

**B. Node ESM 动态 import**（`esm-import.mjs`，同样从 TEMP 运行）：

```json
{"cwd":"<temp>\\dsh-8Mhoi7",
 "entry":"...\\libreoffice-kit\\lib\\index.js",
 "exportNames":["CONVERSION_FORMATS","ConversionError","ENGINE_VERSION","ENGINE_VERSIONS","IMAGE_FORMATS","createConverter","createConverterFactory","discoverRuntime"],
 "engineVersion":"0.1.5",
 "engineVersions":{"darwin-arm64":"0.1.5","darwin-x64":"0.1.5","linux-arm64-glibc":"0.1.1","linux-x64-glibc":"0.1.1","win32-arm64":"0.1.5","win32-x64":"0.1.5","wasm":"0.1.5"},
 "backend":"native",
 "result":{"backend":"native","missingFonts":[]},
 "outputExists":true}
exitB=0
```

→ **两种集成方式都可行**：CLI（一次 Node 进程 + JSON stdout）与 API（进程内 `createConverter` / `converter.convert` / `dispose`）。API 方式少一次进程启动，且可直接拿到 `missingFonts`；CLI 方式契约更简单、便于 `doctor` 自检与隔离崩溃。

**C. 输出已存在时**（kit README 声明独占创建、绝不覆盖）：

```text
node "$KIT\lib\cli.js" convert --input <abs>\e-pass2.docx --output <abs>\e-pass2.pdf
exitC=1
stderr: {"code":"failed","error":"EEXIST: file already exists, open '...\\e-pass2.pdf'"}
existingBytes=234076   （原文件未被修改）
```

→ docconvert 必须：先写到本次运行独有的临时输出路径，成功后再 rename/替换；不能复用固定输出名，也不能把 EEXIST 当成功。

### 2.6 退出码与 stdout JSON 契约（实测）

| 场景 | exit | 输出位置 | 结构 |
|---|---|---|---|
| `convert` 成功 | 0 | stdout（单行 JSON） | `{"backend":"native","missingFonts":[],"outputPath":"<abs>"}` |
| `convert` 失败（含 EEXIST） | 1 | stderr（单行 JSON） | `{"code":"failed","error":"..."}` |
| `capabilities` | 0 | stdout | `{"runtime":{version,backend,cliPath,nodeApiPath},"conversions":[...],...}` |
| Node API 成功 | — | 返回值 | `{"backend":"native","missingFonts":[]}`（无 outputPath） |
| Node API 失败 | — | throw `ConversionError` | `error.code` ∈ invalid-document / unsupported-format / input-too-large / output-too-large / invalid-output / timeout / unavailable / failed；文件系统错误（EEXIST 等）原样冒泡 |

> 退出码只有 0/1 两种（CLI 层）；docconvert 需要在此基础上定义自己的退出码（如 2 输入错误、3 引擎缺失、4 转换失败），并把 kit 错误码映射成用户可读信息。

### 2.7 npm 缓存与“首次安装是否必须联网”

对 `%LOCALAPPDATA%\npm-cache\_cacache` 的只读扫描（`cache-scan.mjs` / `cache-deps.mjs`，未安装任何东西）结果：

| 缓存对象 | 大小 | content 存在 |
|---|---|---|
| `libreoffice-kit-0.1.5.tgz` | 104,240 B | ✅ |
| `libreoffice-kit-win32-x64-0.1.5.tgz` | 71,367,942 B（约 68 MB） | ✅ |
| kit 各平台包 packument（kit/win32-x64/win32-arm64/darwin-*/wasm） | 15–95 KB/条 | ✅（版本可离线解析） |
| 直接依赖 tarball：fflate 0.8.2/0.8.3、fontkit 2.0.4、koffi 3.1.1 + @koromix/koffi-win32-x64、saxes 6.0.0、restructure、brotli、unicode-properties、tiny-inflate、base64-js、clone、pako | — | ✅ |

结论：
- **本机**：kit + 引擎 + 依赖字节都在 npm 缓存里，因此“完全离线开发与运行”成立（本次所有实测均无网完成）。按纪律**未执行** `npm install --offline`，不宣称安装命令已实测。
- **全新目标机**：没有 kit、没有缓存时，首次安装必须联网（registry 或镜像），下载 kit + 平台引擎；之后可离线。若目标机已安装 DSH（其 npx 缓存自带 kit 0.1.5），则 docconvert 可零安装、零联网运行——这是本项目最现实的“零配置”路径。
- 缓存扫描还发现 0.1.2 的 kit/引擎 tarball，说明缓存可能长期保留旧版本；解析器按版本精确选择，不按“最新 mtime”盲选（mtime 只用于加速遍历）。

### 2.8 README 安装说明要点（可直接采用）

1. **运行时要求**：Node.js ≥ 22.19.0；Windows x64 需安装 Microsoft Visual C++ v14 Redistributable（kit 不捆绑）；磁盘预留 ≥ 250 MB（引擎解压后 182 MB）；首次转换会建立字体元数据缓存。
2. **推荐安装**：`npm install -g docconvert`（首次联网，约 70 MB 下载）；之后 `docconvert a.md` 可离线运行。
3. **DSH 用户零安装**：docconvert 自动发现 DSH npx 缓存中的 `libreoffice-kit@0.1.5`，无需 `npm install`、无需联网；`docconvert doctor` 显示 kit 来源（env / project / global / npx-cache）与引擎版本。
4. **离线机器**：复制 kit 目录及其同级的平台引擎包到目标机任意位置，设置 `DOCONVERT_LIBREOFFICE_KIT=<kit 目录>`；或预置 npm 缓存后使用在线安装。禁止写死 `%LOCALAPPDATA%\npm-cache\_npx\...`。
5. **校验与报错**：找不到 kit 时给出三种修复路径（安装 / 设置 env / 复用 DSH 缓存）与当前已检查的候选列表；kit 存在但引擎缺失时提示对应平台包名与安装命令。
6. **输出安全**：kit 独占创建、不覆盖已有文件；docconvert 使用临时输出名并在成功后原子替换，失败清理临时文件。

### 2.9 残余风险（Spike 2）

| 风险 | 影响 | 缓解 |
|---|---|---|
| npx 缓存目录 hash 不稳定，可能被 `npm cache clean` / npx 清理 | 离线解析失效 | 视为 opportunistic；env / 项目安装为主路径；`doctor` 明确来源；README 给离线复制方案 |
| 多版本共存（本机 0.1.2/0.1.5） | 误用旧版 | 精确版本校验 + 失败候选列表；0.1.2 已实测被跳过 |
| `npm root -g` 子进程在受限环境被拒绝 | 全局安装难发现 | best-effort，失败不阻塞；纯文件系统候选兜底 |
| 只实测 win32-x64 native | macOS/Linux 未验证 | README 声明支持矩阵；doctor 在目标平台校验引擎；wasm 仅 Linux |
| 引擎包损坏/缺 DLL/缺 VC++ 运行库 | createConverter 以 `unavailable` 拒绝 | 捕获并映射为可操作错误；doctor 预检 capabilities |
| `DOCONVERT_LIBREOFFICE_KIT` 指向不可信目录 | 执行该目录代码 | 视为用户显式信任；README 说明只指向可信安装 |

### 2.10 对架构的直接影响（一句话）

kit 的“发现”必须先于“转换”成为一个独立、可测试的模块（env → 项目 → 全局 → npx 缓存，精确版本 + 引擎校验，纯文件系统优先、`npm root -g` best-effort），并配套 `docconvert doctor`；本机离线路径成立，但全新目标机的**首次安装必须联网或预置 kit**，README 与错误信息必须写清这一点。

---

## 3. 实验产物清单（`docconvert/_spike/`，不进入交付物）

| 文件 | 用途 |
|---|---|
| `mkdocx.mjs` | 手写 OOXML/ZIP 生成实验 DOCX（TOC 占位/缓存、updateFields、页码回填） |
| `pdfinfo.mjs` | 纯 Node PDF 解析：对象/页树/outline/逐页文本（含 ToUnicode） |
| `filltoc.mjs` | outline → 1-based 页码映射 JSON |
| `verifytoc.mjs` | 目录页码与 outline 逐条校验、两遍分页稳定性校验（自动识别目录页范围） |
| `check-h4.mjs` | H4/H5 深层标题的 outline 层级过滤与页码校验 |
| `resolve-kit.mjs` | kit 解析顺序原型（env → 项目 → 全局 → npx 缓存 + 版本/引擎校验） |
| `esm-import.mjs` | 从任意 CWD 用 ESM 动态 import 调用 kit Node API |
| `cache-scan.mjs` / `cache-deps.mjs` | 只读扫描 npm cacache：kit/引擎/依赖 tarball 与 packument 是否可离线使用 |
| `probe-npm.mjs` | 探测 Node 子进程调用 `npm root -g` 在沙箱中的行为（EPERM） |
| `out/*.docx` `out/*.pdf` `out/*.json` `out/render-*` | 4 个小样本变体、H4/H5 样本、50 章 65 页长文档（g-long-*）、两遍法输入输出、解析报告、渲染 PNG |

---

*Spike 1（含 1b 长文档）与 Spike 2 均已完成；所有结论均附命令与原始输出摘录，实验产物不进入交付物。闸门 1 后如无需审计证据，可整体删除 `docconvert/_spike/`（报告中的命令与输入结构足以复现），不影响交付物。*
