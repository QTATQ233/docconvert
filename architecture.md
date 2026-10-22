# docconvert 架构设计（v1.0 · 闸门 1 冻结）

> **状态**：**FROZEN**（2026-10-22 定稿）｜**变更**：任何签名、错误码、模板 token、依赖版本、决策路线的变更，必须回到技术负责人裁决并同步 requirements.md / test-cases.md（见 §12）。
> **角色**：架构师（docconvert 团队，task t6 / attempt 468c3f42）｜**阶段**：0.5｜**关卡**：闸门 1（唯一允许阻塞后续开发的关卡）。
> **上游输入（只读）**：`drafts/architect-brief.md`（6 项缺陷 + 6 项决策）｜`requirements.md`（140 条 / P0 99）｜`spike-report.md`（Spike 1 / 1b / 2）｜`test-cases.md`（35 条 / P0 12）｜`external-tools-survey.md`（薄封装候选评估）｜`workspace-survey.md`（复用/改造/新开发依据）｜`drafts/interface-contract-v0.md`（签名骨架）｜`drafts/gate1-checklist.md`（评审清单）。
> **下游消费者**：开发（照 §3 签名实现、照 §4 token 只读模板）、测试（附录 A 追踪矩阵 + 附录 F 参数名映射）、README（§5 D4/D5、§7.2、§9 的「必须写进 README」清单）。
> **用户裁决**：2026-10-22 08:05 选 **C 新开发**（薄封装不采用，但必须保留评估过程，见 §6）。

---

## 0. 一页概览

### 0.1 一句话架构

**Node 24 单进程 CLI：输入 → 归一化 → AST → 自写 OOXML 生成 DOCX（只读内置模板）→ 同一份 DOCX 经 LibreOffice Kit 导出 PDF；长文档用「完整目录缓存 + 两遍导出 + 书签回填 + 收敛校验」拿到与 PDF 物理页 100% 一致的目录页码；DOCX 字节级可复现、PDF 版式与内容级可复现；除 kit 外零第三方运行时依赖。**

### 0.2 冻结结论速览

| # | 结论 | 冻结处 |
|---|---|---|
| 1 | PDF 引擎 = `@deepseek-ai/libreoffice-kit@0.1.5`（`dsoffice`）；PDF **只从 DOCX 导出**，不从 AST/HTML 渲染 | §5 D1、§2.1 |
| 2 | DOCX 生成 = **自写 OOXML + Node 内置 `zlib`**；不引入 `docx` 库、不走 Pandoc | §5 D2 |
| 3 | 可复现 = **DOCX 字节级** + **PDF 版式与内容级**（不承诺 PDF 字节一致） | §5 D3、§8 |
| 4 | 零配置边界 = 用户侧只需 **Node ≥ 22.19**；其余由 npm 安装期拉取；无配置、无模板、无样式参数 | §5 D4、§9 |
| 5 | TOC 页码 = **B 两遍法**（P0）；目录仅 H1–H3，PDF 书签 H1–H6 | §5 D5、§7.1 |
| 6 | `w:updateFields` = **不带**（禁止默认弹窗）；页码由程序实测回填；DOCX 内保留 TOC 域 + 标题书签，用户可手动 F9 | §7.2 |
| 7 | 两遍法后处理 = 独立模块 `src/toc/**`，**330–550 LOC**，独立预算，不挤占 docx-render / markdown-parser | §7.3 |
| 8 | 模板 `templates/reference.docx` 只读；开发**不得**硬编码字号/边距/颜色；CLI **无**任何样式或模板覆盖参数 | §4 |
| 9 | 退出码 = **0/1/2/3/4/5**（参数 2、输入 3、依赖 4、转换 5、内部 1）；错误码取 requirements §9.1 的 kebab-case 集合 | §3.11、附录 F |
| 10 | 批处理**串行**、按输出相对路径 Unicode 码点升序；`--continue-on-error` 下退出码仍非 0 | §9.3 |
| 11 | 薄封装（markdownforge@0.0.4）**不采用**，理由见 §6（引 t5 §3.1 与用户裁决 C） | §6 |
| 12 | 除 kit 外**零第三方运行时依赖**，开发期也零 npm 依赖（`node:test`），无构建步骤（纯 ESM JS + JSDoc 契约） | §5 D6、dependencies.md |

### 0.3 关键数字（全部有实测或需求出处）

| 指标 | 值 | 来源 |
|---|---|---|
| 需求总量 / P0 | 140 条 / 99 条，本文件 **140/140** 全部落模块与验证方式 | requirements.md §15.1、附录 A |
| 两遍法长文档实测 | 65 页 / 300 条目录 / 目录跨 14 页 / **页码 300/300 = 100%** / 两遍分页完全一致 / 8,951 ms / **重试 0** | spike-report.md §1.9 |
| 两遍法小样本 | 34 条 3 级标题 / 目录跨 2 页 / 34/34 正确 / 单次转换约 3,987 ms | spike-report.md §1.5、§1.6 |
| DOCX 可复现 | 同一 DOCX 重复生成**字节完全一致**（SHA256 `E7DFDE38…83B6`） | spike-report.md §1.6 |
| PDF 可复现 | 同一 DOCX 两次导出**字节不同**（仅 XMP CreateDate 等时间戳），页数/书签/目录不变 | spike-report.md §1.6 |
| kit 体积 | kit tarball 104 KB；平台引擎 tarball **71,367,942 B（约 68 MB）**；解压 **190,868,740 B（182 MB）** | spike-report.md §2.7、§2.2 |
| 两遍法额外成本 | +1 次转换（约 **+4 s/文档**），预算上限 +5 s（REQ-NFR-004） | spike-report.md §1.6、§1.7 |

---

## 1. 六项缺陷的正面回应

> 本节逐条回答 `drafts/architect-brief.md` `一` 的每个子问题，**不回避、不只贴链接**。汇总表见附录 C。

### 缺陷 1｜PDF 页码不可控（浏览器路线）

**证据（brief reference:0）**：md2pdf-skill 默认关闭页眉页脚，并明确声明「页码属于分页器行为，CSS 无法可靠控制，目前不支持」（复核：external-tools-survey.md §2.3 记录其 FAQ 原文「页码不支持」）。

**Q1：docconvert 的 PDF 路线是否必须支持页码？**

**是，且是 P0。** 依据：`REQ-LAY-012`（除封面外每页页脚居中 PAGE 域，数值 = 物理页序，P0）、`REQ-TOC-001/003/004/009`（目录条目页码 = 标题落页，P0）、`REQ-LAY-013` 视觉清单 V7/V9（页码连续、目录页码右对齐成一条竖线）。页码不是装饰项，它是「目录可用」的前提。

**Q2：选哪条引擎路线能可靠生成页码？**

**LibreOffice Kit 0.1.5（native 后端，LibreOfficeDev 26.8.0.3）。** 页码由分页器在排版时生成（页脚 PAGE 域 → 物理页序），不依赖 CSS 或阅读器。实测证据：spike-report.md §1.3 导出的 PDF 每页文本层均含「第 N 页」页脚；§1.9 的 65 页样本页脚与目录页码 100% 对齐。

**Q3：如果选浏览器路线，页码靠后期处理还是接受 v1 无页码？**

**两者都不选——浏览器路线整条否决。** 理由三条：
1. **后期写入页码解决不了目录页码。** 目录页码要求的是「标题落在第几页」这一**分页事实**；用 pypdf 在 PDF 上盖页码，只能得到「第 N 页」的角标，拿不到「某标题在第 N 页」的映射，也无法回填到 DOCX（DOCX 与 PDF 会变成两套页码来源）。
2. **浏览器路线要维护第二套版式。** DOCX 由 OOXML 生成、PDF 由 HTML/CSS 打印，同一内容两套排版规则，直接违背「内容与排版分离」与工作区盘点 §1.2 的结论。
3. **与裁决⑤ 冲突**（浏览器/Chromium 不进 v1，见 §附录 B）。

**Q4：页码问题是否构成选 LibreOffice Kit 而非浏览器路线的决定性理由？**

**是（联合缺陷 4 构成双证据）。** 单看页码，理论上可用「浏览器出 PDF + 后处理盖页码」凑出一个更弱的方案；但叠加缺陷 4（LibreOffice 不刷新 TOC 域）后，只有「DOCX 是唯一版式源 + 分页事实可从 PDF 书签读回」这条链路能同时满足页码与目录两项 P0。这正是 spike-report.md §1.4/§1.5 验证的路径：**PDF 书签天然覆盖全部标题层级**，与 TOC 域相互独立，因此第一遍 PDF 就是一台「分页测量仪」。

**落点**：§5 D1（PDF 引擎路线）、§3.6（pdf-render 签名）、§7.1（两遍法）。

### 缺陷 2｜零配置承诺与真实依赖的落差

**证据（brief reference:1/2）**：docconvert-cli 的 npm 页面把 Python 3.6+、Pandoc、xelatex 列为必需或仅 PDF 必需；markdownforge 声称 zero installation，但 README 仍写依赖 Pandoc（external-tools-survey.md §2.2 已核实其源码中 `checkPandocAvailability()` 恒返回可用，属文档滞后——这恰好说明「零配置」必须可被机器验证，而不是靠 README）。

**Q1：「零配置」承诺到什么程度？**

**承诺 = 「用户不需要手动安装或配置任何转换器、字体、模板、配置文件；安装 docconvert 之后，一条命令出两个文件」。前置条件只有一条：Node ≥ 22.19 已存在（且允许 `npm install` 安装期联网）。** 明确**不承诺**：目标机离线首次安装（见 Q3 与 §5 D4）；不承诺跨平台字体一致性。

判定方式（可机器验证，对应 REQ-NFR-006）：全新环境按 README 执行 `docconvert a.md` → 产出 `a.docx` + `a.pdf`，**零个参数、零个配置文件**（`REQ-TPL-004` 禁止读取任何用户配置）。

**Q2：PDF 必须依赖原生二进制，如何随 npm 分发？三平台体积与体验如何权衡？**

| 项 | 方案 | 体积 / 体验 |
|---|---|---|
| 分发方式 | 声明 `@deepseek-ai/libreoffice-kit@0.1.5` 为项目依赖（**精确版本**，无 `^`/`~`）；平台引擎由 kit 的 `optionalDependencies` 按 os/cpu 自动选择安装 | kit tarball 104 KB；平台引擎 tarball 约 **68 MB**，解压 **182 MB**（spike §2.7/§2.2） |
| 不做什么 | **不 vendored 引擎**（数百 MB 进仓库不现实）、**不要求用户预装 LibreOffice**（违背零配置，且本机系统 `soffice` 本就未安装） | workspace-survey.md §5.1 选项 A/B/C 的结论 |
| Windows x64（首要目标） | `libreoffice-kit-win32-x64@0.1.5`，native 后端 | 额外需 **Microsoft Visual C++ v14 Redistributable**（kit 不捆绑）；磁盘预留 ≥ 250 MB |
| macOS（12+） | `darwin-x64` / `darwin-arm64` 引擎包，native | 体积同量级；**未在本机实测**（风险 R-06） |
| Linux（glibc 2.31+） | 走 **wasm** 引擎（kit 的 linux 引擎版本为 0.1.1，与 0.1.5 不同包） | 体积更大、性能更低；**v1 只承诺 docx 可用 + pdf 给出明确报错/hint**（REQ-PLAT-002 为 P1） |
| 离线目标机 | 复制 kit 目录 + 同级平台引擎包 → 设 `DOCONVERT_LIBREOFFICE_KIT`；或预置 npm 缓存 | spike §2.8 第 4 条；**禁止硬编码 npx 路径** |
| DSH 用户 | 直接复用 DSH npx 缓存中的 kit 0.1.5（解析顺序第 4 位） | 零安装、零联网（spike §2.3 D1 实测） |

**Q3：零配置与可复现冲突时，谁优先？**

**可复现优先。** 具体三条取舍：① kit 锁死 `0.1.5`，**不追新、不自动升级**（即使新版本更小更快）；② 宁可首次安装多下 68 MB，也不做「有就用系统 LibreOffice、没有就降级」的模糊路径（版本不可控 = 输出不可复现）；③ 安装体积/首次联网体验让位于确定性，README 提前声明。

**落点**：§5 D4、§10.2（打包）、dependencies.md。

### 缺陷 3｜Pandoc 路线在中英混排下的表格与样式可靠性不足

**证据（brief reference:3/4）**：Pandoc 转 DOCX 常见列宽塌陷、边框丢失、中文换行异常、自定义样式消失；docxaudit 指出 Pandoc 管线「报告成功但仍然丢东西」，表格缺 `w:tblGrid` 时列宽塌缩。

**Q1：是否继续走 Pandoc 做 DOCX 生成？**

**否。** 三条硬理由，任一条即足够：
1. **表格 P0 不可满足。** `REQ-LAY-009` 要求「固定布局 + 列宽按内容加权且总和 = 17.0cm + 表头跨页重复 + 行不跨页 + 单元格内边距 30/60 twips」。Pandoc 的 docx writer 不生成可控的 `w:tblGrid` 列宽与 `w:tblHeader`/`w:cantSplit` 组合，正是 docxaudit 记录的失败模式。
2. **中文 eastAsia 不可控。** `REQ-LAY-006` / `REQ-PLAT-003` 要求 `w:rFonts w:eastAsia="微软雅黑"` + 回退链；Pandoc 的字体处理以 `reference.docx` 为间接手段，无法逐 run 指定 eastAsia，也无法保证回退后仍记录「实际使用字体」。
3. **字节级可复现不可满足。** `REQ-REP-001` 要求 DOCX SHA-256 稳定；Pandoc 会写入 `docProps/core.xml` 的时间戳与自身的 generator 信息，且 ZIP 条目顺序/压缩参数不由我们控制。

**Q2：如果放弃 Pandoc，用 Node 原生 OOXML 生成（如 docx 库），如何覆盖标题、列表、表格、代码块、图片、中文断行的完整能力？缺失的能力如何补齐？**

**采用「自写 OOXML 薄层」而不是 `docx` 库**（理由见 Q3 与 §5 D2）。能力覆盖表：

| 能力 | 实现方式（自写 OOXML） | 验收用例 |
|---|---|---|
| 标题 H1–H6 | `w:pStyle w:val="Heading1..6"` + `w:outlineLvl`（同时满足 Word 导航与 PDF 书签） | TC-H-01、TC-H-02 |
| 段落 / 软换行 / 硬换行 | `w:p` + `w:br`；CJK 拼接规则在 AST 阶段完成 | TC-CJ-01、REQ-MD-003 |
| 有序 / 无序列表（≤3 级） | `word/numbering.xml` 定义 `w:abstractNum` + `w:numPr`；层级用 `w:ilvl` | TC-TX-01、REQ-ELEM-08 |
| 表格（固定列宽/表头重复/行不跨页） | 显式 `w:tblGrid/w:gridCol` + `w:tblLayout type="fixed"` + `w:tblHeader` + `w:cantSplit` | TC-TB-01、TC-TB-02 |
| 代码块（等宽/底纹/硬折行） | `w:rFonts ascii/hAnsi="Consolas"` + `w:shd fill="F5F5F5"` + 按显示宽度切分 run | TC-CD-01、TC-CD-02 |
| 图片（PNG/JPEG，≤17cm，不放大） | `word/media/imageN.png` + `wp:extent`（EMU 换算自 px@96dpi） | TC-IM-01 |
| 中文断行 | 不做自定义断行：交给 LibreOffice/Word 的 kinsoku；我方只保证**文本不被改写**、**长英文词不丢字符**（代码块硬折行除外） | TC-CJ-02（P1） |
| 页脚 PAGE 域 | `word/footer1.xml` + `fldChar/instrText " PAGE "` | REQ-LAY-012、V7 |
| 目录（TOC 域 + 完整缓存 + 超链接） | `fldChar begin` → `instrText TOC \o "1-3" \h \z \u` → `separate` → N 段缓存条目 → `end`；条目含 `w:hyperlink w:anchor` | REQ-TOC-001/003、TC-LONG-TOC-CONV |

**Q3：在「复用 Pandoc」和「自写 OOXML 生成器」之间，用数据回答：Pandoc 能覆盖 v1 需求的百分之多少？**

**估算方法与口径**（必须先声明可信度）：Pandoc 未安装（workspace-survey.md §6.2 `Get-Command pandoc → NOT FOUND`），**本估算不是实测**，而是「140 条需求中与「生成产物形态」直接相关的 75 条」（OUT 9 + LAY 16 + ELEM 29 + TOC 10 + TPL 7 + REP 4）逐条对照 Pandoc 默认 docx writer 的能力面：

| 分类 | 条数 | 占比 | 说明 |
|---|---|---|---|
| 直接可满足（配合 `reference.docx` 或默认 writer） | ≈ 18 | **≈ 24%** | 段落、粗斜体、行内代码、链接、分隔线、图片基本嵌入等 |
| 需深度定制模板/后处理才能满足 | ≈ 22 | ≈ 29% | 标题字号（可借 reference.docx）、列表缩进、页脚域、页数基本正确性 |
| 结构性不可满足 | ≈ 35 | **≈ 47%** | 表格固定列宽/表头重复/行不跨页、eastAsia 逐 run 控制、代码块连续底纹与硬折行、TOC 完整缓存、`w:updateFields` 可控、DOCX 字节级可复现、CLI 禁止样式参数、日志字体实录 |

**结论对 ±10% 不敏感**：决定性的是第三类里的「全有或全无」项（表格固定列宽、TOC 缓存、DOCX 字节级），它们无法用模板弥补，只要有一条落在不可满足区，「复用 Pandoc」就不成立。**不可覆盖部分构成新开发的决定性理由。**

**Q4（对 Node DOCX 生态的追问见缺陷 6）**：本项结论 = 放弃 Pandoc；生成器自写（§5 D2）。

**落点**：§5 D2。

### 缺陷 4｜LibreOffice 不填充 TOC 页码（DOCX→PDF 路线）

**证据（brief reference:5/6）**：LibreOffice 从不填充目录页码，导出的 PDF 目录条目没有页码，除非读取方主动更新域；headless 导出不刷新 TOC 字段。**本机已实测确认**（spike-report.md §1.3）：变体 A（`w:updateFields=true`）与变体 B（false）产物完全相同，PDF 第 2 页仍是「（目录占位：转换时刷新）」；变体 C/D（预置 34 条缓存、页码 `00`）导出后页码仍是 `00`——**`w:updateFields` 对 LibreOffice 导出无任何影响**。

**Q1：PDF 从 DOCX 导出，TOC 页码问题是否在 v1 范围内？**

**在，且是 P0**（`REQ-TOC-003/004/005/009`、`REQ-LAY-013` V9；`15.2` 明确「TOC 长文档收敛与 DOCX 打开行为不得降级为 P1」）。

**Q2：采用哪条路径？① 两遍法 ② 生成阶段算好 ③ 降级无页码？**

**选 ① 两遍法（B），但把 ① 实现成「预置完整缓存 + 测量 + 回填」的确定性管线，而不是「先导出一份不完整 DOCX」。** 三条路径的裁决依据：

| 路径 | 可行性判定 | 证据 |
|---|---|---|
| ② 生成阶段算页码 | **不可能**：页码是分页结果，生成 DOCX 时没有分页器参与 | 常识 + spike §1.3（LibreOffice 只认缓存值） |
| ③ 降级无页码 | **不满足 P0**（REQ-TOC-004 要求 100% 一致；V9 要求页码右对齐成线） | requirements §6.3 把 C 列为未采用分支 |
| ① 两遍法 | **实测可行**：34/34（§1.5）、300/300 且 65 页一次收敛（§1.9） | spike-report.md §1.5、§1.9 |

两遍法的关键设计（与 spike 原始脚本的差异）：**第一遍的 DOCX 目录必须是「完整缓存」**——条目数、行数、缩进、制表位与最终完全一致，页码先用等宽占位 `00`。这样第二遍只替换数字文本，**目录占用的页数从第一遍起就是最终值**，分页才可能稳定（§7.1 不变量 I1–I4）。

**Q3：两遍法的收敛性如何保证（加页码后内容可能重排）？**

四条不变量 + 三级保护：
- **I1 行数不变**：占位与回填都只改「页码数字」这一段文本，不新增/删除段落，不改缩进与制表位。
- **I2 占位宽度足够**：占位用 `00`（2 位，等宽数字）；页码 ≤ 3 位时右对齐制表位吸收宽度变化，不触发换行。
- **I3 局部性**：目录区之外的正文与第一遍字节等价（同一 AST、同一模板、同一固定时间戳）。
- **I4 可验证**：第二遍导出后**逐条**比对「PDF#1 书签页 == PDF#2 书签页」与「目录页码 == PDF#2 书签页」。

三级保护（对应 REQ-TOC-005）：① 校验不一致 → **自动重试一次**（重新计算页码再导出）；② 重试后仍不一致 → **照常输出**，stderr 打 `WARN toc-not-converged`、日志 `toc.converged=false`、**退出码仍 0**（禁止静默）；③ 全程不阻塞 DOCX 交付。

**落点**：§5 D5、§7.1、§3.8（toc-two-pass 签名）。

### 缺陷 5｜「可复现」在现有工具中最多只是零星 flag

**证据（brief reference:8/9）**：SOURCE_DATE_EPOCH 是 PDF 可复现的标准机制但并非默认启用；PDF 默认含时间戳、随机对象 ID、哈希依赖的流，不处理不可能字节一致。**本机实测**：同一 DOCX 两次转 PDF 字节不一致（`0DF5BB6C…047D` vs `7A147C38…F04E`），差异来自 XMP `CreateDate`；页数/书签/目录不变（spike §1.6）。

**Q1：承诺到哪一层？**

| 格式 | 承诺层级 | 可判定判据 |
|---|---|---|
| DOCX | **字节级** | 同一程序版本 + 同一模板 + 同一输入，不同时间/outdir/CWD/机器路径 → SHA-256 完全相同（REQ-REP-001、TC-RP-01） |
| PDF | **版式与内容级** | 页数、页面尺寸、逐页文本逐字、目录页码全同；**不要求**字节一致（REQ-REP-002、TC-RP-02） |
| 日志 | 不参与可复现判定 | 日志含时间戳与耗时，但**不得**写入产物（REQ-REP-003/004） |

**Q2：如果承诺 DOCX 字节级，如何处理 ZIP 时间戳和 OOXML 中的随机 ID？**

三条硬规约（§8 详述）：① **ZIP 条目时间固定**为 `(1980-01-01 00:00:00)`（DOS date=33, time=0），条目顺序为**编译期常量数组**，压缩参数固定（`zlib.deflateRawSync` level 9、正文无 data descriptor、无 extra field）；② **不写任何随机 ID**：无 `w:rsid`、无随机 `docId`、关系 ID 按固定顺序生成 `rId1…rIdN`、编号 ID 从 1 递增；③ **core.xml 时间常量**：`created/modified = 2000-01-01T00:00:00Z`，`creator` 固定为 `docconvert`，`lastModifiedBy` 不写用户名，`app.xml` 的 `Application` 固定、`AppVersion` 取程序版本。

**Q3：kit 是否暴露 CreationDate / 对象 ID 的控制？**

**未暴露（实测结论）。** kit 0.1.5 的 CLI/Node API 只有 `convert`/`capabilities`，返回 `{backend, missingFonts, outputPath}`，没有元数据注入点（spike §2.6 的契约表）。因此 **PDF 字节级可复现只能降级为版式与内容级**，与裁决④ 一致；v1 **不使用** SOURCE_DATE_EPOCH（它对本路线无作用点），改为在 log 中记录足够复现版式的全部环境要素。

**Q4：conversion-log 必须记录哪些字段，才能让第三方独立验证可复现性？**

| 字段 | 位置 | 为什么足够 |
|---|---|---|
| 程序版本 `program.version` | file/run 记录 | 代码路径唯一性 |
| 模板版本 `template.version`（= `reference.docx` SHA-256 前 12 位） | file/run 记录 | 版式定义唯一性（REQ-TPL-003） |
| 引擎 `pdfKit.version` / `engine` / `backend` | file/run 记录 | PDF 分页器唯一性（0.1.5 + LibreOfficeDev 26.8.0.3） |
| 字体 `fonts.{latin,cjk,mono}`（**实际使用**，非配置值） | file/run 记录 | 字体集合直接改变分页 |
| 产物 `outputs[].sha256` / `bytes` | file 记录 | 第三方可重算比对（REQ-LOG-004） |
| `platform`（os/arch/node） | file/run 记录 | Node 内置 zlib 版本随 Node 变化，影响 DOCX 字节 |
| `toc`（`mode/passes/converged`） | file 记录 | 说明页码来源与是否降级 |
| `command`（原始 argv） | file/run 记录 | 输入口径唯一性 |

**验证协议（写进 README 与测试）**：第三方拿到 `conversion-log.jsonl` 后，(a) 重算产物 SHA-256 与 `outputs[].sha256` 比对；(b) 用同版本 kit 对同一 DOCX 重导 PDF，比较页数与逐页文本；(c) 用 `docconvert --version` 核对 7 行键值与日志一致。**这套协议不依赖任何私有状态。**

**落点**：§5 D3、§8、§3.11（log 结构）。

### 缺陷 6｜Node.js DOCX 生成生态存在「零依赖」可行选项，但成熟度需要评估

**证据（brief reference:10/11）**：`docx` 库是 Node 生成 DOCX 的主流选择，通过构建 OOXML 对象树生成文件，不依赖 LibreOffice/Word；`docx-lite` 等更轻量选项也在出现。

**Q1：如果选择 Node.js 原生 OOXML 路线，选哪个库？版本？许可证？**

**不选库：自写 OOXML 薄层（`src/docx/**`），只用 Node 内置 `zlib`。** 若未来复议，唯一候选是 `docx@9.x（MIT）`——生态证据：markdownforge@0.0.4 依赖 `docx ^9.5.1` 且能纯 Node 生成（external-tools-survey.md §2.2）。v1 复议前置条件写在 §11 R-03，不进入本版本。

**Q2：该库对表格列宽、合并单元格、代码块等宽字体、图片嵌入、中文换行的支持度如何？是否有「生成成功但 Word 打开异常」的案例？**

**本项证据不足，不猜。** 事实边界：① 未安装任何 npm 包（硬规则），因此**无法实测** `docx` 库的能力矩阵；② 已知的外部信号是 brief reference:4 的 docxaudit 结论（Pandoc 管线「报告成功但仍然丢东西」）——那是 Pandoc 而非 `docx` 库，不能直接外推。

因此本架构不依赖「某库支持度」的乐观假设，而用**三重验收**替代：
1. **结构校验**：自写生成器输出必须通过 `[Content_Types].xml` + 必需部件（`document/styles/numbering/footer/settings/fontTable`）的存在性与 XML 良构校验；
2. **引擎往返**：能被 kit 0.1.5 成功转 PDF（失败即 `convert-failed`，不会静默）；
3. **Word/WPS 打开**：`REQ-OUT-009` 要求「无修复提示」；闸门 2 由 TC-H-01 的人工打开步骤覆盖。

**Q3：如果该库能力不足，是「改造」（向库提交补丁/封装适配层）还是「自写薄层」？**

**自写薄层。** 三条理由：① **字节级可复现需要控制 ZIP 头、条目顺序、压缩参数、core.xml 时间**——第三方库把这些封装掉了，改造量 ≥ 自写；② `REQ-REUSE-004`（除 kit 外零第三方运行时依赖）是 P0 裁决，引入库需推翻裁决②；③ **可行性已被证明**：spike 的 `mkdocx.mjs` 用纯 Node 内置模块手写 OOXML + ZIP，成功生成 34 标题/300 标题两种文档并被 kit 正确转换（spike §1.2、§1.9），说明「自写薄层」的学习与实现风险可控。

**落点**：§5 D2、§8。

### 1.7 六项缺陷回应汇总

| 缺陷 | 一句话结论 | 决策 | 详见 |
|---|---|---|---|
| 1 浏览器页码 | 必须支持页码；选 kit；浏览器整条否决 | D1 | §1 缺陷 1、附录 C |
| 2 零配置落差 | 只需 Node；引擎随 npm 分发；冲突时可复现优先 | D4 | §1 缺陷 2、附录 C |
| 3 Pandoc 表格退化 | 放弃 Pandoc；Pandoc 结构性不可满足 ≈ 47% | D2 | §1 缺陷 3、附录 C |
| 4 LibreOffice TOC | v1 P0；B 两遍法；完整缓存 + 校验 + 重试 | D5 | §1 缺陷 4、§7.1 |
| 5 可复现 | DOCX 字节级 / PDF 版式级；log 字段表 | D3 | §1 缺陷 5、§8 |
| 6 Node DOCX 生态 | 不选库，自写薄层；三重验收 | D2 | §1 缺陷 6 |

---

## 2. 总体架构

### 2.1 数据流（单向）

~~~text
  argv / 输入路径 (.md / .txt / 目录)
        |
        v
  +------------------+     +-------------------------+
  | cli              |---->| kit-locator (可选,PDF)  |  预检：Node/模板/引擎/字体
  | parseArgs        |     +-------------------------+
  | collectInputs    |
  +--------+---------+
           | 每个输入文件（串行）
           v
  +------------------+   bytes  +-------------------------+
  | input-preprocess |--------->| AST (AstDocument)       |
  | 读字节/BOM/换行  |          | blocks + assets + meta  |
  | 扩展名分派/资产  |          | + warnings              |
  +--------+---------+          +------------+------------+
           |                                 |
     .md   |                                 |  .txt
           v                                 v
  +------------------+               +------------------+
  | markdown-parser  |               | txt-structurer   |
  | -> Block[]       |               | -> Block[]       |
  +--------+---------+               +--------+---------+
           |                                 |
           +---------------+-----------------+
                           v
                  +------------------+
                  |  AstDocument     |   <-- 唯一内容真相（内容与排版分离）
                  +--------+---------+
                           v
                  +------------------+   templates/reference.docx（只读）
                  |   docx-render    |<-- token 全部来自模板 / config
                  |   OOXML + ZIP    |
                  +--------+---------+
                           v
                     out/<name>.docx      <-- 字节级可复现
                           v
                  +------------------+   kit 0.1.5（dsoffice）
                  |    pdf-render    |<-- 独占创建 + 临时路径 + 原子替换
                  +--------+---------+
                           v
                     out/<name>.pdf       <-- 版式与内容级可复现
                           v
                  +------------------+
                  |   log-writer     |--> out/conversion-log.jsonl
                  +------------------+
~~~

**硬约束（冻结）**：
1. **单向**：AST 之后不再回读源文件；PDF **只从 DOCX 导出**，不允许从 AST/HTML 直渲，保证两种格式只有一套版式来源。
2. **无旁路**：任何模块不得自行读环境变量或全局配置来决定样式；样式与规则常量只有 `templates/reference.docx` 与 `config/default.yml` 两个来源。
3. **失败即止**：模块间只通过「返回值 / 抛 `DocconvertError`」通信，不写共享可变状态。

### 2.2 模块清单与职责边界

| # | 模块 | 目录 | 职责 | 明确不做 | 预算 LOC |
|---|---|---|---|---|---|
| 1 | input-preprocess | `src/preprocess/**` | 读字节、BOM/CRLF 归一、编码探测（UTF-8→GB18030）、格式分派、资产索引、输入 SHA-256 | 不解析 Markdown 语法、不生成文档 | 300–450 |
| 2 | markdown-parser | `src/markdown/**` | 受控 GFM 子集 → `Block[]`；资产解析回调；告警 | 不做文件 IO、不决定样式 | 700–1000 |
| 3 | txt-structurer | `src/txt/**` | requirements §2.3 写死规则 → `Block[]` | 不猜语义、不改写字符 | 200–300 |
| 4 | docx-render | `src/docx/**` | AST → DOCX；只读模板；固定 ZIP/时间；`tocNumbers` 回填 | 不调用外部转换器、不接受样式参数 | 900–1300 |
| 5 | pdf-render | `src/pdf/**` | DOCX → PDF（封装 kit）；独占创建/临时路径/超时/missingFonts | 不改 DOCX、不含 TOC 逻辑 | 150–250 |
| 6 | kit-locator | `src/kit/**` | 解析顺序 env→项目→全局→npx 缓存；精确版本 + 引擎校验；`doctor` | 不硬编码路径、不联网 | 150–250 |
| 7 | **toc-two-pass** | `src/toc/**` | PDF outline 解析、页码计划、两遍编排、收敛校验、重试一次、降级 | 不生成 DOCX、不封装 kit | **330–550（独立预算）** |
| 8 | cli | `src/cli/**` + `bin/**` | 参数、输入展开、预检、逐文件编排、汇总、退出码 | 不解析内容、不碰样式 | 400–600 |
| 9 | log-writer | `src/log/**` | file/run 记录生成与落盘（覆盖写） | 不参与可复现判定、不写产物 | 150–250 |
| 10 | contracts | `src/contracts/**` | 类型（JSDoc typedef）、常量、错误码、（只读） | 无逻辑 | 120–200 |
| 11 | config-loader | `src/config/**` | 读内置 `config/default.yml`（**自写 YAML 子集解析**）、白名单/黑名单校验、与模板双向一致性校验 | 不读用户配置、不联网 | 80–120 |

**合计预算 ≈ 3,600–5,300 LOC**；`src/toc/**` 的 330–550 是**独立条目**（E3 硬规则），不计入 docx-render（卡 3）与 markdown-parser（卡 2）预算。

### 2.3 两遍法时序（外层循环，不属于数据流）

两遍法**不是**数据流里的新边，而是把 §2.1 的「docx-render → pdf-render」这一段**执行两次**。以下为 `src/toc/index.js` 的 `renderWithToc()` 时序：

~~~text
输入: AstDocument doc, { wantDocx, wantPdf, kit|null, templatePath, workDir }

短文（H1–H3 < 3）或不产 PDF 的 ?  ----(1)----> docx-render(tocNumbers=null) -> 交付

长文：
  P1  docx#1 = docx-render(doc, tocNumbers = null)        // 完整目录缓存，页码占位 "00"
  P2  pdf#1  = pdf-render(docx#1)                          // 第一遍：测量
  P3  outline1 = readPdfOutline(pdf#1)                     // 纯 Node 解析书签
  P4  numbers  = planTocNumbers(outline1, doc.tocEntries)  // 按文档顺序 + level<=2 过滤
  P5  docx#2 = docx-render(doc, tocNumbers = numbers)      // 只改数字，行数不变
  P6  pdf#2  = pdf-render(docx#2)
  P7  outline2 = readPdfOutline(pdf#2)
  P8  check = verifyTocConvergence(outline1, outline2, numbers)
        -> 通过：交付 docx#2 / pdf#2（页码 = PDF 物理页）
        -> 不通过：重试一次（回 P4，用 outline2 重新计算）
        -> 仍不通过：交付最后结果 + WARN toc-not-converged + log converged=false + 退出码 0
~~~

**为什么 P1 就必须是「完整缓存」**：目录占用的页数在 P1 就固定下来（spike §1.9 的 300 条目录占 14 页），P5 只替换数字文本，因此 P6 的分页与 P2 相同——这是收敛的结构性保证，不是碰运气（§7.1）。

### 2.4 与接口草案 v0 的差异（冻结变更，开发照本表实现）

| # | 草案 v0 | 冻结结论 | 原因 |
|---|---|---|---|
| V1 | `PdfRenderOptions.toc: "native"|"two-pass"|"none"` | **删除**该字段；pdf-render 只做单次转换；TOC 编排上移到 `toc-two-pass`（`renderWithToc`） | TOC 需要「重新生成 DOCX」，不属于 pdf-render 职责；且 E3 要求独立模块与独立预算 |
| V2 | 退出码 2/3/4/5/6（§4 草案表） | **改为 requirements §7.2：0/1/2/3/4/5** | 需求为唯一真相；草案表作废（映射见 §3.11） |
| V3 | 错误码 `E_PDF_ENGINE_NOT_FOUND` 等大写常量 | **改为 `pdf-engine-missing` 等 kebab-case**（requirements §9.1 全集，13 个） | 用户可见文案与需求一致；内部用 `DocconvertError.code` 承载同一字符串 |
| V4 | AST 含 `footnoteRef` / `footnoteDef` | **删除**；脚注按字面文本 + `footnote-unsupported` 告警 | REQ-ELEM-20 规定「不支持，按原文保留」 |
| V5 | AST `ListItem.checked?: boolean` | **删除**；任务列表按普通列表项 + 字面 `[ ]/[x]` + `task-list-degraded` | REQ-ELEM-10 规定降级且保留字面前缀 |
| V6 | `KitLocation.source: "dsh-cache"` | 改为 `"npx-cache"`（与 spike §2.3 术语一致） | 术语统一，避免把「DSH 专用」写死成契约 |
| V7 | docx-render `tocNumbers?: number[]`（缺省=用 0 占位） | **明确为 `tocNumbers: number[] | null`**；`null` = 第一遍完整缓存 + 字面占位 `"00"`；数组长度必须 == 目录条目数，否则抛 `convert-failed` | 两遍法的正确性依赖「行数不变」，必须把占位语义写死 |
| V8 | 无 `readPdfOutline` | **新增** `src/toc/outline.js`（纯 Node PDF 解析） | 两遍法的测量环节，属 E3 模块 |

---

## 3. 接口冻结（8 + 1 个模块）

> **冻结含义**：签名、参数名、返回结构、抛出的错误码不得改变；开发照抄 §3.12 清单实现。允许改的只有内部实现（算法、文件划分、私有函数）。任何签名变更必须回技术负责人裁决（§12）。
> **表达方式**：签名以 TypeScript 记法书写（作为**规范文本**）；实现为 **纯 ESM JavaScript + JSDoc typedef**（不引入 TypeScript 编译器，见 §10.1）。契约文件 `src/contracts/*.js` 只含 `@typedef` 与常量。

### 3.0 错误模型（全局统一）

所有模块的失败**只有一个出口**：抛 `DocconvertError`。禁止抛裸 `Error`、禁止 `process.exit`（只有 `bin/docconvert.js` 允许把退出码交给进程）。

~~~ts
export class DocconvertError extends Error {
  code: ErrorCode;          // requirements §9.1 的 13 个 kebab-case 之一
  exitCode: 2 | 3 | 4 | 5;  // 由 code 决定，见 §3.11
  hint?: string;            // 一行可执行建议（REQ-DEP-002）
  detail?: Record<string, unknown>; // 结构化上下文（候选列表/路径/行号），只进日志不打印堆栈
  cause?: unknown;
}
~~~

**纪律**：① 面向用户的输出不含堆栈（REQ-CLI-006）；② 每条错误**必须**能映射到 §3.11 的表；③ 未捕获异常由 `bin` 兜底映射为 `internal-error` / 退出码 1，并写日志（若 outdir 可写）。

### 3.1 数据结构冻结

#### 3.1.1 AST（内容唯一真相）

~~~ts
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "del"; children: Inline[] }              // P2：不解析，字面保留（REQ-ELEM-25）
  | { kind: "code"; text: string }                    // 行内代码，渲染 10.5pt 等宽
  | { kind: "link"; href: string; title?: string; children: Inline[]; degraded?: boolean }
  | { kind: "image"; assetId: string; alt: string; title?: string }
  | { kind: "br" };                                   // 硬换行（REQ-MD-003）

export interface ListItem { children: Block[]; }      // 无 checked 字段（v0 差异 V5）

export interface TableModel {
  align: ("left" | "center" | "right" | null)[];
  header: Inline[][];
  rows: Inline[][][];
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[]; bookmark: string }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { kind: "blockquote"; depth: 1 | 2; children: Block[] }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "table"; model: TableModel }
  | { kind: "hr" };
~~~

**冻结约束**：
- `bookmark` 由 **markdown-parser / txt-structurer 生成**，格式 `_Toc0001`…（4 位十进制，按标题在全文出现顺序递增，从 0001 开始），**只对 H1–H6 生成**。它是目录超链接与 PDF 书签映射的锚点，必须稳定（同一输入两次解析结果相同）。
- `blockquote.depth` 上限 2；第 3 级起并入 2 并告警 `quote-depth-clamped`（REQ-ELEM-14）。
- **引用内标题**：照常作为 `heading` 节点存在于 `blockquote.children` 中（REQ-MD-008 要求渲染为标题样式），但**不进入目录**——由 `collectTocEntries` 只遍历顶层 `blocks` 保证。
- 脚注：**无 AST 节点**（v0 差异 V4）；parser 把脚注引用/定义按字面文本写入 `text` 并告警 `footnote-unsupported`。

#### 3.1.2 资产与文档

~~~ts
export interface AssetRef {
  id: string;                 // "asset-0001"（按首次出现顺序）
  rawSrc: string;             // 源码原文（用于告警与降级展示）
  absolutePath?: string;      // 仅在 resolved=true 时存在
  mime: "image/png" | "image/jpeg" | "application/octet-stream";
  widthPx?: number;           // 仅在 resolved=true 时存在
  heightPx?: number;
  alt: string;
  resolved: boolean;          // true 才会内嵌；false 必产 image-degraded 告警
}

export interface SourceMeta {
  absolutePath: string;       // 仅内存使用，禁止写入产物（REQ-REP-003）
  format: "md" | "txt";
  sha256: string;             // 输入文件字节哈希（大写十六进制）
  bytes: number;
  mtimeMs: number;            // 仅日志/诊断，不写产物
  encoding: "utf-8" | "utf-8-bom" | "gb18030";
  title?: string;             // 封面标题来源：首个 H1，否则文件名去扩展名（REQ-LAY-002）
}

export type WarningCode =
  | "image-degraded" | "footnote-unsupported" | "task-list-degraded"
  | "inline-html-unsupported" | "indented-code-unsupported" | "list-depth-clamped"
  | "quote-depth-clamped" | "table-ragged" | "table-malformed" | "table-nested-unsupported"
  | "link-target-degraded" | "front-matter-not-recognized" | "strikethrough-unsupported"
  | "formula-unsupported" | "no-heading-detected" | "font-fallback"
  | "toc-degraded" | "toc-not-converged";

export interface ConversionWarning { code: WarningCode; message: string; line?: number; }

export interface AstDocument {
  schemaVersion: 1;
  meta: SourceMeta;
  blocks: Block[];
  assets: AssetRef[];
  warnings: ConversionWarning[];   // 已按 code 合并去重前的原始列表（stderr 截断在 cli 层，REQ-ELEM-29）
}
~~~

**告警文案**：`ConversionWarning.message` **必须**取 requirements §5.2 的写死文案；`code` 是机器键，`message` 是中文说明。

#### 3.1.3 目录与两遍法

~~~ts
export interface TocEntry {
  index: number;              // 1-based，目录行序号
  level: 1 | 2 | 3;           // 只含 H1–H3
  text: string;               // 标题渲染文本（逐字，含原文编号）
  bookmark: string;           // 对应 heading.bookmark
}

export interface PdfOutlineEntry { order: number; level: number; title: string; page: number; } // page 为 1-based

export interface PdfOutline { pageCount: number; entries: PdfOutlineEntry[]; }

export interface TocReport {
  mode: "two-pass" | "degraded";   // 对外只允许这两个值（README/--version/日志三处一致，REQ-TOC-006）
  entries: number;                 // = TocEntry 数
  passes: 1 | 2;                   // 1 = 短文/无 PDF；2 = 两遍
  converged: boolean;
  mismatches: Array<{ index: number; expected: number; actual: number }>;
}
~~~

#### 3.1.4 引擎定位与探测

~~~ts
export interface KitLocation {
  packageDir: string;      // .../node_modules/@deepseek-ai/libreoffice-kit
  cliPath: string;         // packageDir/lib/cli.js
  version: string;         // 必须 === "0.1.5"
  source: "env" | "project" | "global" | "npx-cache";
  enginePackageDir: string;
  engineVersion: string;   // 必须 === "0.1.5"（win32-x64 / darwin-*）
}

export interface EngineProbe {
  version: string;         // runtime.version（0.1.5）
  backend: "native" | "wasm";
  libreOfficeVersion?: string;  // 如 LibreOfficeDev 26.8.0.3（best-effort，取不到则省略）
  supportsDocxToPdf: boolean;   // capabilities.conversions 中存在 docx→pdf
}
~~~

#### 3.1.5 运行结果、CLI 与日志

~~~ts
export interface DocxRenderResult { outputPath: string; bytes: number; sha256: string; tocEntries: TocEntry[]; }

export interface PdfRenderResult {
  outputPath: string; bytes: number; sha256: string;
  pages?: number;
  missingFonts: string[];
  engine: { kitVersion: string; backend: string; libreOfficeVersion?: string };
}

export interface CliOptions {
  inputs: string[];
  outDir: string;
  recursive: boolean;
  formats: Array<"docx" | "pdf">;   // 内部表示；"both" => ["docx","pdf"]
  continueOnError: boolean;
  help: boolean;
  version: boolean;
}

export interface InputItem { absolutePath: string; relOutBase: string; format: "md" | "txt"; }
export interface InputPlan { items: InputItem[]; conflicts: Array<{ outPath: string; inputs: string[] }>; skipped: string[]; outDirAbs: string; }

export interface FileLogRecord {
  type: "file"; schemaVersion: 1;
  program: { name: "docconvert"; version: string };
  template: { version: string };                              // 模板 SHA-256 前 12 位
  pdfKit: { version: string; engine: string; backend: string } | null;
  fonts: { latin: string; cjk: string; mono: string };
  command: string[];
  input: { path: string; bytes: number; sha256: string; encoding: string; extension: string };
  outputs: Array<{ format: "docx" | "pdf"; path: string; bytes: number; sha256: string; durationMs: number }>;
  status: "ok" | "partial" | "failed" | "skipped";
  errorCode: string | null;
  warnings: Array<{ code: string; line?: number; message: string }>;   // 不截断（REQ-ELEM-29）
  toc: TocReport;
  startedAt: string; endedAt: string;                          // ISO 8601 含时区偏移
  durationMs: number;
  platform: { os: string; arch: string; node: string };
}

export interface RunLogRecord {
  type: "run"; schemaVersion: 1;
  program: { name: "docconvert"; version: string };
  template: { version: string };
  pdfKit: { version: string; engine: string; backend: string } | null;
  fonts: { latin: string; cjk: string; mono: string };
  platform: { os: string; arch: string; node: string };
  command: string[];
  startedAt: string; endedAt: string; durationMs: number;
  counts: { total: number; ok: number; failed: number; skipped: number };
  exitCode: number;
  outdir: string;
  tocMode: "two-pass" | "degraded";
}

export interface BuildInfo {
  programVersion: string;     // package.json version
  nodeVersion: string;
  templateVersion: string;    // SHA-256 前 12 位
  kitVersion: string | null;  // 解析失败时为 null，--version 输出 "pdf-engine: unavailable"
  engineVersion: string | null;
  tocMode: "two-pass" | "degraded";
  fontStack: { latin: string; cjk: string; mono: string };
}
~~~

### 3.2 input-preprocess

~~~ts
export interface PreprocessOptions {
  cwd?: string;               // 资产解析基准；缺省 = 输入文件所在目录（REQ-ELEM-18 相对路径语义）
}
export async function preprocess(absolutePath: string, options?: PreprocessOptions): Promise<AstDocument>;
~~~

| 项 | 冻结内容 |
|---|---|
| 输入 | **绝对路径**（相对路径的解析由 cli 完成，模块内不做 CWD 兜底） |
| 编码 | UTF-8 BOM 剥离 → UTF-8 严格解码 → 失败回退 GB18030 严格解码 → 再失败抛 `decode-error`（REQ-IN-002） |
| 换行 | CRLF/CR → LF；制表符在缩进判定中按 4 空格（REQ-IN-002） |
| 空输入 | 0 字节或去空白后为空 → `empty-input`（REQ-IN-003） |
| 分派 | `.md`/`.markdown`→P? 注意：`.markdown` 为 P1，默认**不支持**并抛 `unsupported-extension`；`.txt`→txt-structurer；其它 → `unsupported-extension`（REQ-IN-001/006） |
| 资产 | 只解析**相对路径**且扩展名为 PNG/JPEG 且文件存在可读 → `resolved=true`；其余一律 `resolved=false`（不下载、不读绝对路径、不解析 SVG/GIF/WEBP，REQ-ELEM-18/19、REQ-IN-005） |
| 错误码 | `input-not-found` / `input-permission` / `unsupported-extension` / `empty-input` / `decode-error` |
| 不做 | 不解析 Markdown、不生成 DOCX、不读任何配置文件 |

### 3.3 markdown-parser

~~~ts
export interface ParseContext {
  sourcePath: string;
  resolveAsset(rawSrc: string): AssetRef;
  warn(w: ConversionWarning): void;
  nextBookmark(): string;      // 由 preprocess 注入的单调计数器
}
export function parseMarkdown(text: string, ctx: ParseContext): Block[];
~~~

| 项 | 冻结内容 |
|---|---|
| 语法面 | 受控 GFM 子集，**逐条**对应 REQ-MD-001；不认识的语法一律降级为段落并告警（REQ-MD-004） |
| 容错 | **永不抛异常**（除内存错误）；单行解析失败 → 该行作段落 + 告警带行号 |
| 拼接 | 软换行按 REQ-TXT-002 的 CJK 规则（与 .txt 同一实现，**同一函数**，防规范分裂） |
| 表格 | 缺分隔行 → 整块降级段落 + `table-malformed`；行列不齐 → 补齐/合并 + `table-ragged`（REQ-ELEM-11/12） |
| 不支持项 | 内联 HTML、HTML 注释、YAML front matter、脚注、任务列表、缩进代码块、嵌套表格、删除线、公式：**原文保留可见** + 对应告警 |
| 不做 | 文件 IO、样式决策、目录收集（目录由 docx-render 的 `collectTocEntries` 负责） |

### 3.4 txt-structurer

~~~ts
export function structureText(text: string, ctx: ParseContext): Block[];
~~~

| 项 | 冻结内容 |
|---|---|
| 规则源 | requirements §2.3.1 的**优先级表**（1 Setext → 2 首行标题 → 3 分隔线 → 4 列表 → 5 段落）；§2.3.3 列表细则；消歧规则（三连字符上一行是文本则 H2 下划线，否则分隔线） |
| 定死示例 | §2.3.4 的 3 个输入→输出示例**逐字**作为单测 fixture（REQ-TXT-006） |
| 零改写 | 不做全角/半角、繁简、标点替换；唯一允许的字符变化是空白处理与 CJK 拼接（REQ-TXT-003） |
| 中文序号 | `一、`/`（一）`/`第一章` **不识别**为标题或列表，按段落逐字保留（§2.3.3 末条） |
| 告警 | 仅 `no-heading-detected`（P1，REQ-TXT-007）与 `list-depth-clamped`；`.txt` 的降级**不产生** Markdown 类告警（§5.1 注） |
| 不做 | 不读文件、不猜语义、不生成样式 |

### 3.5 docx-render

~~~ts
export interface DocxRenderOptions {
  templatePath: string;              // 冻结：<pkg>/templates/reference.docx，不接受其它值
  tocNumbers?: number[] | null;      // null = 第一遍完整缓存 + 占位 "00"；数组 = 回填（长度必须 == entries）
}
export interface DocxRenderResult { outputPath: string; bytes: number; sha256: string; tocEntries: TocEntry[]; }

export function collectTocEntries(doc: AstDocument, opts: { depth: 3 }): TocEntry[];   // 纯函数，H1–H3，文档顺序
export function isLongDoc(entries: TocEntry[], threshold: number): boolean;             // entries.length >= threshold
export async function renderDocx(doc: AstDocument, outPath: string, options: DocxRenderOptions): Promise<DocxRenderResult>;
~~~

| 项 | 冻结内容 |
|---|---|
| 输入 | `AstDocument` + 模板绝对路径；**不接受**任何字号/颜色/边距/字体参数（CLI 也没有） |
| 样式来源 | **100% 来自模板**：渲染器只写入 `w:pStyle` 引用（`Normal/Heading1..6/DocTitle/TOC1..3/CodeBlock/TableText/FooterText/Quote`）与**模板已定义的**直接属性（表格宽度、图片 extent、书签、域代码），不写字号/颜色常量 |
| 目录 | 长文（`isLongDoc`）时写 TOC 域 + 完整缓存条目 + 标题书签；短文不写目录、不写封面、正文从第 1 页开始（REQ-LAY-001） |
| 占位 | `tocNumbers === null` → 页码文本固定写入 `"00"`（两位，等宽数字，右对齐制表位）；**不得**写 `1` 或空（避免看起来正确） |
| 回填 | 数组长度 ≠ `tocEntries.length` → 抛 `convert-failed`（内部错误，说明两遍法状态不一致） |
| `updateFields` | **永不写入**（§7.2）；`settings.xml` 不含 `w:updateFields` 元素 |
| 封面 | 仅长文；只含标题（26pt 居中）+ 8cm 装饰线；无日期/作者/路径/页码（REQ-LAY-014） |
| 页脚 | 首页不同（封面无页脚）；其余页居中 PAGE 域（REQ-LAY-012） |
| 可复现 | 按 §8 的 ZIP/时间/ID 规约；输出路径先写临时文件再原子重命名 |
| 不做 | 不调用 kit、不做分页测量、不读写 `config/default.yml` 之外的任何配置 |

### 3.6 pdf-render

~~~ts
export interface PdfRenderOptions {
  kit: KitLocation;
  workDir: string;          // 本次运行独占临时目录（系统临时区），由 cli 创建/清理
  timeoutMs?: number;       // 默认 120000
}
export async function renderPdf(docxPath: string, outPath: string, options: PdfRenderOptions): Promise<PdfRenderResult>;
~~~

| 项 | 冻结内容 |
|---|---|
| 路径 | 输入输出均转**绝对路径**（kit 要求，spike §2.5） |
| 独占创建 | kit **拒绝覆盖**已有文件（`EEXIST`，spike §2.5 C）→ 先写 `<workDir>/out-<pid>-<n>.pdf`，成功后原子 rename 到 `outPath`（同盘） |
| 超时 | 超时杀进程 + 清理临时文件 + 抛 `convert-failed`（`detail.kind="timeout"`） |
| 字体 | 透传 `missingFonts`；非空时**不失败**，写日志并在 cli 汇总一行提示 |
| 错误映射 | kit 的 `ConversionError.code`（invalid-document / unsupported-format / input-too-large / output-too-large / invalid-output / timeout / unavailable / failed）→ `convert-failed`（带 `detail.kitCode`）；引擎不可用 `unavailable` → `pdf-engine-missing`（退出码 4） |
| TOC | **不含任何 TOC 逻辑**（v0 差异 V1）；只做「一次 DOCX→PDF」 |
| 不做 | 不改 DOCX、不直接渲染 AST、不硬编码 kit 路径 |

### 3.7 kit-locator

~~~ts
export interface LocateKitOptions {
  installRoot: string;                    // 程序安装目录（不是 CWD）
  env?: Record<string, string | undefined>;   // 默认 process.env
  platform?: { os: string; arch: string };    // 默认 process
  npxCacheRoots?: string[];               // 仅测试注入
}
export function locateKit(options: LocateKitOptions): KitLocation;     // 失败抛 pdf-engine-missing（退出码 4）
export function probeEngine(kit: KitLocation): Promise<EngineProbe>;  // 调用 capabilities / 或读 package.json
~~~

| 项 | 冻结内容 |
|---|---|
| 解析顺序（写死） | ① `DOCONVERT_LIBREOFFICE_KIT`（显式覆盖；**校验失败即硬失败 4、不回退**）② 安装目录逐级向上的 `node_modules/@deepseek-ai/libreoffice-kit` ③ `npm root -g`（**best-effort**，子进程失败即跳过，不抛错）④ npx 缓存（`%LOCALAPPDATA%/npm-cache/_npx/*/node_modules/...`、`~/.npm/_npx/*/...`，按目录 mtime 倒序） |
| 候选校验 | `package.json.name` 精确、`version === "0.1.5"`、`lib/cli.js` 与 `lib/index.js` 存在、同级平台引擎包存在且版本相同（四条全过才可用） |
| 禁止 | 不硬编码 npx 哈希目录；不联网；不因 `npm root -g` 失败而中断 |
| 错误 | `pdf-engine-missing` + `hint`（三条修复路径：安装 / 设 env / 复用 DSH 缓存）+ `detail.candidates`（每个候选的失败原因，进日志） |
| doctor | `docconvert doctor` 复用同一实现，输出 `{ found, source, version, engine, backend, candidates }` |

### 3.8 toc-two-pass（**E3 独立模块**）

~~~ts
export interface TocRenderOptions {
  outDir: string;            // 最终产物目录
  workDir: string;           // 临时区
  templatePath: string;
  wantDocx: boolean; wantPdf: boolean;
  kit: KitLocation | null;
  tocThreshold: number;      // config: layout.longdocHeadingThreshold = 3
  timeoutMs?: number;
}
export interface TocRenderResult {
  docx?: DocxRenderResult; pdf?: PdfRenderResult;
  toc: TocReport;
  warnings: ConversionWarning[];    // 追加的 toc-degraded / toc-not-converged
}

**实现说明（T32 阈值）**：`renderDocx` 签名不接收 `longdocHeadingThreshold`（§3.5 冻结）；`src/docx` 用模块常量镜像 `config.layout.longdocHeadingThreshold=3`，precheck 校验常量与 config 一致，禁止第二来源。

**docx-only 成本（C-PDF-05）**：docx-only 且引擎可用时，为拿到目录页码需一次测量转换 + 一次校验转换（2 次 PDF），属两遍法固有成本；140 页约 +2.6 s。

export function readPdfOutline(pdfPath: string): Promise<PdfOutline>;        // 纯 Node：xref/对象流/书签树/页映射 + 标题 ToUnicode
export function planTocNumbers(outline: PdfOutline, entries: TocEntry[]): number[];
export function verifyTocConvergence(a: PdfOutline, b: PdfOutline, numbers: number[]): { converged: boolean; mismatches: Array<{ index: number; expected: number; actual: number }> };
export async function renderWithToc(doc: AstDocument, options: TocRenderOptions): Promise<TocRenderResult>;
~~~

| 项 | 冻结内容 |
|---|---|
| 预算 | **330–550 LOC**：`outline.js`（PDF 解析）250–400，`index.js`（编排/计划/校验/重试）80–150。**独立预算**，不得挪用 docx-render / markdown-parser 的额度（§7.3） |
| 依赖方向 | 只依赖 `contracts` + `docx-render` + `pdf-render`；**反向禁止**（docx/pdf 不得 import toc） |
| 映射规则 | 用「过滤 `level <= 2` 后的 outline 顺序」与 `TocEntry.index` 一一对应；**禁止**按标题文本唯一匹配（同名标题会歧义，spike §1.8） |
| 重试 | 收敛失败 → **最多重试一次**（用第二次 outline 重算页码，最多第 3 次导出）；重试后仍失败 → 降级输出（§7.1） |
| 降级 | 写 `WARN toc-not-converged`（stderr）+ 日志 `toc.converged=false`；**退出码仍 0**；DOCX/PDF 照常交付 |
| 短文 | `entries.length < threshold` → 单遍，`TocReport{ mode: "two-pass", entries: 0, passes: 1, converged: true }` |
| docx-only | `wantPdf=false` 且 kit 可解析 → 仍做一次测量（1 次 DOCX + 1 次 PDF 临时导出）以拿到正确页码；kit 不可解析 → `mode:"degraded"` + `toc-degraded` 告警（边界见 §9.5 C-ARCH-01） |

### 3.9 cli

~~~ts
export function parseArgs(argv: string[]): CliOptions;                       // 非法 -> usage-error（退出码 2）
export async function collectInputs(inputs: string[], options: {
  outDir: string; recursive: boolean; cwd: string;
}): Promise<InputPlan>;                                                     // 展开/跳过/冲突预检
export async function runCli(argv: string[], io?: { stdout: Writable; stderr: Writable; env: NodeJS.ProcessEnv }): Promise<number>;
~~~

| 项 | 冻结内容 |
|---|---|
| 参数面 | **仅**：`<input...>`、`-o/--outdir`、`-r/--recursive`、`--format docx|pdf|both`、`--continue-on-error`、`-h/--help`、`-V/--version`、`doctor`（子命令）。其它一律 `usage-error` |
| 禁止参数 | 字体/字号/颜色/边距/页面尺寸/模板/参考文档/主题/编码/引擎路径/并发度/日志路径/输出文件名：**拒绝且不出现在 --help**（REQ-CLI-003） |
| 预检顺序 | ① Node 版本 ② 模板存在可解析 ③ 需要 PDF 时引擎可解析 ④ 字体栈探测（不阻断）（REQ-DEP-001） |
| 冲突预检 | 输出路径与任一输入相同 或 多输入映射到同一输出 → **转换前**整体报 `output-conflict`（退出码 2），不写任何产物（REQ-OUT-004/005、REQ-BATCH-010） |
| 顺序 | 按**输出相对路径**的 Unicode 码点升序串行处理（REQ-BATCH-002） |
| 汇总 | 每文件一行 `OK/FAIL/SKIP`；末三行 `SUMMARY total=N ok=N failed=N skipped=N elapsed=X.Xs`、`FAILED: …`（>5 省略 `... +N more`）、`OUTPUT <abs outdir>` |
| 退出码 | 见 §3.11；`--continue-on-error` 不改变「有失败即非 0」 |
| 幂等 | 同一输入重复运行 → 覆盖产物，DOCX SHA 不变（REQ-BATCH-009） |

### 3.10 log-writer

~~~ts
export async function writeConversionLog(records: Array<FileLogRecord | RunLogRecord>, logPath: string): Promise<void>;
export function buildFileRecord(input: { ... }): FileLogRecord;   // 实现自由，但字段集冻结
~~~

| 项 | 冻结内容 |
|---|---|
| 路径 | `<outdir>/conversion-log.jsonl`（不允许 CLI 覆盖，REQ-CLI-003） |
| 格式 | UTF-8 无 BOM、LF、每行一个 JSON 对象；**每次运行 truncate**（REQ-LOG-001） |
| 顺序 | 每个输入一条 `type:"file"`（按处理顺序），末尾一条 `type:"run"` |
| 真实性 | `sha256`/`bytes` 必须由磁盘文件重算后写入（REQ-LOG-004）；`durationMs` 为整数毫秒 |
| 隐私 | 不含正文片段/密码/令牌；路径按用户传入形式记录（REQ-LOG-005） |
| 失败 | 写日志失败**不得**吞掉转换结果：stderr 打一行 `WARN log-write-failed`，退出码不变 |

### 3.11 错误码与退出码（**冻结**，以 requirements §7.2 / §9.1 为准）

| code | 类别 | 退出码 | 触发 | hint（一行） |
|---|---|---|---|---|
| `usage-error` | 参数 | **2** | 未知选项 / 缺 input / 非法取值 / `-o` 指向已存在文件 | 运行 `docconvert --help` |
| `output-conflict` | 参数 | **2** | 输出路径 == 输入路径；或多输入映射到同一输出 | 改用独立 `-o` 目录或改名 |
| `input-not-found` | 输入 | **3** | 路径不存在 | 检查拼写；含空格时加引号 |
| `unsupported-extension` | 输入 | **3** | 扩展名不在白名单 | 支持：.md .txt |
| `empty-input` | 输入 | **3** | 0 字节 / 去空白为空 | 确认文件非空 |
| `decode-error` | 输入 | **3** | UTF-8 与 GB18030 均失败 | 另存为 UTF-8 重试 |
| `no-input-files` | 输入 | **3** | 目录内无白名单文件 | 确认目录与 `-r` |
| `input-permission` | 输入 | **3** | 无读权限 | 检查权限 |
| `runtime-unsupported` | 依赖 | **4** | Node < 22.19 | 升级 Node 24 |
| `template-missing` | 依赖 | **4** | 内置模板缺失/损坏/配置非法 | 重新安装 docconvert |
| `pdf-engine-missing` | 依赖 | **4** | **`--format` 含 pdf** 且引擎不可解析（docx-only 不适用：见 §9.5，按 C-ARCH-01 裁决 (a) 降级、退出码 0） | 安装 kit / 设 `DOCONVERT_LIBREOFFICE_KIT` / 改用 `--format docx` |
| `output-not-writable` | 环境 | **4** | 输出目录不可写或无法创建（预检或写入时） | 检查 `-o` 目录权限，或改用可写目录 |
| `convert-failed` | 转换 | **5** | 解析/生成/导出失败（含 kit 失败、超时） | 查看 `conversion-log.jsonl` |
| `internal-error` | 内部 | **1** | 未捕获异常 | 反馈日志给维护者 |

**批量语义**：预检类（2/4）在转换前整体退出；转换期单文件失败取**首个失败文件**的类别码；`--continue-on-error` 下仍非 0（REQ-BATCH-005）。

### 3.12 冻结签名清单（开发照抄）

~~~js
// src/preprocess/index.js
export async function preprocess(absolutePath, options) {}                  // -> AstDocument

// src/markdown/index.js
export function parseMarkdown(text, ctx) {}                                  // -> Block[]

// src/txt/index.js
export function structureText(text, ctx) {}                                  // -> Block[]

// src/docx/index.js
export function collectTocEntries(doc, opts) {}                              // -> TocEntry[]
export function isLongDoc(entries, threshold) {}                             // -> boolean
export async function renderDocx(doc, outPath, options) {}                   // -> DocxRenderResult

// src/pdf/index.js
export async function renderPdf(docxPath, outPath, options) {}               // -> PdfRenderResult

// src/kit/index.js
export function locateKit(options) {}                                        // -> KitLocation
export async function probeEngine(kit) {}                                    // -> EngineProbe

// src/toc/index.js  (E3 模块：330-550 LOC)
export function readPdfOutline(pdfPath) {}                                   // -> Promise<PdfOutline>
export function planTocNumbers(outline, entries) {}                          // -> number[]
export function verifyTocConvergence(a, b, numbers) {}                       // -> {converged, mismatches}
export async function renderWithToc(doc, options) {}                         // -> TocRenderResult

// src/cli/index.js
export function parseArgs(argv) {}                                           // -> CliOptions
export async function collectInputs(inputs, options) {}                      // -> Promise<InputPlan>
export async function runCli(argv, io) {}                                    // -> Promise<number> (exit code)

// src/log/index.js
export async function writeConversionLog(records, logPath) {}                // -> Promise<void>
export function buildFileRecord(input) {}                                    // -> FileLogRecord
~~~

---

## 4. 模板与 token 冻结

### 4.1 双源规则（消解「模板 vs 配置」的歧义）

REQ-TPL-004 说「`config/default.yml` 是版式与规则常量的**唯一定义源**」，REQ-LAY-005/006/007 的验收又说「解压 DOCX 检查样式值」。两者并不矛盾，本架构冻结为：

~~~text
default.yml（权威声明源，随包、只读、无用户覆盖）
      |  构建期：tools/build-template.js 生成
      v
templates/reference.docx（编译产物 + 运行时唯一读取对象）
      |  运行期：docx-render 只读模板；启动时做「双向一致性校验」
      v
产物 DOCX（样式引用 + 少量直接属性）
~~~

- **唯一编辑入口 = `config/default.yml`**；模板不得手工改（改了会在启动校验时被发现）。
- **运行时读模板不读 yml**（避免每次转换解析 YAML，也避免「两套值」）。
- **启动校验**：模板 `styles.xml` 的关键值与 `default.yml` 声明值逐一比对，不等 → `template-missing`（退出码 4）。这一条同时满足 REQ-TPL-003（模板版本可检出）、REQ-TPL-005（非法配置）、REQ-TPL-007（无假配置）。
- **CLI/环境变量/用户目录**：**一律不读**（REQ-TPL-001/004）。

### 4.2 token 冻结表（A4 / 边距 / 正文 / H1–H3 / 表格 / 代码块 / 页脚页码）

> 单位约定：`twips`（1/1440 英寸）、`half-points`（`w:sz` 单位）、`EMU`（1/914400 英寸）。**开发不得在代码里写死这些数字**，只能引用模板样式；表中数值是「模板必须满足的值」。

| # | token（config 键） | 值 | OOXML 落点 | 来源 |
|---|---|---|---|---|
| T01 | `page.size` | A4 = **11906 × 16838 twips** | `w:sectPr/w:pgSz w:w w:h` | 既有 DOCX |
| T02 | `page.margins.top/bottom` | **1247 twips**（2.2 cm） | `w:pgMar w:top w:bottom` | 既有 DOCX |
| T03 | `page.margins.left/right` | **1134 twips**（2.0 cm） | `w:pgMar w:left w:right` | 既有 DOCX |
| T04 | （派生）版心宽 | **9638 twips**（= 11906 − 2×1134 = 17.0 cm） | 表格宽度/图片上限的计算基准 | 派生 |
| T05 | `fonts.latin` | **Calibri** | `w:rFonts w:ascii w:hAnsi w:cs` | 既有 DOCX |
| T06 | `fonts.cjk` | **微软雅黑** | `w:rFonts w:eastAsia` | 既有 DOCX |
| T07 | `fonts.mono` | **Consolas** | `w:rFonts w:ascii w:hAnsi w:eastAsia` | 新增（工作区盘点 §7） |
| T08 | `sizes.body` | **12 pt → `w:sz w:val="24"`** | `Normal` | 既有 DOCX |
| T09 | `layout.bodyLineSpacing` | **1.5 倍 → `w:spacing w:line="360" w:lineRule="auto"`** | `Normal` | 既有 DOCX |
| T10 | `layout.bodyFirstLineIndentChars` | **2 字符 → `w:ind w:firstLineChars="200" w:firstLine="480"`** | `Normal` | 既有 DOCX |
| T11 | （正文段后） | **6 pt → `w:after="120"`，段前 0** | `Normal` | §4.2 版式表 |
| T12 | `sizes.h1` | **18 pt → 36**；段前 360 / 段后 160（18/8 pt）；长文另起页 `w:pageBreakBefore` | `Heading1` | 既有 DOCX（分页为新增） |
| T13 | `sizes.h2` | **15 pt → 30**；段前 280 / 段后 120（14/6 pt） | `Heading2` | 既有 DOCX |
| T14 | `sizes.h3` | **13 pt → 26**；段前 240 / 段后 80（12/4 pt） | `Heading3` | 既有 DOCX |
| T15 | `sizes.h4/h5/h6` | **12 / 11 / 11 pt → 24 / 22 / 22**；段前 200 / 段后 80；H6 斜体 | `Heading4..6` | 新增 |
| T16 | （标题通用） | 加粗、左对齐、无缩进、单倍行距、`w:keepNext`、`w:outlineLvl w:val="级别-1"` | `Heading1..6` | 既有 + 新增 |
| T17 | `sizes.table` | **8.5 pt → 17**；行内单倍、段前后 0；垂直居中 | `TableText` | `_tools/fix_docx_layout.py` |
| T18 | `table.widthCm` | **9638 twips**（17.0 cm，= T04；test-cases 的 9639 为 ±5% 内的近似写法，**以 9638 为准**） | `w:tblW w:w="9638" w:type="dxa"` + `w:tblLayout w:type="fixed"` | fix_docx_layout.py |
| T19 | （表头） | 加粗 + 底纹 **#EDEDED**；`w:tblHeader`（表头跨页重复）；`w:cantSplit`（行不跨页） | `w:shd` / `w:trPr` | fix_docx_layout.py |
| T20 | `table.cellPaddingTwips` | **上/下 30、左/右 60** | `w:tblCellMar` | fix_docx_layout.py |
| T21 | `table.afterSpacePt` | **10 pt → 200**（表后空段） | 表格后段落 `w:spacing w:before="200"` | fix_docx_layout.py |
| T22 | `sizes.code` | **9 pt → 18**；Consolas；段前/段后 120（6/6 pt）；左缩进 **142 twips**（0.25 cm） | `CodeBlock` | 新增 |
| T23 | `colors.codeFill` | **#F5F5F5** 连续底纹（整段 `w:shd w:fill`） | `CodeBlock` | 新增 |
| T24 | （行内代码） | **10.5 pt → 21**，等宽，无底纹，无反引号（REQ-MD-005） | 直接 run 属性 `CharacterInlineCode` | 新增 |
| T25 | （引用） | 左缩进 **284 twips**（0.5 cm）+ 左框线 `w:sz="24"`（3 pt）+ 段前后 120；颜色 `auto`（需求未指定，取模板默认黑） | `Quote` | 新增 |
| T26 | `sizes.footer` / `colors.footerText` | **9 pt → 18** / **#808080**；居中；`PAGE` 域；封面页不显示（`titlePg` + 首页页脚空） | `FooterText` + `word/footer1.xml` | 既有 DOCX |
| T27 | `sizes.toc` | **10.5 pt → 21**；行距单倍、段前后 0；H1 条目加粗无缩进，H2 缩进 **340 twips**（0.6 cm），H3 缩进 **680 twips**（1.2 cm）；点线引导（`w:tabs w:leader="dot"`）+ 右对齐页码 | `TOC1/2/3` | 新增 |
| T28 | `sizes.coverTitle` | **26 pt → 52**，加粗，居中；封面唯一可含文本的段落 | `DocTitle` | 新增 |
| T29 | （封面装饰线） | 宽 **4535 twips**（8 cm）、居中、下框线 `w:sz="6"`（0.75 pt） | 1×1 表格，居中 | 新增 |
| T30 | （列表） | 每级缩进 **+419 twips**（0.74 cm），悬挂缩进 419；最多 3 级；有序/无序各自 `abstractNum` | `numbering.xml` | 新增 |
| T31 | `images.maxWidthCm` | **9638 twips（17.0 cm）**；按 px@96 dpi 换算 EMU；**不放大** | `wp:extent cx cy` | 新增 |
| T32 | `layout.longdocHeadingThreshold` | **3**（H1–H3 计数 ≥ 3 即长文） | 逻辑常量（default.yml） | 裁决 OQ-03 |
| T33 | `toc.depth` / `toc.bookmarkDepth` | **3 / 6** | 逻辑常量 | 需求 §6.2 |
| T34 | `output.dirName` / `docxExt` / `pdfExt` | **docconvert-out / .docx / .pdf** | 逻辑常量 | 需求 §3.1 |
| T35 | `log.fileName` | **conversion-log.jsonl** | 逻辑常量 | 需求 §10 |

### 4.3 样式 ID 清单（模板必须且仅必须定义这些）

| 样式 ID | `w:type` | 用途 | 谁引用 |
|---|---|---|---|
| `Normal` | paragraph | 正文 | docx-render（默认） |
| `Heading1`…`Heading6` | paragraph | 标题 1–6（含 `outlineLvl`） | docx-render |
| `DocTitle` | paragraph | 封面标题 | docx-render（仅长文） |
| `TOC1` / `TOC2` / `TOC3` | paragraph | 目录条目 3 级 | docx-render（仅长文） |
| `CodeBlock` | paragraph | 围栏代码块 | docx-render |
| `TableText` | paragraph | 表格单元格文字 | docx-render（表格内段落） |
| `Quote` | paragraph | 引用块 | docx-render |
| `FooterText` | paragraph | 页脚 | `footer1.xml` |
| `CharacterInlineCode` | character | 行内代码 | docx-render |

**纪律**：模板**不含任何示例正文文本**（REQ-TPL-002，验收：解压后 `document.xml` 正文文本节点为空）。样式之外的元素（`sectPr` 页面设置、`numbering.xml` 抽象编号、`footer1.xml` 页脚）随模板一起冻结。

**辅助样式（允许存在，precheck 不强制）**：`Hyperlink`（链接）、`HrLine`（分隔线）、`CoverRule`（封面装饰线）、`TocTitle`（目录标题）、`TableDoc`（表格）、`TableGap`（表后空段）、`TableNormal`（表格默认）。模板共 23 样式 = 16 核心 + 7 辅助；precheck 只强制 16 个核心 ID，多出的辅助样式合法。

### 4.4 config/default.yml 白名单（冻结，来自 requirements §11.1）

~~~yaml
page: { size: A4, margins: { top: 2.2, bottom: 2.2, left: 2.0, right: 2.0 } }        # cm
fonts: { latin: Calibri, cjk: 微软雅黑, mono: Consolas,
         cjkFallback: [Microsoft YaHei UI, PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Source Han Sans SC, SimSun],
         latinFallback: [Carlito, Arial, Helvetica],
         monoFallback: [Menlo, DejaVu Sans Mono, monospace] }
sizes: { body: 12, h1: 18, h2: 15, h3: 13, h4: 12, h5: 11, h6: 11,
         table: 8.5, code: 9, footer: 9, toc: 10.5, coverTitle: 26 }               # pt
colors: { tableHeaderFill: EDEDED, codeFill: F5F5F5, link: 0563C1, footerText: 808080 }
table: { widthCm: 17.0, cellPaddingTwips: [30, 60, 30, 60], afterSpacePt: 10 }
layout: { bodyLineSpacing: 1.5, bodyFirstLineIndentChars: 2, longdocHeadingThreshold: 3, h1PageBreak: true }
toc: { depth: 3, bookmarkDepth: 6 }
output: { dirName: docconvert-out, docxExt: .docx, pdfExt: .pdf }
log: { fileName: conversion-log.jsonl }
images: { maxWidthCm: 17.0 }
~~~

**黑名单（出现即启动失败）**：任何 `path/url/http/template/reference/theme/date/time/random/seed`；模板覆盖、字体文件路径、引擎路径、并发度、页眉页脚内容、内容改写规则（繁简/全半角/标点替换）（REQ-TPL-006）。实现方式：**键名 + 值双向关键词扫描**，命中即 `template-missing`。

### 4.5 字体回退（运行时探测，不写死结果）

- 顺序（写死，REQ-PLAT-003）：CJK `微软雅黑 → Microsoft YaHei UI → PingFang SC → Hiragino Sans GB → Noto Sans CJK SC → Source Han Sans SC → SimSun → 系统默认无衬线`；Latin `Calibri → Carlito → Arial → Helvetica`；Mono `Consolas → Menlo → DejaVu Sans Mono → monospace`。
- 探测时机：启动预检第 ④ 步（**不阻断**）；结果写入 `BuildInfo.fontStack` 与日志 `fonts`；回退发生时 stderr 打 **1 条** `WARN font-fallback`（每次运行最多 1 条，REQ-PLAT-003）。
- 写进 DOCX 的是**首选名**而不是回退名：这样同一份 DOCX 在不同机器上由本地字体解析，符合「模板只描述意图」；**代价**是跨平台字体集合不同 → DOCX 字节可能不同（可复现的限定条件，见 §8.5）。

### 4.6 模板版本与校验

- 模板版本 = `SHA-256(templates/reference.docx)` 的**前 12 位十六进制**（REQ-TPL-003）；写入 `--version`、日志 `template.version`、`BuildInfo.templateVersion`。
- 启动校验（预检第 ② 步）：文件存在 → ZIP 可解析 → 必需部件齐全 → `styles.xml` 关键值 == `default.yml` 声明值。任一失败 → `template-missing`（退出码 4），**不产生产物**。
- 模板由 `tools/build-template.js` 在构建期从 `default.yml` 生成（开发期工具，**不进运行时依赖图**）；模板本身提交进仓库并随 npm `files` 发布。

---

## 5. 六项决策（决策 + 理由 + 缺陷编号 + 证据行）

### D1｜PDF 引擎路线 = LibreOffice Kit 0.1.5（native），PDF 只从 DOCX 导出

**决策**：`@deepseek-ai/libreoffice-kit@0.1.5`（CLI `dsoffice convert` 或 Node API `createConverter`）；PDF **只从 DOCX 导出**，不允许从 AST/HTML 渲染；不自研 PDF 排版引擎。

**理由**（三条，按重要性）：
1. **页码与目录页码是 P0，只有分页器能给。** 浏览器 CSS 无法可靠控制分页（缺陷 1 证据：md2pdf-skill「页码不支持」）；LaTeX 能，但引入 TeX 数 GB 且中文配置重（workspace-survey §1.2 不推荐）。
2. **PDF 书签是两遍法的测量仪。** 实测 PDF outline 天然覆盖全部标题层级（H1→level 0 … H5→level 4 严格对应），与 TOC 域相互独立——这是缺陷 4 的唯一可行解（spike §1.4、§1.9 补测）。
3. **同一份 DOCX = 一套版式。** 满足「内容与排版分离」与裁决①；PDF 与 DOCX 的目录页码共享同一份回填值。

| 缺陷 | 证据行 |
|---|---|
| 缺陷 1 | brief reference:0（CSS 页码不可控）；external-tools-survey.md §2.3（md2pdf-skill「页码不支持」） |
| 缺陷 4 | spike-report.md §1.3（updateFields 无效）、§1.4（书签覆盖全层级）、§1.5（34/34）、§1.9（300/300） |
| 缺陷 2 | spike-report.md §2.3（解析顺序实测）、§2.7（缓存 tarball 存在→本机离线可行）、§2.8（README 安装要点） |

**被否决方案**：
| 方案 | 否决理由 |
|---|---|
| 浏览器/Chromium 打印 | 页码不可控；需第二套 HTML/CSS 版式；体积大；与裁决⑤ 冲突（缺陷 1） |
| LaTeX（xelatex） | 未安装、数 GB、中文字体配置重、无法零配置（workspace-survey §1.2） |
| Pandoc + weasyprint/wkhtmltopdf | 仍需 HTML 或 TeX 后端；Pandoc 未安装；表格退化（缺陷 3） |
| 自研 PDF 写出器 | 需要字体嵌入/换行/分页/书签全套实现，工作量与风险远超项目边界；且违背裁决① |

### D2｜DOCX 生成路线 = 自写 OOXML 薄层（Node 内置 zlib），不用 Pandoc、不引入 docx 库

**决策**：`src/docx/**` 直接构造 OOXML 部件并用 `node:zlib` 打包 ZIP；样式来自模板；不引入任何 DOCX 生成库。

**理由**：
1. **Pandoc 结构性不可满足 ≈ 47% 的生成类需求**（§1 缺陷 3 Q3 的估算表），其中表格固定列宽、TOC 完整缓存、DOCX 字节级三项属「全有或全无」。
2. **`docx` 库封装掉了字节级可复现所需的 ZIP 头/条目顺序/压缩参数/core.xml 时间**，改造量 ≥ 自写（缺陷 6 Q3）。
3. **可行性已被 spike 证明**：`mkdocx.mjs` 用纯 Node 内置模块手写 OOXML + ZIP，成功生成 34 标题与 300 标题两档文档并被 kit 正确转换（spike §1.2、§1.9）。
4. **裁决②**：除 kit 外零第三方运行时依赖（REQ-REUSE-004 P0）。

| 缺陷 | 证据行 |
|---|---|
| 缺陷 3 | brief reference:3/4（Pandoc 列宽塌陷、缺 `w:tblGrid`）；§1 缺陷 3 的 75 条估算表 |
| 缺陷 6 | brief reference:10/11（`docx` 库存在）；external-tools-survey.md §2.2（markdownforge 用 `docx ^9.5.1`，证明纯 Node 可行） |
| 缺陷 5 | spike-report.md §1.6（同一 DOCX 字节一致 `E7DFDE38…`） |

**被否决方案**：Pandoc（见缺陷 3）；`docx@9.x`（字节控制 + 零依赖冲突）；Python + python-docx（双运行时，workspace-survey §5.2）；HTML→DOCX（`html4docx` 仅缓存、无法控制样式，workspace-survey 表 1）。

### D3｜可复现层级 = DOCX 字节级 + PDF 版式与内容级

**决策**：DOCX 承诺 **SHA-256 稳定**；PDF 承诺 **页数/页面尺寸/逐页文本/目录页码**稳定，**不承诺**字节一致；日志记录足以第三方复算的全部字段（§3.1.5、§8）。

**理由**：
1. DOCX 侧可控性完整（ZIP 头、时间、ID 全部由我们写），实测已字节一致（spike §1.6）。
2. PDF 侧 kit **不暴露** CreationDate/ID 注入点（spike §2.6 契约表只有 `convert/capabilities`），两次导出仅 XMP 时间戳不同 → 字节级不可达，强行做 PDF 后处理等于引入 PDF 重写器（违背零依赖与范围）。
3. 「版式与内容级」已足以支撑交付判据：用户看到的是页数与页码，而不是字节。

| 缺陷 | 证据行 |
|---|---|
| 缺陷 5 | brief reference:8/9；spike-report.md §1.6（DOCX 一致 / PDF 仅时间戳不同） |
| 缺陷 2 | spike-report.md §2.6（kit 输出契约无元数据参数） |

**被否决方案**：PDF 字节级（需 PDF 重写器 + 元数据归一化，OQ-04 已登记 v2 再议）；「不承诺任何可复现」（违反核心差异点）。

### D4｜零配置边界 = 只要 Node；引擎随 npm；冲突时可复现优先

**决策**：用户前置只有 **Node ≥ 22.19**（推荐 24.x）+ 允许安装期联网；程序自带解析器/生成器/模板/配置；**无任何用户可改项**；首次安装约 70 MB 下载、182 MB 解压，Windows 另需 VC++ v14 运行库；安装后可完全离线。

**理由**：
1. 「零配置」的可判定定义（REQ-NFR-006）：安装后 `docconvert a.md` → 两个产物，零参数零配置。**不是**「零依赖」——任何能出 PDF 的工具都必须有分页器。
2. 与 docconvert-cli 的落差正来自「把依赖转嫁给用户」（Python/Pandoc/xelatex，external-tools-survey §2.1）——我们用 npm 依赖把这份负担自动化。
3. 首次安装需联网是 spike 实测结论（spike §2.7）；DSH 环境可零安装复用 npx 缓存（§2.3 D1）；两条路径都写进 README（spike §2.8）。

| 缺陷 | 证据行 |
|---|---|
| 缺陷 2 | brief reference:1（docconvert-cli 依赖清单）、reference:2（markdownforge 文档滞后）；spike §2.7/§2.8；workspace-survey §5.1（引擎分发三选项） |

**被否决方案**：要求用户预装 LibreOffice（违背零配置）；vendored 引擎（数百 MB 进仓库）；「系统有 soffice 就用」的模糊探测（版本不可控，破坏可复现）。

### D5｜TOC 页码策略 = B 两遍法（P0），updateFields 不带

**决策**：长文（H1–H3 ≥ 3）→ 封面 + 目录（仅 H1–H3）+ 正文；目录用 **TOC 域 + 完整缓存 + 标题书签**；页码由 **两遍法**实测回填；`w:updateFields` **不写**；PDF 书签覆盖 H1–H6。

**理由**：
1. LibreOffice 不刷新 TOC 域、不尊重 `w:updateFields`（spike §1.3 四变体实测）→ 缓存是我们唯一能控制的页码载体。
2. 两遍法两档实测均 100%：34 条 34/34（§1.5）、300 条 65 页 300/300 且一次收敛（§1.9）→ 可行性与规模无关。
3. 不带 `updateFields` 才能满足 REQ-TOC-010「默认无未声明的更新域弹窗」（详见 §7.2）。

| 缺陷 | 证据行 |
|---|---|
| 缺陷 4 | spike-report.md §1.3、§1.5、§1.7、§1.9 |
| 缺陷 1 | brief reference:0；REQ-LAY-012 / V7 / V9 |

**被否决方案**：A 原生单遍（实测不可行，spike §1.3）；C 无页码降级（不满足 P0，仅作工期兜底 §7.3）；「生成阶段算页码」（无分页器参与，不可能）。

### D6｜依赖清单 = Node 内置 + kit 0.1.5（唯一第三方），开发期零 npm 依赖

**决策**：见 `dependencies.md`（逐项标：已有/新增/用户可见/程序自带/离线可用性/版本锁定方式）。摘要：

| 类 | 项 | 状态 |
|---|---|---|
| 运行时第三方 | `@deepseek-ai/libreoffice-kit@0.1.5`（+ 平台引擎经 `optionalDependencies` 自动选择） | **新增**（本机为 DSH 缓存副本；项目需声明依赖） |
| 运行时内置 | `node:fs / path / zlib / crypto / child_process / os / url / util / stream` | 已有（Node 自带） |
| 系统资源 | 微软雅黑 / Calibri / Consolas（+ 跨平台回退链） | 已有（不随包分发，REQ-REUSE-002） |
| 程序自带 | `templates/reference.docx`、`config/default.yml` | 本任务冻结 |
| 开发期 | `node:test` / `node:assert`（**无 jest/vitest/ts/eslint**） | 已有（Node 内置），零 npm devDependencies |
| 明确不依赖 | Pandoc / LaTeX / Chromium / 系统 LibreOffice / Docker / Python | 不引入（裁决⑤） |

| 缺陷 | 证据行 |
|---|---|
| 缺陷 2 | spike-report.md §2.4（package.json 建议写法：精确版本 + engines）、§2.9（残余风险） |
| 缺陷 5 | spike-report.md §2.2（引擎文件 735 个 / 182 MB） |

---

## 6. 薄封装评估（结论：**不采用**）

> 本节按用户硬要求**完整保留评估过程**，不省略。结论与用户 2026-10-22 08:05 裁决 C（新开发）一致。

### 6.1 候选与三条件核验

t5 的硬前置结论：**存在一个满足三条件的候选**——npm `markdownforge@0.0.4`（MIT，2025-07-10 发布，0.0.x 个人项目），其余 5 个候选（docconvert-cli、md2pdf-skill、pandoc-docker、md2x、@jabezpauls/md-converter）均不满足（external-tools-survey.md §1 速览表、§3.1）。

| 条件 | markdownforge@0.0.4 | 证据行（external-tools-survey.md） |
|---|---|---|
| a) 一条命令同出 docx+pdf | 通过 | §2.2 L61–L65：`--format` 默认 `pdf,docx`；`processDocument()` 一次生成两种 |
| b) 模板内置 | 通过 | §2.2 L67：内置 default/github/academic 主题 + DOCX 内置 formatting |
| c) 零配置（安装期拉依赖可接受） | 通过 | §2.2 L69–L73：Node>=16；DOCX 纯 `docx` 库；PDF Puppeteer 安装期自动拉 Chromium；源码 `checkPandocAvailability()` 恒为 true |

### 6.2 与 5 项裁决的硬冲突（3 处架构级 + 2 处验收级）

| 裁决 | markdownforge 现状 | 冲突级别 | 证据行 |
|---|---|---|---|
| ① PDF 复用 LibreOffice Kit | PDF 走 **Puppeteer/Chromium** | **硬冲突（架构级）** | survey §3.1 L162；§2.2 L72 |
| ⑤ 浏览器不进 v1 | Puppeteer 是**核心依赖** | **硬冲突** | survey §3.1 L163；§2.2 L58（dependencies 含 `puppeteer ^24.11.2`） |
| ③ 模板以既有中文版式为基线 | 英文主题，DOCX 默认 Calibri、**无 `w:eastAsia`** | **硬冲突（中文版式）** | survey §3.1 L164；§2.2 L77 |
| ④ DOCX 字节级 / PDF 版式级可复现 | 无版本清单、无时间戳固定 | 中风险（需包装层补） | survey §3.1 L165 |
| ② Node 单运行时 | 满足（纯 Node） | 无冲突 | survey §3.1 L166 |

**另有两条非裁决类风险**：0.0.4 最后发布 2025-07-10、个人项目、无稳定 API/模板契约（survey §2.2 L59、L83）；README 与源码对 Pandoc 的表述不一致（§2.2 L71），说明其「零配置」不可被机器验证。

### 6.3 三条路线对比（工作量与验收确定性）

| 路线 | 做法 | 工作量 | 验收后果 |
|---|---|---|---|
| **A 直接薄封装** | `npx markdownforge` + 0.5–1 天包装层（.txt 适配、命名、错误码、版本清单） | **0.5–1 天** | 必须推翻裁决①⑤③；中文版式粗、TOC 无页码、无 .txt → **不满足 P0**，等于交付改名外壳 |
| **B fork 底座** | 保留 Node + markdown-it + docx 库；替换 PDF 后端为 kit、补中文模板、补 .txt、补两遍 TOC、补可复现 | **新开发的 70–80%** | 仍非薄封装；额外继承 0.0.x 上游停滞风险与裁剪成本 |
| **C 新开发** | 复用 kit + 系统字体 + 版式种子；自写解析/OOXML/两遍 TOC | **基准** | 与 5 项裁决、140 条需求、P0 全对齐；关键不确定性已被 Spike 1/1b/2 消除 |

（工作量口径来自 `drafts/thin-wrapper-decision.md` §3 与 survey §3.2 的缺口清单：PDF 后端替换、中文 eastAsia 补全、.txt、可复现、维护风险）

### 6.4 结论：不采用薄封装

**决策：不采用薄封装（A/B 均否），按用户裁决 C 走新开发。** 三条判定：
1. **A 不可行**：它同时违背裁决①⑤③，并且无法满足 P0 中的「中文版式」「目录页码」「.txt 输入」三组需求——不是工程量问题，而是**目标不一致**。
2. **B 不是「薄」封装**：替换 PDF 后端 + 补中文模板 + 补两遍 TOC 后，剩余可复用的只有「markdown-it 解析 + docx 库调用」，而这两块恰好是我们**因为字节级可复现与零依赖裁决而必须自写/自控**的部分（§5 D2）——保留它反而增加一层上游风险。
3. **C 的关键风险已消除**：两遍法可行性（spike §1.5/§1.9）、离线依赖解析（spike §2.3/§2.7）、OOXML 手写可行性（spike §1.2 的 `mkdocx.mjs`）都已有实测证据，架构可以定稿。

**保留的复用点（不因否决而丢弃）**：kit（D1）、Windows 系统字体（REQ-REUSE-002）、既有 DOCX 版式参数与 `fix_docx_layout.py` 的表格规则（REQ-REUSE-003）、`office-export-pdf` 的调用约定（REQ-REUSE-005）。

---

## 7. 追加硬规则（E1 / E2 / E3）

### 7.1 E1｜长文档收敛（>= 50 页）

#### 7.1.1 实测证据（直接引用，不重跑）

| 指标 | 小样本（spike §1.5） | 长文档（spike §1.9） |
|---|---|---|
| 规模 | 34 个 H1–H3（H1 6 / H2 12 / H3 16） | **300 个目录条目**（H1 50 / H2 100 / H3 150），**65 页**，目录占 **14 页**（第 2–15 页） |
| 目录条目数 | 34 = outline 34 | **300 = outline 300（1:1）** |
| 页码一致率 | **34/34 = 100%** | **300/300 = 100%**（mismatches: []） |
| 两遍分页一致性 | 完全一致（8 页 vs 8 页） | **完全一致（65 vs 65，300 条逐项相同）** |
| 耗时 | 单次转换约 3,987 ms | 两次转换 **8,951 ms**（4,269 + 4,682），不含 DOCX 生成/解析（<1 s） |
| 重试次数 | 0 | **0（首轮即收敛）** |
| 页码位数变化 | 占位 00 → 4–8（1 位） | 占位 00 → 16–65（2 位），**未改变行数与分页** |

**长文档 P0 用例已登记**：`test-cases.md` `TC-LONG-TOC-CONV`（P0，样本 `examples/long-50.md`：46,978 字符 / H1–H3 = 135 / 316 行表格），判定含 7 条（页数 >= 50、条目数 = 135、逐条页码零偏差、双跑一致、目录跨页、开销 <= 2x 单遍、降级必须显式）。

#### 7.1.2 收敛判据（写死，实现按此判定）

**不变量（Invariants，设计保证）**：

| 编号 | 不变量 | 实现手段 |
|---|---|---|
| I1 | 第一遍目录 = **完整缓存**（条目数/行数/缩进/制表位与最终一致） | `docx-render(doc, {tocNumbers: null})` 写全文条目 + 页码占位 00 |
| I2 | 回填只替换页码数字文本 | `docx-render(doc, {tocNumbers})` 走同一代码路径，仅数字不同 |
| I3 | 占位宽度 >= 实际宽度（<= 3 位页码不被截断/换行） | 占位 00（两位）+ 右对齐点线制表位；3 位页码属残余风险 R-01 |
| I4 | 目录之外的内容两遍等价 | 同一 AST、同一模板、同一固定时间戳（§8） |

**判定（Decision，运行期判定，四条全过才算收敛）**：

| # | 判据 | 通过条件 | 失败动作 |
|---|---|---|---|
| C1 | 页数稳定 | `outline1.pageCount === outline2.pageCount` | 重试一次 |
| C2 | 书签页序稳定 | 过滤 `level <= 2` 后两条 outline 的 `page` 逐条相等 | 重试一次 |
| C3 | 目录页码正确 | `numbers[i] === outline2[i].page` 对全部 i 成立（`mismatches.length === 0`） | 重试一次 |
| C4 | 条目数对齐 | `numbers.length === entries.length === outline2（过滤后）.length` | 立即判失败（状态不一致）→ 降级 |

#### 7.1.3 失败重试与降级（行为写死，对应 REQ-TOC-005）

| 步骤 | 行为 | 可观察输出 |
|---|---|---|
| 第 1 次校验失败 | 用 `outline2` 重新计算 `numbers`，**重试一次**（总导出次数最多 3 次） | 无用户可见输出（重试记入日志 `toc.retries`） |
| 重试后仍失败 | **照常交付** DOCX/PDF（用最后一次的页码） | stderr 一行 `WARN toc-not-converged: <file>: 目录页码未收敛（第 N 条 <title> 期望 X 实际 Y）`；日志 `toc.converged=false` + `warnings` 含 `toc-not-converged`；**退出码仍 0** |
| 无法测量（无 outline / outline 为空 / 条目数不匹配） | 降级为「目录无页码」 | stderr `WARN toc-degraded: <file>: …`；日志 `toc.mode="degraded"`；**退出码仍 0** |
| 禁止 | 静默通过、以退出码非 0 阻断交付、删掉目录条目 | — |

#### 7.1.4 残余风险与验证方法

| 编号 | 风险 | 验证方法（谁在何时做） | 兜底 |
|---|---|---|---|
| R-01 | **3 位页码**（> 99 页）时列宽/换行变化破坏 I3 | **需要 spike 验证**：构造 > 120 页样本（或把占位强制为 000）跑两遍，比对 C1–C4。方法：复用 `_spike/mkdocx.mjs --chapters=110` + `verifytoc.mjs`。**责任**：开发卡 4b 首日；闸门 2 前完成 | C2/C3 会捕获；捕获后重试一次，仍失败则 `toc-not-converged` 降级（退出码 0） |
| R-02 | 浮动图片 / 跨页表格导致两遍分页漂移（spike 样本**未覆盖**这两类元素） | 用 `examples/image.md` + `examples/table.md` 合成 fixture 跑两遍（并扩展 `TC-LONG-TOC-CONV`） | 同上（重试 + 显式告警） |
| R-03 | H4–H6 干扰映射 | spike §1.9 补测已证明：outline level 严格对应标题级别，`level <= 2` 过滤后 34/34 匹配 | 实现按 `level` 过滤，不按标题文本匹配 |
| R-04 | Word 与 LibreOffice 分页不同 | README 声明（§7.2） | 不承诺 Word 页码 |

### 7.2 E2｜w:updateFields 二选一：**选「不带」**

**决策**：生成的 DOCX **不写** `<w:updateFields>`（`settings.xml` 中该元素不存在）。目录页码来源 = **两遍法实测的 LibreOffice 分页**。

**理由（5 条，缺一不可）**：
1. **零配置承诺下，弹窗属于未声明的副作用。** 带 `updateFields=true` 会让 Word 在打开时询问「此文档包含可能引用其他文件的域…是否更新？」，用户被迫做一次技术决策（REQ-TOC-010 P0 明确「默认不得出现未声明的更新域弹窗」）。
2. **带 `true` 会让 Word 用自己的分页覆盖我们回填的页码**（用户点「是」后），导致同一份 DOCX 的目录页码与随附 PDF 不一致——而我们的承诺是「DOCX 与 PDF 共享同一份目录页码」（spike §1.7 约束 4）。
3. **对 PDF 导出毫无帮助**：实测 LibreOffice 忽略 `updateFields`（变体 A 与 B 产物字节完全相同，spike §1.3），带的唯一效果是给 Word 用户添麻烦。
4. **两遍法已经给出正确页码**：DOCX 目录缓存 = 第一遍实测值，打开即见、无需 F9（REQ-TOC-003）。
5. **保留可手动刷新的能力**：目录仍是真正的 TOC 域（`fldChar begin/separate/end` + `instrText` 含 TOC 指令与开关 o/h/z/u），用户**主动**按 F9 仍可让 Word 重算——需要时能做，不需要时不被强制。

**Word 打开行为（三场景，写进 README）**：

| 场景 | 本架构（不带 updateFields） | 若带 true（被否决） |
|---|---|---|
| 双击打开 | **无任何弹窗**；目录显示回填页码（= PDF 页码） | 弹「是否更新域」；选「是」→ 按 Word 分页重算（可能与 PDF 不同）；选「否」→ 显示缓存 |
| 打印/另存 PDF | 沿用缓存页码 | 可能用 Word 重算后的页码 |
| 目录页码与 PDF 不同 | 仅在 Word 分页与 LibreOffice 分页不同时发生（长文档可能整体偏移 1 页）；README 声明 | 同样可能不同，但差异被弹窗掩盖，用户以为是「更新失败」 |
| 用户想刷新 | 手动全选 → F9（或右键「更新域」），文档仍可刷新 | 已被强制询问 |

**README 必须原文写入的声明（3 句）**：
1. 「DOCX 的目录页码由 docconvert 在生成时按 **LibreOffice 分页**实测写入，打开即见，无需按 F9。」
2. 「Word 与 LibreOffice 的分页算法不同，长文档在 Word 中的页码**可能整体偏移 1 页**；需要 Word 页码时，请手动更新域（此时目录页码会改为 Word 分页，可能与随附 PDF 不同）。」
3. 「docconvert 不写入 `updateFields`，因此打开文档**不会**出现「更新域」提示。」

> **反悔条件（不推荐，仅登记）**：若未来用户明确要求「Word 中默认自动更新」，需同时满足：README 增加弹窗声明、测试用例新增「弹窗存在性」断言、并接受 DOCX/PDF 页码可能不一致。该变更属路线变更，须回技术负责人裁决。

### 7.3 E3｜预算保护与降级口径

#### 7.3.1 模块预算（冻结，超出需技术负责人批准）

| 模块 | 目录 | 预算 LOC | 说明 |
|---|---|---|---|
| **两遍法后处理（E3 模块）** | `src/toc/**` | **330–550** | `outline.js`（PDF 解析）250–400 + `index.js`（编排/计划/校验/重试）80–150 |
| 其中：PDF outline 解析 | `src/toc/outline.js` | 250–400 | xref/对象流/书签树/页映射/ToUnicode 标题文本 |
| 其中：编排与收敛 | `src/toc/index.js` | 80–150 | `planTocNumbers` / `verifyTocConvergence` / `renderWithToc` / 重试与降级 |
| DOCX 渲染 | `src/docx/**` | 900–1300 | **不含任何 TOC 测量逻辑** |
| Markdown 解析 | `src/markdown/**` | 700–1000 | **不含任何 TOC 逻辑** |
| PDF 封装 | `src/pdf/**` | 150–250 | 只做单次转换 |
| kit 定位 | `src/kit/**` | 150–250 | 解析 + 校验 + doctor |

**保护规则（硬）**：
1. `src/toc/**` 的 330–550 是**独立条目**，不占用 docx-render（卡 3）与 markdown-parser（卡 2）的额度。
2. 反向检查：若卡 3 或卡 2 的实现里出现 `readPdfOutline` / `planTocNumbers` / 页码回填逻辑 → **评审直接打回**（越界实现）。
3. 依赖方向单向：`toc -> docx/pdf`，禁止 `docx/pdf -> toc`。
4. 工期紧时的降级路径**不得**通过「把 TOC 逻辑塞进 docx-render」来省时间——那会同时破坏可复现（DOCX 需要两次分页测量）与预算边界。

#### 7.3.2 v1 降级 C 的触发条件（任一命中，且必须由技术负责人批准）

| # | 触发条件 | 判定方式 |
|---|---|---|
| T1 | 两遍法在 `long-50` fixture 上**两轮联调**后仍无法收敛（C3 持续失败），且 3 个工作日内无法定位 | 开发卡 4b 的联调记录 |
| T2 | 两遍法导致单文件端到端耗时超 NFR-004 预算（<=100 KB/3000 行 <= 30 s；50 页 <= 40 s）且无优化空间 | 基准计时（3 次中位数） |
| T3 | 排期剩余 < **2 个工作日**缓冲，P0 用例 `TC-LONG-TOC-CONV` 无法完成 | 项目看板 |
| T4 | 出现 P0 范围内无法回避的 LibreOffice 分页不稳定（如浮动对象导致 C1 常态化失败） | 复现记录 + spike 结论 |

#### 7.3.3 降级后的交付口径（v1 降 C、B 进 v1.1）

| # | 要求 | 说明 |
|---|---|---|
| G1 | `tocMode` 三处一致写 **`degraded`**（`--version` / 日志 `tocMode` / README），**禁止**写 `two-pass` | REQ-TOC-006 的「不得文档写 A 实际 B」在降级时同样适用 |
| G2 | 目录条目**保留**（H1–H3 全列出），页码列显示 **全角破折号**，不写 0 / 1 / 空白 | 视觉上明确「无页码」而不是「页码错误」 |
| G3 | 每次运行 stderr 输出 **1 条** `WARN toc-degraded`，日志 `warnings` 含同 code | 禁止静默降级 |
| G4 | 退出码**仍为 0**（降级不是失败），但 README「已知限制」必须首条声明 | 与 REQ-TOC-005 的告警口径一致 |
| G5 | `TC-LONG-TOC-CONV` 由 P0 改为「已知限制验收」**必须**技术负责人书面批准，并同步修订 requirements（REQ-TOC-004/009 的 P0 状态） | **开发/架构均不得自行降级需求** |
| G6 | 接口**不变**：`renderWithToc` 仍存在，返回 `TocReport{mode:"degraded"}`；v1.1 只需替换 `src/toc/**` 实现，**不动** docx-render / pdf-render / cli | 保证 v1.1 回归成本最低 |
| G7 | 版本号：v1 发布 `0.9.x`（明确标注 TOC 降级），v1.1 恢复 B 后发 `1.0.0` | 避免用户误以为拿到完整能力 |

---

## 8. 可复现性实现规约（DOCX 字节级）

### 8.1 ZIP 规约（冻结）

| 项 | 规约 | 理由 |
|---|---|---|
| 条目顺序 | **固定常量数组**：`[Content_Types].xml` → `_rels/.rels` → `docProps/core.xml` → `docProps/app.xml` → `word/document.xml` → `word/styles.xml` → `word/settings.xml` → `word/fontTable.xml` → `word/numbering.xml` → `word/footer1.xml`（无封面/无目录时省略无关项也**不得**改变其余顺序）→ `word/_rels/document.xml.rels` → `word/media/*`（按 asset 序号） | 顺序稳定 = 字节稳定 |
| 时间戳 | DOS date = **1980-01-01**、time = **00:00:00**（date=33, time=0）；**不写** extended timestamp extra field | 消除运行时间 |
| 压缩 | 每个条目 `zlib.deflateRawSync(buf, { level: 9 })` 固定参数；正文**不用** data descriptor（`bit 3` 不置位）；无 ZIP64（体积远小于 4 GB） | 压缩输出确定 |
| 元数据 | `versionMadeBy / versionNeeded / externalAttributes / internalAttributes` 全部写常量；无注释、无目录条目 | 消除平台差异 |
| 文件权限位 | `externalAttributes = 0` | 消除 umask 差异 |

### 8.2 OOXML 元数据（冻结）

| 部件 | 规则 |
|---|---|
| `docProps/core.xml` | **产物不写** `dcterms:created` / `dcterms:modified`（REQ-REP-003，TC-REP-03 断言无 ISO 日期）；`dc:creator` = `docconvert`；`cp:lastModifiedBy` **不写**；`cp:revision` = `1`。模板内部可保留固定时间戳（内部构建物，不进入产物，不参与 TC-REP-03） |
| `docProps/app.xml` | `Application` = `docconvert`；`AppVersion` = 程序版本（如 `0.1.0`）；`Company` **不写** |
| 文档属性 | 不写标题/主题/作者（封面标题只出现在正文，不进 core.xml） |
| `word/settings.xml` | 不含 `w:updateFields`；不含 `w:rsids`（避免随机 rsid）；`w:zoom`/`w:defaultTabStop` 固定 |
| `word/document.xml` | 无 `w:rsidR`/`w:rsidRPr` 等随机属性；`w:id` 只用于书签/域且**按文档顺序递增**（1…N） |

### 8.3 随机性与路径（三个「不得」）

1. **不得**写入运行时间、日期、绝对路径、CWD、用户名、主机名、临时目录名（REQ-REP-003）。产物内所有路径类信息一律不出现；图片只以 `media/imageN.png` 形式存在。
2. **不得**使用随机数/随机 ID（包括 `Math.random`、UUID、时间派生 ID）。需要唯一标识时用**文档顺序计数器**。
3. **不得**依赖文件系统枚举顺序（目录遍历与资产顺序都按明确排序键：输入相对路径 Unicode 码点、资产首次出现顺序）。

### 8.4 稳定性排序（三处）

| 场景 | 排序键 | 依据 |
|---|---|---|
| 批处理文件顺序 | 输出相对路径的 **Unicode 码点升序** | REQ-BATCH-002 |
| 目录条目顺序 | 文档顺序（`TocEntry.index` 递增） | REQ-TOC-001 |
| ZIP 内容与媒体编号 | 常量表顺序 / asset 首次出现序号 | §8.1 |

### 8.5 可复现的**限定条件**（必须写进 README，否则等于虚假承诺）

| # | 条件 | 说明 |
|---|---|---|
| L1 | **同一 Node 版本** | DOCX 的 deflate 输出由 Node 内置 zlib 版本决定；跨 Node 大版本可能字节不同。日志已记录 `platform.node`，测试以 `TC-RP-01` 的同一环境为准 |
| L2 | **同一字体集合** | 模板写「首选字体名」，本地字体解析影响分页（不影响 DOCX 字节）。跨平台字体不同 → DOCX 字节相同、PDF 版式可能不同 |
| L3 | **同一模板版本** | 模板 SHA 前 12 位写入日志 |
| L4 | PDF **不承诺**字节一致（允许 XMP CreateDate 与 /ID 差异） | 见 §5 D3 |

### 8.6 验证方法

| 层级 | 方法 | 用例 |
|---|---|---|
| DOCX 字节 | 连续两次（不同 outdir、间隔 >= 2 s、不同 CWD）生成 → SHA-256 相同 | `TC-RP-01`（P0） |
| DOCX 结构 | 解压后检索：无中文日期、无用户名、无绝对路径、无 `w:updateFields`、无 `w:rsid` | 新增自动断言（附录 A.18） |
| PDF 版式 | 页数、页面尺寸、逐页文本、目录页码四项相同 | `TC-RP-02`（P1）、`TC-LONG-TOC-CONV` ④ |

---

## 9. CLI 与批处理语义（冻结）

### 9.1 选项表（唯一允许的集合）

~~~text
docconvert <input...> [options]
docconvert doctor [--json]

  <input>                 .md / .txt 文件或目录（可含中文与空格）
  -o, --outdir <dir>      输出目录；缺省 = 输入所在目录/docconvert-out/
  -r, --recursive         目录递归（仅目录输入有意义；文件输入忽略）
  --format <docx|pdf|both>  缺省 both
  --continue-on-error     单文件失败继续
  -h, --help              用法（退出 0）
  -V, --version           版本清单（退出 0）
~~~

**语义细节（冻结）**：重复选项最后一个生效；`--` 之后按位置参数；`-o` 指向已存在文件 → `usage-error`（2）；相对路径按 CWD 解析；输出目录不存在则连同父目录创建（REQ-OUT-002）。

### 9.2 禁止参数（拒绝且不出现在 --help）

字体/字号/颜色/边距/页面尺寸/模板/参考文档/主题/样式覆盖/页眉页脚内容/编码覆盖/PDF 引擎路径/并发度/日志路径/输出文件名（REQ-CLI-003 全列）。实现方式：解析器维护**允许表**（白名单），任何未知选项一律 `usage-error`，不做「猜用户意图」。

### 9.3 批处理语义（串行，冻结）

| 规则 | 冻结内容 | 需求 |
|---|---|---|
| 收集 | 不加 `-r` 只处理目录第一层；只收 `.md`/`.txt`（大小写不敏感）；跳过以 `.` 开头的文件/目录、`node_modules`、输出目录自身及其子目录；**不跟随**符号链接/联接点 | REQ-BATCH-001 |
| 顺序 | 输出相对路径 Unicode 码点升序，**串行**（OQ-10：v1 不并发） | REQ-BATCH-002 |
| 快速失败（默认） | 首个失败立即停止；**已成功产物保留**，不回滚；未处理记 `skipped` 并写日志 | REQ-BATCH-003 |
| 继续（`--continue-on-error`） | 单文件失败继续；DOCX 成功而 PDF 失败 → 保留 DOCX，状态 `partial` | REQ-BATCH-004 |
| 退出码 | 有失败即非 0（取首个失败文件类别码），开关不改变语义 | REQ-BATCH-005 |
| 汇总 | 每文件一行 `OK /FAIL /SKIP `；末行前 `SUMMARY total=N ok=N failed=N skipped=N elapsed=X.Xs`；有失败加 `FAILED: …`（>5 条省略 `... +N more`）；最后一行 `OUTPUT <abs>` | REQ-BATCH-006 |
| 幂等 | 重复运行覆盖产物，DOCX SHA 不变 | REQ-BATCH-009 |

### 9.4 stdout / stderr 分工（冻结）

- **stdout**：进度行（`OK/FAIL/SKIP`）、汇总（`SUMMARY/FAILED/OUTPUT`）。**不得混入 WARN/ERROR**。
- **stderr**：`ERROR <code>: <说明>` + 一行 `hint:`；全部 `WARN <code>: <file>:<line>: <说明>`，含 `toc-degraded` / `toc-not-converged`（同一文件同一 code 最多 3 条，第 4 条起折叠为一行省略说明，REQ-ELEM-29）。
- **纯文本**：不用 ANSI 颜色/光标控制/进度条；重定向与终端一致（REQ-CLI-007）。
- **无堆栈**：任何路径都不打印调用栈。

### 9.5 边界声明：docx-only 且无 PDF 引擎时的目录页码（C-ARCH-01，**已裁决 (a)**）

**冲突描述**：
- `REQ-TOC-003`（P0）要求「DOCX 目录必须预置完整缓存，打开即见正确页码，无需按 F9」；
- `REQ-DEP-001`（P0）要求「`--format docx` 时引擎缺失不报错」。

在「长文 + 仅 docx + 无 PDF 引擎」这三个条件同时成立时，二者不可同时满足——**页码只能由分页器给出，而分页器就是 kit**。

**架构落点（保证开发可继续，不擅自改需求）**：

| 场景 | 行为 | 退出码 |
|---|---|---|
| `--format both`（默认） | 完整两遍法；DOCX 与 PDF 页码一致 | 0 |
| `--format pdf` | 内部仍生成临时 DOCX（不进 outdir）；两遍法出最终 PDF | 0 |
| `--format docx` + kit **可解析** | **仍执行一次测量**（临时 DOCX → PDF#1 → outline → 回填 → 最终 DOCX），页码正确 | 0 |
| `--format docx` + kit **不可解析** | 交付 DOCX：目录条目完整、页码列占位（全角破折号）；stderr `WARN toc-degraded`；日志 `toc.mode="degraded"` | **0**（遵守 REQ-DEP-001） |
| `--format docx` + 短文（H1–H3 < 3） | 无目录，不涉及页码，不触发任何 kit 调用 | 0 |

**裁决（唯一口径，本表为全文唯一真源）**：**本裁决已由技术负责人 2026-10-22 08:36 批准采用 (a)**——接受上表的降级分支。对外行为固定为：
1. **docx-only + 引擎不可解析** → **不按依赖缺失报错**（退出码 **0**），交付 DOCX（目录条目完整、页码列占位），stderr `WARN toc-degraded`，日志 `toc.mode="degraded"`；
2. **`--format` 含 pdf + 引擎不可解析** → `pdf-engine-missing`（退出码 **4**）+ hint，不产生产物；
3. 配套动作（由需求/文档侧执行，不属本节改动）：requirements 的 REQ-TOC-003 增加限定「需要 PDF 引擎可用」；README「已知限制」增加对应一条。

**历史备选（已否决，仅存档）**：(b) 把「长文 docx-only」纳入引擎硬依赖（改 REQ-DEP-001 的验收）——与 REQ-DEP-001 现有验收直接冲突，不采用。

### 9.6 --version 输出（7 行，顺序固定）

~~~text
docconvert: 0.1.0
node: v24.19.0
template: 3f9c1a7b20de
pdf-kit: 0.1.5
pdf-engine: 0.1.5 (native)
toc: two-pass
fonts: Calibri / 微软雅黑 / Consolas
~~~

引擎不可用时第 5 行输出 `pdf-engine: unavailable`，**仍退出 0**（版本查询不得因环境缺失失败，REQ-CLI-005）。第 5 行显示的是 **Kit 版本 + 后端**，不是 LibreOfficeDev 版本（kit 不暴露）；README 已知限制必须写明。`toc` 行必须与日志 `tocMode`、README 声明**三处一致**（REQ-TOC-006）。

---

## 10. 运行环境与工程结构

### 10.1 目录结构（冻结）

~~~text
docconvert/
  package.json                # type: module, bin: docconvert -> bin/docconvert.js, engines: node >=22.19.0
  bin/docconvert.js           # 唯一入口；把 runCli 返回值交给 process.exitCode
  src/contracts/              # JSDoc typedef + 常量 + 错误码（只读，开发不得改）
  src/preprocess/             # input-preprocess
  src/markdown/               # markdown-parser
  src/txt/                    # txt-structurer
  src/docx/                   # docx-render（OOXML + ZIP + 模板读取）
  src/pdf/                    # pdf-render（kit 封装）
  src/kit/                    # kit-locator + doctor
  src/toc/                    # toc-two-pass（E3 模块，330-550 LOC）
  src/cli/                    # cli（parseArgs / collectInputs / runCli / 汇总）
  src/log/                    # log-writer
  src/config/                 # config-loader（default.yml YAML 子集解析 + 校验）
  templates/reference.docx    # 内置模板（只读；版本 = SHA-256 前 12 位）
  config/default.yml          # 版式与规则常量（白名单）
  tools/build-template.js     # 构建期从 default.yml 生成模板（不进运行时）
  examples/                   # 输入样本（t4 已交付 21 个）
  test/                       # node:test 单测 + 集成脚本
~~~

### 10.2 打包与发布（冻结）

~~~json
{
  "name": "docconvert",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22.19.0" },
  "bin": { "docconvert": "bin/docconvert.js" },
  "files": ["bin", "src", "templates", "config", "README.md", "LICENSE"],
  "dependencies": { "@deepseek-ai/libreoffice-kit": "0.1.5" },
  "optionalDependencies": {},
  "devDependencies": {}
}
~~~

- **精确版本**（无 `^`/`~`）；提交 `package-lock.json`。
- **无 postinstall 脚本**（安装期不做副作用；引擎包由 kit 的 optionalDependencies 机制按平台安装）。
- **无构建步骤**：源码即产物（纯 ESM JS），不存在 `tsc`/bundler 环节 → 安装体积与可复现风险最小。
- **开发期零 npm 依赖**：单测用 `node:test` + `node:assert`。

### 10.3 启动预检顺序（冻结）

| 序 | 检查 | 失败行为 | 需求 |
|---|---|---|---|
| ① | Node 版本 >= 22.19.0 | `runtime-unsupported` / 4 | REQ-DEP-001 |
| ② | 模板存在、ZIP 可解析、必需部件齐全、样式值 == default.yml | `template-missing` / 4 | REQ-TPL-003/005 |
| ③ | `--format` 含 pdf 时引擎可解析 + `capabilities` 含 docx→pdf；**docx-only 需测量但引擎缺失 → 不阻断**，转 §9.5 降级（`WARN toc-degraded` + 页码占位 + 退出码 0） | 仅 `--format` 含 pdf 时 → `pdf-engine-missing` / 4 + hint；docx-only → 不失败（继续转换） | REQ-DEP-001/002、C-ARCH-01 裁决 (a) |
| ④ | 字体栈探测（不阻断） | 仅 `font-fallback` 告警 | REQ-PLAT-003 |
| ⑤ | 输出冲突预检（输出 == 输入；多输入同输出） | `output-conflict` / 2，**不写任何产物** | REQ-OUT-004/005、REQ-BATCH-010 |

**纪律**：预检全部在**写出任何产物之前**完成（REQ-DEP-001）；预检失败时 outdir 内不得新增 docx/pdf。

---

## 11. 风险登记与「需要 spike 验证」项

### 11.1 风险登记（R-01…R-12，按影响排序）

| 编号 | 风险 | 影响 | 缓解 | 责任/时机 |
|---|---|---|---|---|
| R-01 | 3 位页码改变目录行宽 | 长文档（>99 页）页码错位 | 收敛校验 C1–C4 + 重试一次 + 显式告警 | **需要 spike 验证**（开发卡 4b 首日） |
| R-02 | 浮动图片/跨页表格导致两遍漂移 | 页码错位 | 同上；fixture 覆盖 | 开发卡 4b + 测试 |
| R-03 | Word 与 LibreOffice 分页不同 | DOCX 页码与 PDF 不同 | README 声明 + §7.2 | 文档 |
| R-04 | docx-only 无引擎时目录页码缺失 | 局部体验下降 | C-ARCH-01 显式降级 + 告警 | 已裁决 (a)（2026-10-22 08:36），见 §9.5 |
| R-05 | 跨平台字体集合不同 | PDF 版式略有差异 | 回退链 + §8.5 限定条件 | 文档 + 测试 |
| R-06 | macOS/Linux 引擎未实测（本机仅 win32-x64） | 平台承诺失真 | README 支持矩阵；失败给 hint（REQ-PLAT-002 为 P1） | 闸门 3 前 |
| R-07 | 首次安装需联网 68 MB + VC++ 运行库 | 离线目标机不可用 | README 三条安装路径（装/复制 kit/DSH 缓存） | 文档 |
| R-08 | npx 缓存被清理 | 离线解析失效 | env / 项目安装为主路径；缓存仅兜底（spike §2.9） | 实现 |
| R-09 | 表格列宽加权在极端内容下溢出 | 视觉失败 | 固定布局 + 单列最小 1.5 cm + TC-TB-02 | 实现 + 测试 |
| R-10 | Node zlib 版本变化破坏 DOCX 字节一致 | 可复现退化为版式级 | §8.5 L1 限定 + 日志记录 node 版本 | 文档 |
| R-11 | 中文断行（kinsoku）与 Word 不一致 | 行数差异 → 页码偏移 | 只承诺文本与页码口径；不承诺逐行一致 | 文档 |
| R-12 | 模板与 default.yml 漂移 | 样式与声明不一致 | 启动双向一致性校验（§4.1） | 实现 |

### 11.2 需要 spike 验证的项（证据不足，不猜）

| 编号 | 未决问题 | 为什么不能猜 | 验证方法 | 截止 |
|---|---|---|---|---|
| S-01 | 3 位页码（>99 页）是否仍收敛 | spike 长样本最大页码 65（2 位），未覆盖 3 位 | 构造 >120 页样本（`mkdocx.mjs --chapters=110`）+ `verifytoc.mjs`；比对 C1–C4 | 开发卡 4b 首日 |
| S-02 | 浮动图片 + 跨页表格下两遍是否稳定 | spike 样本无图片/宽表 | 用 `examples/image.md` + `examples/table.md` 合成 fixture 跑两遍 | 闸门 2 前 |
| S-03 | macOS/Linux 上 kit 的导出稳定性与字体 | 本机仅 win32-x64 | 目标平台跑 `docconvert doctor` + 一次长文转换 | 闸门 3 前（不阻塞 v1 Windows 交付） |

> 说明：S-01/S-02 属**已设计好兜底**的风险（C2/C3 捕获 + 重试 + 显式告警 + 退出码 0），即便验证失败也不会静默错误，只会降级可见。S-03 影响平台承诺，不影响 Windows 首要目标。

---

## 12. 冻结、变更与评审

### 12.1 冻结范围（开发不得改）

1. `3.12` 的**签名清单**（函数名、参数顺序、返回字段）；
2. `3.1` 的**数据结构字段**（AST / TocEntry / PdfOutline / CliOptions / RunLog / KitLocation）；
3. `3.11` 的**错误码与退出码**；
4. `4.2` 的**模板 token 值**与 `4.3` 的**样式 ID 清单**；
5. `5` 的**六项路线决策**（PDF 引擎 / DOCX 生成 / 可复现层级 / 零配置边界 / TOC 策略 / 依赖边界）；
6. `8.1–8.3` 的**可复现规约**；
7. `9.1` 的 **CLI 选项集合**与 `9.3` 的批处理语义。

### 12.2 变更流程

| 变更类型 | 谁批准 | 必须同步 |
|---|---|---|
| 签名/数据结构/错误码 | 技术负责人 | test-cases.md 的映射、src/contracts、开发卡 |
| 模板 token | 技术负责人 + 设计确认 | default.yml、模板重建、视觉清单 V1–V11 |
| 依赖版本（含 kit 升级） | 技术负责人 | dependencies.md、spike 复核、可复现性重测 |
| 路线（PDF 引擎/DOCX 生成/TOC 策略） | 用户 | requirements、architecture、spike、全部用例 |
| 需求本身（含降级 P0） | 用户 | requirements 优先于本文件 |

### 12.3 冻结声明

**本文件自 2026-10-22 起冻结。开发照 §3.12 实现，不得改签名或换路线；测试照附录 A 建立覆盖；README 照 §5/§7.2/§9 的「必须写进 README」清单撰写。**

### 12.4 变更记录

- 2026-10-22 08:45（技术负责人，t9 评审）：全部 WARN（含 `toc-degraded` / `toc-not-converged`）统一写 stderr；新增 `output-not-writable`（环境 / 退出码 4）。
- 2026-10-22 08:58（技术负责人，t7 验收）：`--version` 的 pdf-engine 行定为「kit 版本 (native)」；显式 DOCONVERT_LIBREOFFICE_KIT 无效时硬失败 4、不回退。

| 日期 | 变更 | 依据 | 影响面 |
|---|---|---|---|
| 2026-10-22 | **C-ARCH-01 一致性修订**：§3.11 的 `pdf-engine-missing` 触发收紧为「`--format` 含 pdf 且引擎不可解析」；§10.3③ 改为「docx-only 需测量但引擎缺失 → 不阻断，转 §9.5 降级」；§9.5 标注裁决 (a) 已批准并写死对外行为三条；§11 R-04 状态同步为「已裁决」 | 技术负责人 2026-10-22 08:36 裁决 C-ARCH-01 (a) | **仅**错误码触发条件（§3.11、附录 F 映射澄清）、启动预检行为（§10.3③）、§9.5 表述与 §11 R-04 状态；**接口签名 / 模板 token / 依赖清单 / 140 条追踪矩阵均未改动** |

---

## 附录 A　140 条需求追踪矩阵

### A.0 说明与统计

> 本矩阵是**闸门 1 的硬交付物**：每条需求 → 实现模块 → 验证方式。**P0 99 条逐条列出，一条不少**；P1 36 条、P2 5 条也逐条列出（不合并省略）。

**验证方式记号**：

| 记号 | 含义 | 谁执行 |
|---|---|---|
| `TC-xxx` | 已有测试用例（test-cases.md 的 35 条之一） | 闸门 2 |
| `AUTO: …` | 自动化断言（闸门 2 前需补的用例；见 A.18） | 测试/开发 |
| `VIS: …` | 人工渲染检查（V1–V11 口径） | 闸门 2 |
| `REVIEW: …` | 人工评审/代码走查 | 评审 |

**模块缩写**：PRE=input-preprocess｜MD=markdown-parser｜TXT=txt-structurer｜DOCX=docx-render｜PDF=pdf-render｜KIT=kit-locator｜TOC=toc-two-pass｜CLI=cli｜LOG=log-writer｜TPL=模板与 config｜REP=可复现规约（§8）｜PLAT=字体与平台｜DIST=打包（package.json）｜NFR=进程边界与护栏｜ALL/DOCS=跨模块/文档。

### A.1　输入（REQ-IN）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-IN-001 | P0 | PRE, CLI | TC-ER-04；AUTO：.MD / .Txt 各一次 → 双产物 |
| REQ-IN-002 | P0 | PRE | AUTO：GB18030 样本汉字可检索；非法字节 → 3/decode-error |
| REQ-IN-003 | P0 | PRE | TC-ER-03；AUTO：0 字节 → 3/empty-input，outdir 无产物 |
| REQ-IN-004 | P0 | PRE, CLI | TC-ER-01；AUTO：空目录 → 3/no-input-files |
| REQ-IN-005 | P0 | PRE, PDF, DIST | AUTO：断网/联网两次 DOCX SHA 相同（复用 REP-001 断言） |
| REQ-IN-006 | P1 | PRE, CLI | AUTO：.markdown → unsupported-extension，提示支持列表 |

### A.2　Markdown 语法（REQ-MD）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-MD-001 | P0 | MD | TC-H-01 / TB-01 / CD-01 / IM-01 / CJ-01；AUTO：examples 全解析 |
| REQ-MD-002 | P0 | MD, TXT | AUTO：中文两行无空格 / 英文两行一个空格（与 TXT 同函数） |
| REQ-MD-003 | P1 | MD, DOCX | AUTO：行尾两空格 → 单段两行（w:br） |
| REQ-MD-004 | P0 | MD | AUTO：未闭合强调 / 列数不齐 / 孤立围栏 → exit 0 + WARN + 原文保留 |
| REQ-MD-005 | P0 | MD, DOCX, TPL | TC-H-01；AUTO：行内代码 sz=21 + 等宽 + 无反引号 |
| REQ-MD-006 | P1 | MD | AUTO：反斜杠转义字面输出且不倾斜 |
| REQ-MD-007 | P2 | MD, DOCX | VIS：左/中/右三列对齐可辨 |
| REQ-MD-008 | P1 | MD, DOCX | TC-H-02；AUTO：#标签非标题；引用内标题不进目录 |

### A.3　.txt 结构化（REQ-TXT）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-TXT-001 | P0 | TXT | TC-TX-01；AUTO：三空行 → 无空段落 |
| REQ-TXT-002 | P0 | TXT, MD | AUTO：CJK 直接相连 / 非 CJK 一空格 |
| REQ-TXT-003 | P0 | TXT | AUTO：去空白后字符序列与源一致 |
| REQ-TXT-004 | P0 | TXT | TC-TX-01；AUTO：4 无序 + 4 有序 → numPr >= 8 |
| REQ-TXT-005 | P0 | TXT | AUTO：竖线 / 引用 / 图片语法逐字保留为段落 |
| REQ-TXT-006 | P0 | TXT | AUTO：requirements §2.3.4 三个示例逐字对齐（fixture） |
| REQ-TXT-007 | P1 | TXT | AUTO：无标题 → 封面标题 = 文件名 + no-heading-detected |

### A.4　输出（REQ-OUT）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-OUT-001 | P0 | CLI, LOG | TC-H-01；AUTO：两产物同主名、>=1 KB |
| REQ-OUT-002 | P0 | CLI | AUTO：默认 docconvert-out/；-o 相对与绝对；父目录创建 |
| REQ-OUT-003 | P0 | CLI | AUTO：draft/a/b.md → <out>/a/b.docx |
| REQ-OUT-004 | P0 | CLI | TC-ER-07；AUTO：输出 == 输入 → 2/output-conflict 且零产物 |
| REQ-OUT-005 | P0 | CLI | AUTO：a.md + a.txt 同目录 → 预检冲突、零产物 |
| REQ-OUT-006 | P0 | CLI | AUTO：连跑两次同路径覆盖（幂等） |
| REQ-OUT-007 | P0 | CLI | AUTO：outdir 清单 ⊆ {docx, pdf, conversion-log.jsonl} |
| REQ-OUT-008 | P1 | CLI | AUTO：--format pdf → outdir 无中间 docx |
| REQ-OUT-009 | P1 | DOCX, PDF | TC-H-01（Word 打开）；AUTO：%PDF- 头 + 页数 >= 1 |

### A.5　可复现（REQ-REP）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-REP-001 | P0 | DOCX, REP | TC-RP-01（P0） |
| REQ-REP-002 | P0 | PDF, TOC | TC-RP-02；AUTO：页数 / 逐页文本 / 目录页码 |
| REQ-REP-003 | P0 | DOCX, REP | AUTO：解压检索无日期 / 路径 / 用户名 |
| REQ-REP-004 | P0 | LOG | AUTO：两次日志不同、docx 字节相同 |

### A.6　版式（REQ-LAY）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-LAY-001 | P0 | DOCX | AUTO：2 标题样本无封面目录；3 标题样本有 |
| REQ-LAY-002 | P0 | DOCX | AUTO：封面标题 = 首个 H1；正文仍完整渲染该 H1 |
| REQ-LAY-003 | P0 | DOCX | AUTO：标题逐字一致、无自动编号 |
| REQ-LAY-004 | P0 | DOCX | AUTO：块序一致（封面/目录 + 正文，无多余空段） |
| REQ-LAY-005 | P0 | DOCX, TPL | AUTO：pgSz 11906x16838；pgMar 1247/1134 |
| REQ-LAY-006 | P0 | DOCX, TPL | AUTO：Normal = Calibri + 微软雅黑、sz=24、line=360、firstLineChars=200 |
| REQ-LAY-007 | P0 | DOCX, TPL | AUTO：Heading1/2/3 的 sz = 36/30/26 |
| REQ-LAY-008 | P1 | DOCX, TPL | VIS：H4 12pt 粗 / H5 11pt / H6 11pt 斜 |
| REQ-LAY-009 | P0 | DOCX, TPL | TC-TB-01 / TB-02；AUTO：tblLayout fixed + tblW 9638 + tblHeader + cantSplit |
| REQ-LAY-010 | P1 | DOCX | TC-CD-01；VIS：40/120 字符代码均不越右边界、缩进保留 |
| REQ-LAY-011 | P1 | DOCX | VIS：引用左侧竖线连续、文字右移 0.5 cm |
| REQ-LAY-012 | P0 | DOCX | VIS：封面无页脚；第 2 页显示 2、逐页 +1（V7） |
| REQ-LAY-013 | P0 | ALL | VIS：V1–V11 逐条人工渲染检查并存证 |
| REQ-LAY-014 | P1 | DOCX | VIS：封面仅标题 + 8 cm 横线，无日期/作者/路径/页码 |
| REQ-LAY-015 | P1 | DOCX, TOC | VIS：目录条目数 = H1–H3 数；跨页第 2 页不重复「目录」 |
| REQ-LAY-016 | P1 | DOCX | VIS：长文每个 H1 位于页顶；短文无大段空白 |

### A.7　元素三态（REQ-ELEM）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-ELEM-01 | P0 | DOCX | TC-H-01（标题层级断言） |
| REQ-ELEM-02 | P0 | MD, DOCX | TC-CJ-01；AUTO：CJK 拼接后单段 |
| REQ-ELEM-03 | P1 | MD, DOCX | AUTO：硬换行 → 单段两行 |
| REQ-ELEM-04 | P0 | MD, DOCX | AUTO：strong/em run 属性；未闭合按字面保留 |
| REQ-ELEM-05 | P0 | MD, DOCX | AUTO：行内代码等宽 10.5 pt、无反引号 |
| REQ-ELEM-06 | P1 | MD, DOCX | TC-CD-01；AUTO：围栏未闭合 → 到文末均为代码 |
| REQ-ELEM-07 | P1 | MD | AUTO：4 空格缩进 → 段落 + indented-code-unsupported |
| REQ-ELEM-08 | P0 | MD, DOCX | TC-TX-01；AUTO：3 级 numPr + 0.74 cm/级 |
| REQ-ELEM-09 | P1 | MD, DOCX | AUTO：4 级 → 并入 3 级 + list-depth-clamped |
| REQ-ELEM-10 | P1 | MD, DOCX | AUTO：[ ]/[x] 字面保留 + task-list-degraded |
| REQ-ELEM-11 | P0 | MD, DOCX | TC-TB-01；AUTO：缺分隔行 → 段落 + table-malformed |
| REQ-ELEM-12 | P0 | MD, DOCX | AUTO：少列补空 / 多列并入末列 + table-ragged |
| REQ-ELEM-13 | P1 | MD | AUTO：单元格内表格按字面 + table-nested-unsupported |
| REQ-ELEM-14 | P1 | MD, DOCX | VIS：引用竖线；3 级并入 2 级 + quote-depth-clamped |
| REQ-ELEM-15 | P0 | MD, DOCX | AUTO：w:hyperlink 关系存在；PDF 文字完整 |
| REQ-ELEM-16 | P1 | MD | AUTO：非 http(s)/mailto → 文字（目标）+ link-target-degraded |
| REQ-ELEM-17 | P2 | MD | AUTO：裸 URL 不自动识别为链接 |
| REQ-ELEM-18 | P1 | PRE, DOCX | TC-IM-01；AUTO：media 4 个、等比、cx <= 9638 twips |
| REQ-ELEM-19 | P1 | PRE, DOCX | TC-IM-03；AUTO：占位 [图片：alt] + 来源行 + image-degraded |
| REQ-ELEM-20 | P1 | MD | AUTO：脚注标记与定义按字面保留 + footnote-unsupported |
| REQ-ELEM-21 | P0 | MD, DOCX | VIS：水平细线与版心等宽、前后 6 pt（V11） |
| REQ-ELEM-22 | P1 | MD | AUTO：<span>/<br> 原样保留 + inline-html-unsupported |
| REQ-ELEM-23 | P1 | MD | AUTO：HTML 注释原样保留 + 同 code 告警 |
| REQ-ELEM-24 | P1 | MD | AUTO：front matter 原样成段 + front-matter-not-recognized |
| REQ-ELEM-25 | P2 | MD | AUTO：双波浪号原样保留 + strikethrough-unsupported |
| REQ-ELEM-26 | P2 | MD | AUTO：美元符号公式原样保留 + formula-unsupported |
| REQ-ELEM-27 | P2 | MD | AUTO：定义列表等按段落逐字保留 |
| REQ-ELEM-28 | P0 | CLI, LOG | AUTO：3 类降级 → exit 0、ok=1、stderr 3 条 WARN、warnings >= 3 |
| REQ-ELEM-29 | P1 | CLI, LOG | AUTO：10 处缺图 → stderr 3 条 + 1 折叠行；日志 10 条 |

### A.8　目录页码（REQ-TOC）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-TOC-001 | P0 | DOCX, TOC | TC-LONG-TOC-CONV ②；AUTO：目录行数 = H1–H3 数，H4–H6 仅书签 |
| REQ-TOC-002 | P0 | DOCX | AUTO：无「目录」自身 / 封面重复 / 代码内假标题 / 引用标题 |
| REQ-TOC-003 | P0 | DOCX | AUTO：缓存条目齐全 + 解压见书签 + settings 无 updateFields |
| REQ-TOC-004 | P0 | TOC | TC-LONG-TOC-CONV ③④；TC-LG-01 |
| REQ-TOC-005 | P0 | TOC | AUTO：注入漂移 → 重试 1 次 → WARN + converged=false + exit 0 |
| REQ-TOC-006 | P0 | CLI, LOG | AUTO：--version / 日志 / README 三处均为 two-pass |
| REQ-TOC-007 | P0 | PDF | TC-H-02；AUTO：书签覆盖 H1–H6，层级与顺序正确 |
| REQ-TOC-008 | P0 | DOCX | TC-LONG-TOC-CONV；REVIEW：README 含 LibreOffice 分页声明句 |
| REQ-TOC-009 | P0 | TOC | TC-LONG-TOC-CONV ①②③④⑤（P0） |
| REQ-TOC-010 | P0 | DOCX | AUTO：settings 无 w:updateFields；Word 打开无弹窗；取消更新仍有页码 |

### A.9　命令行（REQ-CLI）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-CLI-001 | P0 | CLI | AUTO：重定向无 stdin 环境运行成功、无阻塞 |
| REQ-CLI-002 | P0 | CLI | AUTO：非法选项逐一 → 2/usage-error |
| REQ-CLI-003 | P0 | CLI | AUTO：11 个禁止参数 → 2；--help 输出不含这些串 |
| REQ-CLI-004 | P0 | CLI | AUTO：--help 含用法/选项表/扩展名/默认输出规则/退出码表/示例 |
| REQ-CLI-005 | P0 | CLI, KIT | AUTO：--version 恰 7 行固定键序；引擎缺失仍 exit 0 |
| REQ-CLI-006 | P0 | CLI | AUTO：4 类错误 ERROR <code>: 说明 + hint；无堆栈 |
| REQ-CLI-007 | P0 | CLI | AUTO：重定向输出无 ESC 字节 |
| REQ-CLI-008 | P1 | CLI | AUTO：重复选项最后一个生效；-- 之后按位置参数 |

### A.10　批处理（REQ-BATCH）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-BATCH-001 | P0 | CLI | AUTO：跳隐藏/node_modules/outdir；不跟随符号链接 |
| REQ-BATCH-002 | P0 | CLI | AUTO：两次运行处理顺序一致（输出相对路径码点序） |
| REQ-BATCH-003 | P0 | CLI | AUTO：第 2 个失败 → 第 1 产物在、第 3 记 skipped |
| REQ-BATCH-004 | P0 | CLI, LOG | AUTO：docx 成功 pdf 失败 → status=partial、保留 docx |
| REQ-BATCH-005 | P0 | CLI | AUTO：2 成功 1 失败 → exit 5 且全部处理完 |
| REQ-BATCH-006 | P0 | CLI | AUTO：正则匹配 OK/FAIL/SKIP + SUMMARY/FAILED/OUTPUT |
| REQ-BATCH-007 | P0 | CLI | AUTO：单文件与目录输入的汇总结构一致 |
| REQ-BATCH-008 | P1 | CLI | AUTO：只读子目录 → input-permission，按开关继续 |
| REQ-BATCH-009 | P0 | CLI, DOCX | AUTO：重跑后 DOCX SHA 不变 |
| REQ-BATCH-010 | P0 | CLI | AUTO：多输入同输出 → 预检 2、零产物 |

### A.11　依赖与错误（REQ-DEP）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-DEP-001 | P0 | CLI, KIT, TPL | TC-DP-01 / DP-02；AUTO：预检顺序 + 失败零产物 |
| REQ-DEP-002 | P0 | CLI, KIT | AUTO：缺引擎/模板 → 恰 1 条 hint、无堆栈 |
| REQ-DEP-003 | P0 | KIT | AUTO：断网与联网检测行为一致（不触网） |
| REQ-DEP-004 | P0 | CLI | REVIEW：实现错误码集合 == requirements §9.1 的 13 条 |

### A.12　日志（REQ-LOG）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-LOG-001 | P0 | LOG | AUTO：覆盖写、UTF-8 无 BOM、LF、每行合法 JSON |
| REQ-LOG-002 | P0 | LOG | AUTO：file 记录字段 schema 校验（必填齐全） |
| REQ-LOG-003 | P0 | LOG | AUTO：末行 type=run，counts 与 SUMMARY 一致 |
| REQ-LOG-004 | P0 | LOG | AUTO：重算 sha256 / bytes 与日志一致 |
| REQ-LOG-005 | P0 | LOG | AUTO：检索正文前 20 字符无命中；无密码/令牌 |

### A.13　模板与配置（REQ-TPL）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-TPL-001 | P0 | TPL, CLI | AUTO：--template 被拒；不存在任何模板入口 |
| REQ-TPL-002 | P0 | TPL | AUTO：解压模板 document.xml 无可见正文文本 |
| REQ-TPL-003 | P0 | TPL | AUTO：改模板 1 字节 → --version template 值变化 |
| REQ-TPL-004 | P0 | TPL | AUTO：CWD 放同名 yml 改字号 → 产物字号不变 |
| REQ-TPL-005 | P0 | TPL | AUTO：白名单外键 → template-missing / 4 |
| REQ-TPL-006 | P0 | TPL | AUTO：关键词扫描 path/url/http/template/date/random/... → 启动失败 |
| REQ-TPL-007 | P1 | TPL | AUTO：开发期逐键改动均可在产物中观察 |

### A.14　平台（REQ-PLAT）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-PLAT-001 | P0 | CLI, PRE | AUTO：中文 + 空格 + 盘符路径全链路（TC-CL-01 覆盖一部分） |
| REQ-PLAT-002 | P1 | CLI, KIT | AUTO：非 Windows 可出 docx；缺引擎 → 4 + hint |
| REQ-PLAT-003 | P0 | PLAT, DOCX | TC-CJ-01；AUTO：仅 Noto 环境中文正常 + 恰 1 条 font-fallback |
| REQ-PLAT-004 | P1 | KIT | AUTO：无 Word/WPS/LibreOffice 环境可完整产出 |
| REQ-PLAT-005 | P1 | CLI | AUTO：>= 300 字符深层路径转换成功 |
| REQ-PLAT-006 | P0 | CLI | AUTO：大小写不敏感下的输出冲突判定 |

### A.15　非功能（REQ-NFR）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-NFR-001 | P0 | CLI, NFR | AUTO：50 个畸形样本无崩溃、均有错误码、无挂起 |
| REQ-NFR-002 | P0 | CLI | AUTO：运行后仅 outdir 有新增；临时目录已清理 |
| REQ-NFR-003 | P0 | PRE | AUTO：输入 SHA/mtime 不变；CWD 无新增 |
| REQ-NFR-004 | P1 | CLI | AUTO：基准计时 3 次中位数；50 页两遍额外 <= 5 s |
| REQ-NFR-005 | P0 | DOCS | REVIEW：README 七项清单逐条核对 |
| REQ-NFR-006 | P0 | ALL | REVIEW：全新环境按 README 5 分钟内产出两文件 |

### A.16　复用约束（REQ-REUSE）

| ID | 优先级 | 实现模块 | 验证方式 |
|---|---|---|---|
| REQ-REUSE-001 | P0 | PDF, KIT | TC-RU-01；REVIEW：无浏览器/TeX/Pandoc 依赖 |
| REQ-REUSE-002 | P0 | PLAT | REVIEW：字体不随包分发；回退链实现 |
| REQ-REUSE-003 | P0 | TPL | REVIEW：token 表「来源」列可追溯到既有 DOCX / fix_docx_layout.py |
| REQ-REUSE-004 | P0 | DIST | REVIEW：dependencies 仅 kit；devDependencies 为空 |
| REQ-REUSE-005 | P1 | PDF | TC-RU-01（dsoffice convert 调用约定） |

### A.17 覆盖统计与自检

| 域 | P0 | P1 | P2 | 小计 | 矩阵内条数 |
|---|---|---|---|---|---|
| IN | 5 | 1 | 0 | 6 | 6 |
| MD | 4 | 3 | 1 | 8 | 8 |
| TXT | 6 | 1 | 0 | 7 | 7 |
| OUT | 7 | 2 | 0 | 9 | 9 |
| REP | 4 | 0 | 0 | 4 | 4 |
| LAY | 10 | 6 | 0 | 16 | 16 |
| ELEM | 10 | 15 | 4 | 29 | 29 |
| TOC | 10 | 0 | 0 | 10 | 10 |
| CLI | 7 | 1 | 0 | 8 | 8 |
| BATCH | 9 | 1 | 0 | 10 | 10 |
| DEP | 4 | 0 | 0 | 4 | 4 |
| LOG | 5 | 0 | 0 | 5 | 5 |
| TPL | 6 | 1 | 0 | 7 | 7 |
| PLAT | 3 | 3 | 0 | 6 | 6 |
| NFR | 5 | 1 | 0 | 6 | 6 |
| REUSE | 4 | 1 | 0 | 5 | 5 |
| **合计** | **99** | **36** | **5** | **140** | **140** |

**自检结论**：
- 矩阵条数 **140 / 140**，与 requirements.md §15.1 的域计数**逐域相等**；缺失 0、重复 0、未登记 0。
- P0 **99 / 99** 全部有实现模块 + 验证方式；P1 36 / P2 5 同样逐条列出（未合并）。
- 每条需求都能回答：**谁实现（模块）**、**怎么证明（用例或方法）**。

### A.18 需要补的自动化用例（移交测试设计，不在本文件冻结）

> 现有 35 条用例覆盖了 11 类排版与错误路径，但**覆盖不到** CLI 契约、日志 schema、模板/配置校验、批处理细则。下列用例 ID 为**建议**，由测试设计者在闸门 2 前补齐；补齐前，对应 P0 需求以 `AUTO` 断言为临时验收依据。

| 建议用例 | 覆盖需求 | 断言要点 |
|---|---|---|
| TC-CLI-01 | CLI-002/003/004 | 非法与禁止选项 → 2；--help 六要素齐全 |
| TC-CLI-02 | CLI-005 | --version 7 行固定键序；引擎缺失仍 0 |
| TC-CLI-03 | CLI-006/007 | ERROR 格式 + hint + 无堆栈 + 无 ESC |
| TC-BAT-01 | BATCH-001/002/006 | 收集规则、码点序、汇总行正则 |
| TC-BAT-02 | BATCH-003/004/005/010 | 快速失败 / partial / 冲突预检 |
| TC-LOG-01 | LOG-001~005 | 覆盖写、schema、真实哈希、隐私 |
| TC-TPL-01 | TPL-001~006 | 模板唯一入口、无内容、版本随字节变、黑名单扫描 |
| TC-TOC-01 | TOC-003/010 | 缓存齐全、settings 无 updateFields、Word 无弹窗 |
| TC-TOC-02 | TOC-005 | 注入漂移 → 重试一次 → WARN + converged=false + 0 |
| TC-REP-03 | REP-003 | 解压检索无日期/路径/用户名 |
| TC-MD-01 | MD-002/004/006 | CJK 拼接、畸形降级、反斜杠转义 |
| TC-TX-02 | TXT-001~006 | §2.3.4 三示例逐字 + 零改写比对 |
| TC-DEP-03 | DEP-003/004 | 断网一致、错误码集合 == 13 条 |
| TC-PLAT-01 | PLAT-001/005/006 | 中文空格路径、长路径、大小写冲突 |
| TC-NFR-01 | NFR-001/002/003 | 畸形样本无崩溃、无越界写、输入不变 |

---

## 附录 B　5 项裁决对齐表

| # | 裁决（原文口径） | 架构落点 | 证据 |
|---|---|---|---|
| ① | **PDF 引擎复用** `@deepseek-ai/libreoffice-kit@0.1.5`（dsoffice）；不自研、不引入浏览器/LaTeX/Pandoc/wkhtmltopdf | §5 D1、§3.6（pdf-render）、§3.7（kit-locator）、§9.5 | spike-report.md §1.5（两遍法实测）、§2.3（解析顺序实测）、§2.6（kit 输出契约） |
| ② | **Node 24 单运行时 + 除 kit 外零第三方运行时依赖**（zip/OOXML/解析/YAML 全用内置能力） | §5 D2、§5 D6、§10.1–10.2、dependencies.md | spike-report.md §2.4（package.json：dependencies 仅 kit、engines>=22.19）；本机 Node v24.19.0 |
| ③ | **模板内置，以既有 DOCX 版式为基线重新设计**（不照搬成品、不暴露覆盖参数） | §4.1–4.6（token 表 T01–T35、样式 ID、default.yml 白名单、双源校验） | workspace-survey.md §7（既有参数表）、表 3（「改造」行）；requirements §4.2、§11.1、REQ-REUSE-003 |
| ④ | **可复现：DOCX 字节级 / PDF 版式与内容级** | §5 D3、§8（ZIP/时间/ID/排序/限定条件）、§3.1.5（日志字段） | spike-report.md §1.6（DOCX 字节一致 `E7DFDE38…`；PDF 两次仅时间戳不同） |
| ⑤ | **浏览器与 LaTeX/Pandoc 不进 v1** | §5 D1/D2、§6（薄封装评估）、§9.2（无引擎参数） | external-tools-survey.md §3.1（markdownforge 与裁决①⑤③硬冲突）；requirements §1.3（范围外清单） |

**自检**：5 项裁决逐项有落点、有证据行，无「裁决 A、架构 B」的错位。

---

## 附录 C　6 项缺陷回应表（逐条，不回避）

| # | 缺陷（brief 编号） | 一句话结论 | 关键证据行 | 决策 |
|---|---|---|---|---|
| 1 | 浏览器路线 PDF 页码不可控 | 必须支持页码（P0）；选 kit；浏览器整条否决；页码是选 kit 的决定性理由之一 | brief reference:0；external-tools-survey.md §2.3（「页码不支持」）；spike §1.3（页脚页码实测） | D1 |
| 2 | 零配置与真实依赖的落差 | 承诺 = 只要 Node；引擎随 npm 分发（68 MB / 182 MB）；冲突时可复现优先；首次安装需联网 | brief reference:1/2；spike §2.7、§2.8；workspace-survey §5.1 | D4 |
| 3 | Pandoc 表格 / 样式退化 | 放弃 Pandoc；估算直接覆盖仅 ≈24%、结构性不可满足 ≈47%；自写 OOXML | brief reference:3/4；§1 缺陷 3 的 75 条估算表 | D2 |
| 4 | LibreOffice 不填充 TOC 页码 | v1 P0；B 两遍法；完整缓存 + 只改数字 + 两遍校验 + 重试一次 + 显式降级 | brief reference:5/6；spike §1.3、§1.5、§1.9 | D5 |
| 5 | 可复现最多只是零星 flag | DOCX 字节级（固定 ZIP/时间/ID）；PDF 版式级（kit 无元数据控制）；日志给第三方验证协议 | brief reference:8/9；spike §1.6、§2.6 | D3 |
| 6 | Node DOCX 生态成熟度 | 不选库、自写薄层；库能力未实测（不猜），以「结构校验 + 引擎往返 + Word 打开」三重验收替代 | brief reference:10/11；external-tools-survey.md §2.2（docx@9.x 生态证据）；spike §1.2（mkdocx.mjs 可行性） | D2 |

> 说明：本表与 §1 的六节正文一一对应；§1 回答 brief 的**全部子问题**（含「如果选浏览器路线…」「如果用 docx 库…」这类反问），本表只作速查。

---

## 附录 D　闸门 1 自查表（对照 drafts/gate1-checklist.md）

| 区块 | 检查项 | 本文件落点 | 状态 |
|---|---|---|---|
| A | requirements / spike / 外部盘点已交付；5 项裁决无冲突 | §0.2、§0.3、附录 B | 通过 |
| B1 | input-preprocess / docx-render / pdf-render / cli 四组签名与错误码 | §3.2、§3.5、§3.6、§3.9、§3.11 | 通过 |
| B2 | AST 字段与三态边界一致 | §3.1.1、§3.1.2（含 v0 差异 V4/V5） | 通过 |
| B3 | `renderDocx` 支持 `tocNumbers`（两遍法所需） | §3.5（`tocNumbers: number[] | null`）、§2.4 差异 V7 | 通过 |
| B4 | pdf-render 的 TOC 策略与 spike 结论一致（B） | §2.4 差异 V1（TOC 上移到 `toc-two-pass`）、§5 D5、§7.1 | 通过 |
| C1 | 模板 token 表（标题 1–3 / 正文 / 表格 / 代码块 / 页边距） | §4.2（T01–T35）、§4.3（样式 ID） | 通过 |
| C2 | 声明「开发只读模板、不硬编码样式、CLI 无覆盖参数」 | §4.1、§3.5、§9.2 | 通过 |
| D1 | dependencies.md 标清已有/新增/离线可用性 | dependencies.md（全表 6 属性） | 通过 |
| D2 | kit 解析方案引用 spike 2 | §3.7、§10.3③、dependencies.md | 通过 |
| D3 | 无新增依赖，或新增写明理由并上报 | dependencies.md（唯一新增 = kit，附理由与上报记录） | 通过 |
| E1 | 长文档收敛：实测证据 + 收敛判据 + 重试 + 降级 + P0 用例 | §7.1（实测表 / I1–I4 / C1–C4 / 重试与降级 / R-01–R-02） | 通过 |
| E2 | updateFields 二选一 + 理由 + Word 打开行为 + README 声明 | §7.2（选「不带」，5 条理由 + 三场景表 + 3 句 README 原文） | 通过 |
| E3 | 两遍法 330–550 LOC 独立模块 + 不挤占预算 + 降级口径 | §7.3（预算表 / 保护规则 / T1–T4 触发 / G1–G7 交付口径）、§2.2 | 通过 |
| G1 | 6 项决策逐项：决策 + 理由 + 缺陷编号 + 证据行 | §5 D1–D6 | 通过 |
| G2 | 6 项缺陷逐条正面回答 | §1（六节）、附录 C | 通过 |
| G3 | 每条「新开发」写明现有工具不可复用也不可改造的具体理由 | §5 D2、§1 缺陷 3/6（Pandoc 估算表、docx 库三条否决） | 通过 |
| G4 | 每条「复用」写明对应缺陷编号与失败模式规避 | §5 D1（kit）、§4（版式种子）、附录 B | 通过 |
| G5 | 证据不足处写「需要 spike 验证」+ 验证方法 | §11.2（S-01/S-02/S-03）、§7.1.4（R-01） | 通过 |
| G6 | 不写实现代码、不留「以后再看」的空白 | 本文件仅含契约与决策；§11.2 的项均带兜底与截止 | 通过 |
| G7 | dependencies.md 每项 6 属性 | dependencies.md | 通过 |
| 附加 | 140 条追踪矩阵（P0 99 条一条不少） | 附录 A（A.1–A.16 逐域，A.17 统计） | 通过 |
| 附加 | 5 项裁决对齐表 | 附录 B | 通过 |
| 附加 | 6 项缺陷回应表 | 附录 C | 通过 |

---

## 附录 E　接口草案 v0 的 15 个待填项（已全部回填）

| ID | 原待定项 | 冻结结论 | 落点 |
|---|---|---|---|
| TBD-01 | 默认输出目录、同名冲突与覆盖策略 | 单文件/目录输入均为 `<输入所在目录>/docconvert-out/`；已存在产物**覆盖**（幂等）；输出路径 == 任一输入 → 预检 `output-conflict`（2），零产物 | §9.1、§3.11、REQ-OUT-002/004/005/006 |
| TBD-02 | `--format` 缺省值与非法组合 | 缺省 `both`；仅接受 `docx`/`pdf`/`both`；其它 → `usage-error`（2） | §9.1 |
| TBD-03 | .txt 标题识别最终规则 | requirements §2.3.1 优先级表（Setext → 首行 → 分隔线 → 列表 → 段落）+ §2.3.3 列表细则 + 消歧规则；中文序号不识别 | §3.4 |
| TBD-04 | 图片：远程 URL / SVG / 缺失文件三态 | **支持**：本地相对路径 + PNG/JPEG + 可读；**降级**：http(s)/data:/绝对路径/缺失/SVG/GIF/WEBP → 占位 `[图片：alt]` + 来源行 + `image-degraded`；**不下载、不读取绝对路径** | §3.2、§3.1.2 |
| TBD-05 | 脚注是否保留 AST 节点与三态 | **不保留节点**；按字面文本 + `footnote-unsupported`（v0 差异 V4） | §2.4、§3.1.1 |
| TBD-06 | 任务列表三态 | **降级**：普通列表项 + 字面前缀 `[ ]`/`[x]` + `task-list-degraded`；`checked` 字段删除（v0 差异 V5） | §2.4、§3.1.1 |
| TBD-07 | TOC 策略 | **B 两遍法**（native / none 排除）；`updateFields` 不带 | §5 D5、§7.1、§7.2 |
| TBD-08 | 模板 token 最终值 | §4.2 的 T01–T35（A4 11906x16838、边距 1247/1134、正文 12pt/1.5 倍/首行 2 字符、H1–H3 18/15/13、表格 8.5pt/9638 twips、代码 Consolas 9pt #F5F5F5、页脚 PAGE 9pt #808080） | §4.2 |
| TBD-09 | `config/default.yml` 字段白名单 | §4.4 的 YAML 全文 + 黑名单关键词 | §4.4 |
| TBD-10 | 日志落盘路径与 stdout 摘要 | `<outdir>/conversion-log.jsonl`（覆盖写）；stdout = `OK/FAIL/SKIP` + `SUMMARY` + `FAILED` + `OUTPUT` | §3.10、§9.3/§9.4 |
| TBD-11 | 字体回退栈 | §4.5（CJK 8 级 / Latin 4 级 / Mono 4 级），运行时探测、失败 1 条告警 | §4.5 |
| TBD-12 | kit 解析顺序与缺依赖提示 | §3.7（env → 项目 → 全局 → npx 缓存 + 四条件校验）；错误三路径 hint | §3.7、§10.3③ |
| TBD-13 | 退出码映射与 `--continue-on-error` 语义 | §3.11（0/1/2/3/4/5）；开关不改变「有失败即非 0」 | §3.11、§9.3 |
| TBD-14 | 版本号来源与模板版本记录 | 程序版本 = `package.json.version`；模板版本 = 模板 SHA-256 前 12 位；两者写 `--version` 与日志 | §4.6、§3.1.5 |
| TBD-15 | 目录遍历规则 | 首层/递归、白名单扩展名、跳过 `.` 开头 / `node_modules` / 输出目录自身、不跟随符号链接；码点序串行 | §9.3 |

---

## 附录 F　test-cases.md 第 9 节的参数名映射（回填，一次性替换）

> test-cases.md 用 `dc` 与 `--to`/`--reference`/`--no-title`/`DOCONVERT_PDF_ENGINE` 占位。**以本表为准替换**，用例正文不需要逐条改。

| test-cases 写法 | 定稿替换为 | 说明 |
|---|---|---|
| `dc <input> -o <outdir>` | `docconvert <input> -o <outdir>` | 入口 = `bin/docconvert.js`（npm `bin: docconvert`） |
| `--to docx,pdf` | `--format both`（或 `--format docx` / `--format pdf`） | 单值枚举，**不是**逗号列表 |
| `--reference <docx>` | **不存在** | 传入 → `usage-error`（2）；TC-ER-06 记 N/A |
| `--no-title` | **不存在** | v1 不提供；TC-TX-02 记 N/A |
| `DOCONVERT_PDF_ENGINE=<path>` | `DOCONVERT_LIBREOFFICE_KIT=<kit 包目录>` | 值是 **kit 包目录**（不是 `cli.js`）；TC-DP-01 改为指向不存在的目录 |
| `$KIT`（硬编码 npx 哈希路径） | `node -e "…locateKit()…"` 或 `docconvert doctor --json` 输出的 `cliPath` | 产品与用例都**不得**硬编码 `_npx/<hash>` |
| 预期退出码 0/1/2/3（test-cases 第 7 节提案） | **0/1/2/3/4/5**（以 requirements §7.2 为准） | 「引擎缺失」= **4**（不是 2；**仅当 `--format` 含 pdf**；docx-only 引擎缺失走 §9.5 降级、退出码 0）；「转换失败」= **5**（不是 3） |

**受影响的用例（测试设计者据此一次性回填）**：TC-ER-01（3）、TC-ER-02（4）、TC-ER-04（3）、TC-ER-06（N/A）、TC-DP-01（4）、TC-DP-02（0）、TC-TX-02（N/A）、TC-ALL（入口与 `--format` 替换）。

---

## 附录 G　术语与缩写

| 术语 | 定义 |
|---|---|
| kit | `@deepseek-ai/libreoffice-kit@0.1.5`（native 后端，内含 LibreOfficeDev 引擎与 `dsoffice` CLI） |
| 两遍法（B） | DOCX 预置完整目录缓存（页码占位）→ PDF#1 → 解析书签得标题落页 → 回填页码 → PDF#2 → 收敛校验 |
| 完整缓存 | 目录条目数/行数/缩进/制表位与最终一致，仅页码为占位值 |
| 收敛 | 两遍分页一致 且 目录页码与第二遍书签页逐条相等（C1–C4 全过） |
| 降级 | 不按原语义渲染但**内容不丢失**，产生 `WARN` 与日志记录 |
| 不支持 | 不解析该语法，按字面文本保留并告警（`.txt` 的降级不告警） |
| 长文 / 短文 | H1–H3 标题数 >= 3 为长文（封面 + 目录 + 正文）；否则短文 |
| 物理页序 | PDF 绝对页号，封面记 1，目录页计入 |
| 输出冲突 | 多个输入映射到同一输出路径，或输出路径等于某输入路径 |
| 模板版本 | `templates/reference.docx` 的 SHA-256 前 12 位十六进制 |
| 独立预算 | 模块 LOC 额度互不挪用（§7.3）：`src/toc/**` 330–550 单列 |
| PKG / DIST | 打包与发布面（`package.json`、`files`、`bin`、`engines`） |

---

*本文件为阶段 0.5 闸门 1 的架构定稿。签名、token、错误码、决策与可复现规约自本版起冻结；变更走 §12 流程。*
