# docconvert

**一条命令，把 .md / .txt 变成排版好的 .docx 与 .pdf。**
模板内置 · 零配置 · 内容与排版分离 · 输出可复现

[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.19-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-1%20%28kit%29-orange)](package.json)
[![Zero config](https://img.shields.io/badge/config-zero-success)](README.md)
[![CI](https://github.com/QTATQ233/docconvert/actions/workflows/test.yml/badge.svg)](https://github.com/QTATQ233/docconvert/actions/workflows/test.yml)

---

## 它解决什么问题

你手里有一份 Markdown 或纯文本稿子，需要在几分钟内变成「能直接发出去」的 Word 与 PDF：有封面、有多级标题、有目录和页码、中文排版正确。你不想写 YAML、不想装 Pandoc 与 LaTeX、不想和字体 / 页边距 / 样式表搏斗，也不想每次生成的文档长得不一样。

`docconvert` 只做这一件事，并且把「怎么排」从你手里拿走：

| 特性 | 含义 |
| --- | --- |
| **一条命令，双产出** | `docconvert input.md` → `input.docx` + `input.pdf`，共享同一份版式与同一套目录页码 |
| **模板内置** | `templates/reference.docx` 随包分发、运行期只读；你既不需要、也不应该修改它 |
| **零配置** | 不读任何用户配置文件；没有任何样式参数——想调字体 / 字号 / 边距会被直接拒绝（退出码 2） |
| **内容与排版分离** | 输入只提供内容；版式由内置模板 + 随包只读的 `config/default.yml` 决定 |
| **输出可复现** | 同程序版本 + 同模板版本 + 同 Node 大版本 + 同输入 → DOCX **字节级**一致（SHA-256 相同） |

> **本文的证据口径**：所有命令与输出都在本仓库实测（Windows x64 / Node 24.19.0 / kit 0.1.5）。标注「实测 / 原样」的片段逐字粘贴、未改写；绝对路径用 `<仓库根>` 代替（正文另有说明）。命令示例以 PowerShell 为主，bash 下去掉 `.\` 前缀即可。

**阅读路线**：只需要跑通 → 直接看 **§2**；要装环境 → **§1**；先判断能不能用 → **§7**；给自动化代理 → **§2.4**。

---

## 1. 安装

### 1.1 前置条件

| 项 | 要求 |
| --- | --- |
| Node.js | **>= 22.19.0**（推荐 24.x；`package.json` 的 `engines` 已声明） |
| 磁盘 | PDF 引擎解压后 **182 MB**，建议预留 ≥ 250 MB |
| 网络 | **首次安装需要联网**：kit tarball 104 KB + 平台引擎 tarball ≈ **68 MB** |
| Windows x64 | 需要 Microsoft Visual C++ v14 运行库（kit 不捆绑；多数开发机已具备） |

### 1.2 四种安装路径

> ⚠️ **本交付尚未发布到公共 npm registry**。`npm install -g docconvert` 与 `npm install --save-dev docconvert` 是**发布后**的常规路径；当前请用本地安装（`npm install -g ./docconvert`，或先 `npm pack` 再 `npm install -g ./docconvert-0.1.0.tgz`），或直接 `node bin/docconvert.js ...`。无论哪条路径，首次都需要能拿到 `@deepseek-ai/libreoffice-kit@0.1.5`（联网安装，或复用已有项目依赖 / npx 缓存，见 §1.3）。

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 全局安装（**发布后**） | `npm install -g docconvert` | 首次会下载 kit 与平台引擎，约 68 MB |
| 本地全局安装（**当前可用**） | `npm install -g ./docconvert`；或 `npm pack` 后 `npm install -g ./docconvert-0.1.0.tgz` | 指向本地包目录 / 自建 tarball，不需要 registry。实测 `npm pack` 产出 **docconvert-0.1.0.tgz**（99,633 B，含 `bin/`、`src/`、`templates/`、`config/` 与 `README.md`） |
| 项目内安装（**发布后**） | `npm install --save-dev docconvert`，然后 `npx docconvert ...` | 版本随项目锁定，可复现性最好 |
| 本仓库直接跑（**零安装**） | `node bin/docconvert.js ...` | 源码即产物（纯 ESM、无构建步骤、无 postinstall）；kit 已有缓存时**无需联网** |

安装后自检：

```powershell
docconvert --version
docconvert doctor
```

### 1.3 已装过 kit 的机器（含 DSH 环境）：不用再下载

程序按以下顺序找 PDF 引擎，**任一处命中即可离线运行**：

1. 环境变量 `DOCONVERT_LIBREOFFICE_KIT`（显式指定，优先级最高）
2. 项目 `node_modules/@deepseek-ai/libreoffice-kit`
3. npm / npx 缓存（兜底）

本仓库实测就是「未装 `node_modules`、复用 DSH 的 npx 缓存」：

```text
> node bin/docconvert.js doctor
kit: 0.1.5（来源：npx-cache）
engine: native 0.1.5
path: <npm 缓存>\...\node_modules\@deepseek-ai\libreoffice-kit
candidates: 8（用 --json 查看明细）
```

> `path` 一行原文是完整绝对路径，这里用 `<npm 缓存>` 代替用户目录（交付文档不写入任何个人信息）；`--json` 可看到全部 8 个候选及各自的失败原因（例如「version mismatch: 0.1.2」）。

### 1.4 离线 / 手工指定 kit

```powershell
# 显式指定 kit 目录（优先级最高）
$env:DOCONVERT_LIBREOFFICE_KIT = "D:\tools\libreoffice-kit"

# 目标机无网：把已装好的 kit 目录整包复制过去，再指过去
```

**注意**：显式指定的目录无效时是**硬失败**（退出码 4，`pdf-engine-missing`），不会静默回退到自动探测——显式覆盖代表你的意图，静默回退会造成「同一命令、不同机器、不同结果」。

### 1.5 macOS / Linux

源码是纯 ESM、无原生编译、无构建步骤，但 **v1 只在 Windows x64 做过实机验证**：macOS / Linux 上引擎可用性、字体集合、分页稳定性均**未完全验证**。在这些平台请先：

```bash
npx docconvert doctor
```

PDF 引擎不可用时 `--format docx` 仍然完全可用（见 **§7.6**）。

---

## 2. 10 秒上手（实测）

### 2.1 跑一次

```powershell
node bin/docconvert.js examples/cjk.md -o out/readme-demo
```

**stdout（原样）**：

```text
OK examples\cjk.md
SUMMARY total=1 ok=1 failed=0 skipped=0 elapsed=4.6s
OUTPUT <仓库根>\docconvert\out\readme-demo
```

> `OUTPUT` 行实际打印的是绝对路径，这里用 `<仓库根>` 代替；其余逐字未改。退出码 `0`。

**stderr（原样，一条降级告警，不影响退出码）**：

```text
WARN strikethrough-unsupported: examples\cjk.md:22: v1 不支持删除线，已按原文保留
```

### 2.2 你得到了什么

`out/readme-demo/` 里实测三个文件：

| 文件 | 实测大小 | 打开能看到 |
| --- | --- | --- |
| `cjk.docx` | 8,277 B | 封面 + 9 条目录（页码已回填，**打开即见、无需按 F9**）+ 9 个标题书签；`settings.xml` 中 `updateFields` 计数为 **0** |
| `cjk.pdf` | 286,440 B | **5 页**；9 个书签（口径 H1–H6）；目录页码与 DOCX 一致 |
| `conversion-log.jsonl` | 1,990 B | 本次运行的完整记录（字段见 **§5**） |

目录条目数 = 输入中 H1–H3 的条数（本例 `examples/cjk.md` 恰好 9 条）；标题少于 3 条的文档不生成目录。

### 2.3 最常用的一条命令

```powershell
node bin/docconvert.js .\我的报告.md
```

不传 `-o` 时，产物落在**输入文件所在目录**的 `docconvert-out/` 下（目录输入则是该目录下的 `docconvert-out/`）。`-o` 可指向任意可写目录：相对路径按当前工作目录解析，目录不存在会连同父目录一起创建。

### 2.4 给另一个 AI（或 shell 脚本）的最短路径

```text
1. docconvert doctor            # 退出 0 = PDF 引擎可用；4 = 不可用（改用 --format docx 降级）
2. docconvert <input> -o <out>  # 退出 0 才算成功
3. 解析 stdout 末两行：SUMMARY total=… / OUTPUT <绝对输出目录>
4. 需要证据：读 <out>/conversion-log.jsonl（JSONL；每个输入一条 file，末行一条 run）
5. 非 0 退出码：stderr 首行 ERROR <code>: <说明>，第二行 hint: <建议>
```

纪律三条：

- **不要猜文件名**：产物 = 输入 basename + `.docx` / `.pdf`，放在 `<out>/<相对路径>` 下。
- **不要忽略 stderr**：每一行 `WARN` 都代表某处内容被降级保留（不是失败，但值得你看一眼）。
- **不要解析 `--help` 当机器接口**：稳定接口是退出码 + `SUMMARY` 行 + `conversion-log.jsonl`。

---

## 3. 命令与选项

### 3.1 用法与选项

```text
docconvert <input...> [选项]
docconvert doctor [--json]
```

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `<input...>` | 文件或目录，可多个 | 必填 | 扩展名 `.md` / `.txt`（大小写不敏感）；路径可含中文与空格 |
| `-o, --outdir <dir>` | 目录 | 输入所在目录/`docconvert-out/` | 相对路径按当前工作目录解析；不存在则创建 |
| `-r, --recursive` | 开关 | 关 | 仅对目录输入有意义；文件输入时忽略（不报错） |
| `--format <docx\|pdf\|both>` | 枚举 | `both` | 只出 docx 时不需要 PDF 引擎（见 §7.6） |
| `--continue-on-error` | 开关 | 关 | 单个文件失败后继续处理其余文件；不改变退出码语义 |
| `-h, --help` | 开关 | — | 打印用法，退出 0 |
| `-V, --version` | 开关 | — | 打印 7 行版本清单，退出 0 |
| `doctor [--json]` | 子命令 | — | 体检 PDF 引擎与候选路径；找到退出 0，找不到退出 4 |

`-V` 不是 `-v`；重复给同一个选项时**最后一个生效**；`--` 之后的参数按位置参数处理。

### 3.2 退出码

| 码 | 含义 | 典型触发 |
| --- | --- | --- |
| **0** | 全部成功 | 含 `--help` / `--version` / 降级告警场景 |
| **1** | 未预期的内部错误 | 程序缺陷（打印 `ERROR internal-error`，不打堆栈） |
| **2** | 参数错误 | 未知选项、缺输入、`--format` 取值非法、`-o` 指向已存在文件、输出冲突 |
| **3** | 输入错误 | 路径不存在、扩展名不支持、空文件、解码失败、目录内无输入、无读取权限 |
| **4** | 依赖 / 环境缺失 | Node 版本过低、内置模板缺失、PDF 引擎缺失、输出目录不可写 |
| **5** | 转换失败 | 渲染阶段失败（看 `conversion-log.jsonl`） |

### 3.3 stdout / stderr 分工（可安全重定向）

| 通道 | 内容 | 用途 |
| --- | --- | --- |
| **stdout** | `OK / FAIL / SKIP` 每文件一行；`SUMMARY total=… ok=… failed=… skipped=… elapsed=…s`；有失败时 `FAILED: …`；最后一行 `OUTPUT <绝对输出目录>` | 机器可读的进度与汇总 |
| **stderr** | `ERROR <code>: <说明>` + 一行 `hint:`；全部 `WARN <code>: <文件>:<行号>: <说明>` | 人读的诊断信息 |

纯文本输出：**无** ANSI 颜色、无进度条、无光标控制、无堆栈，重定向到文件与终端一致。

### 3.4 为什么没有样式参数

**没有** `--font` / `--font-size` / `--margin` / `--page-size` / `--template` / `--reference` / `--theme` / `--header` / `--footer` / `--encoding` / `--engine` / `--concurrency` / `--output-name` 之类的参数——传了就是 `usage-error`，退出码 2（实测 `--bogus` 同样返回 2）。

这不是「还没做」，是设计：

- **内容与排版分离**：一旦允许传字体和边距，同一份稿子在两个人手里就会变成两种版式，「输出可复现」立刻失效。
- **可复现的前提是常量**：版式只在 `config/default.yml` 与内置模板里定义，且随包只读、启动时做双源一致性校验。
- **零配置可被机器验证**：全新环境执行 `docconvert a.md` 必须产出两个文件，零参数、零配置文件。

需要不同版式时的正确做法：**改模板的构建源**（`config/default.yml` + `tools/build-template.js`），而不是在命令行上打补丁。

### 3.5 批量与目录

```powershell
node bin/docconvert.js .\drafts                    # 只处理 drafts 第一层
node bin/docconvert.js .\drafts -r                 # 递归所有子目录
node bin/docconvert.js .\drafts -r -o out --format docx
node bin/docconvert.js a.md b.md c.txt -o out      # 多文件
```

规则：

- 只收 `.md` / `.txt`；跳过以 `.` 开头的文件与目录、`node_modules`、输出目录自身及其子目录；**不跟随**符号链接。
- 顺序固定：输出相对路径的 Unicode 码点升序，**串行**执行（v1 不并发）。
- 目录输入时**保留相对目录结构**：`draft/a/b.md` → `<out>/a/b.docx`。
- 默认**快速失败**：首个失败立即停止，已成功的产物保留不回滚，未处理的记 `SKIP`；加 `--continue-on-error` 则继续。两者退出码语义相同（有失败即非 0，取首个失败文件的类别码）。

实测批量（`examples/` 目录 8 个输入，仅 docx，25.9 s）：

```text
OK examples\README.md
OK examples\cjk.md
OK examples\code.md
OK examples\headings.md
OK examples\image.md
OK examples\long-50.md
OK examples\notes.txt
OK examples\table.md
SUMMARY total=8 ok=8 failed=0 skipped=0 elapsed=25.9s
OUTPUT <临时目录>
```

---

## 4. 模板：内置、只读、带版本号

| 项 | 说明 |
| --- | --- |
| 路径 | `templates/reference.docx`（相对包根，**冻结**，不接受其它值） |
| 大小 | 5,556 B |
| 版本 | 模板文件 **SHA-256 前 12 位** = `eb4f560390ac` |
| 完整哈希 | `eb4f560390ac64b8222bb8bc168aa81d32c98b8bc5aad15843c60fdda28159f6` |
| 样式数 | 23 个（16 个核心样式 + 7 个辅助样式） |

**用户既不需要、也不应该改它**，原因是三件事同时依赖它：

1. **版式来源唯一**：字体、字号、行距、页边距、封面、页脚全部来自这里；改一个字号，长文档分页就变了。
2. **目录页码是「实测」出来的**：页码按**这份模板**在 LibreOffice 里的真实分页写入；换模板 = 页码作废。
3. **可复现**：模板哈希会写进每一条日志；哈希变了，「同一输入、同样输出」的承诺不再成立。

同名文件**不会**被劫持：即使你在工作目录或 `templates/` 子目录里放一份旧的 `reference.docx`，程序仍只认包内那一份（实测两次转换的 `word/styles.xml` 哈希完全一致）。

模板与 `config/default.yml` 在启动时做**双源一致性校验**（样式 `w:sz` == 配置 pt × 2）；不一致视为模板损坏 → `ERROR template-missing`，退出码 4。

---

## 5. 产物与 conversion-log

### 5.1 产物

| 产物 | 命名 | 说明 |
| --- | --- | --- |
| Word | `<相对路径>.docx` | 无「更新域」弹窗；目录页码已写入（§7.1） |
| PDF | `<相对路径>.pdf` | 由 kit 内置 LibreOffice 导出；书签 H1–H6，目录 H1–H3 |
| 日志 | `<out>/conversion-log.jsonl` | 每次运行覆盖写，UTF-8 无 BOM、LF 换行、一行一个 JSON |

**禁止覆盖源文件**：任何输出路径与输入文件相同 → `output-conflict`，退出码 2，一个产物都不写。输出目录不可写 → `output-not-writable`，退出码 4，同样零产物（预检全部发生在写盘之前）。

### 5.2 conversion-log 结构

每次运行先写「每个输入一条 `type:"file"`」，末尾追加一条 `type:"run"` 汇总；运行结束用临时文件 + 原子 rename 覆盖，不会留半截文件。

| 字段 | 内容 |
| --- | --- |
| `program` | `{ name, version }` |
| `template` | `{ version }` —— 模板 SHA-256 前 12 位 |
| `pdfKit` | `{ version, engine, backend }` 或 `null` |
| `fonts` | `{ latin, cjk, mono }` 实际使用的字体栈 |
| `command` | 原始参数数组（便于复现「当时怎么跑的」） |
| `input` | `{ path, bytes, sha256, encoding, extension }` |
| `outputs[]` | `{ format, path, bytes, sha256, durationMs }`（sha256 为磁盘重算值） |
| `status` | `ok` / `partial` / `failed` / `skipped` |
| `errorCode` | 失败时的错误码，否则 `null` |
| `warnings[]` | `{ code, line?, message }` 全部降级告警（见附录 A） |
| `toc` | `{ mode, entries, passes, converged }`；`mode` 只取 `two-pass` / `degraded` |
| `platform` | `{ os, arch, node }` |
| `startedAt / endedAt / durationMs` | 时间戳与耗时（**只进日志，不进产物**） |

实测节选（原样，未改写；来自 §2.1 那次运行）：

```json
"toc": { "mode": "two-pass", "entries": 9, "passes": 2, "converged": true }
```

```json
"counts": { "total": 1, "ok": 1, "failed": 0, "skipped": 0 }, "exitCode": 0, "tocMode": "two-pass"
```

日志里的 `sha256` 可以**独立复核**：

```powershell
(Get-FileHash out/readme-demo/cjk.docx -Algorithm SHA256).Hash.ToLower()
# 5b65dee1b1511e2f043a3e758cec5fe6a2f0495b43b6f5a892d1c9db7ca041f7
```

---

## 6. 可复现性

### 6.1 承诺到什么程度

| 层级 | 承诺 | 实测证据（`examples/cjk.md`） |
| --- | --- | --- |
| **DOCX** | **字节级**：同输入重复运行，SHA-256 完全相同 | 两次运行（`out/readme-demo` 与 `out/readme-demo-2`）均为 `5b65dee1b1511e2f043a3e758cec5fe6a2f0495b43b6f5a892d1c9db7ca041f7` |
| **PDF** | **版式级**：页数、页面尺寸、逐页文本、目录页码相同；**不承诺**字节一致 | 同一输入连续两次运行得到 `a3f533b2…f56d1` 与 `a1ab0f66…c0e38d`（再跑还会变），但都是 5 页、目录页码一致 |

DOCX 能做到字节级，是因为产物的每一处可能漂移的地方都被钉死了：ZIP 条目顺序固定、时间戳固定为 1980-01-01、deflate 参数固定、`core.xml` **不写** `dcterms:created` / `dcterms:modified`、不写用户名与绝对路径、不用随机 ID（书签 ID 按文档顺序递增）。

PDF 之所以只承诺版式级：引擎会在文件里写入创建时间与文档 ID，这是 PDF 格式的正常行为，与本程序无关。

### 6.2 限定条件（不满足时「可复现」不成立）

| # | 条件 | 影响 |
| --- | --- | --- |
| L1 | **同一 Node 大版本** | DOCX 的 deflate 输出由 Node 内置 zlib 决定；跨大版本可能字节不同 |
| L2 | **同一字体集合** | 模板写的是首选字体名；字体解析影响**分页**（不影响 DOCX 字节）。跨平台字体不同 → DOCX 字节相同，PDF 版式可能不同 |
| L3 | **同一模板版本** | 即模板 SHA-256 前 12 位相同（写入每条日志） |
| L4 | **PDF 不承诺字节一致** | 允许 XMP CreateDate 与 /ID 差异 |

### 6.3 第三方复核协议（不依赖任何私有状态）

1. 重算产物 SHA-256，与 `outputs[].sha256` 比对；
2. 用同版本 kit 对同一 DOCX 重导 PDF，比较页数与逐页文本；
3. 用 `docconvert --version` 核对 7 行键值，应与日志里的 `program` / `template` / `pdfKit` / `fonts` / `toc` 一致。

```text
> node bin/docconvert.js --version
docconvert: 0.1.0
node: 24.19.0
template: eb4f560390ac
pdf-kit: 0.1.5
pdf-engine: 0.1.5 (native)
toc: two-pass
fonts: Calibri / 微软雅黑 / Consolas
```

> 第 5 行 `pdf-engine: 0.1.5 (native)` 是 **kit 版本 + 后端**，不是 LibreOffice 的版本号——kit 不对外暴露后者。引擎不可用时该行显示 `unavailable`，但命令**仍退出 0**。

---

## 7. 已知限制

先看这一条：**如果你的文档依赖「Word 里看到的页码必须与 PDF 完全一致」，v1 不满足这个要求。** 原因与做法见 7.1。

### 7.1 Word 与 LibreOffice 的分页算法不同

目录页码是按 **LibreOffice 分页**实测写入的；Word 的分页算法不同，长文档在 Word 里**可能整体偏移 1 页**（3 位页码、超长表格、浮动图片会放大差异）。

> **原文声明（三条）**
>
> 1. DOCX 的目录页码由 docconvert 在生成时按 **LibreOffice 分页**实测写入，打开即见，无需按 F9。
> 2. Word 与 LibreOffice 的分页算法不同，长文档在 Word 中的页码**可能整体偏移 1 页**；需要 Word 页码时，请手动更新域（此时目录页码会改为 Word 分页，可能与随附 PDF 不同）。
> 3. docconvert 不写入 `updateFields`，因此打开文档**不会**出现「更新域」提示。

| 场景 | 实际行为 |
| --- | --- |
| 双击打开 | **无任何弹窗**；目录显示回填页码（= PDF 页码） |
| 打印 / 另存为 PDF | 沿用缓存页码 |
| 目录页码与 PDF 不同 | 仅在 Word 分页与 LibreOffice 分页不同时发生（长文档可能整体偏移 1 页） |
| 你主动想刷新 | 全选 → F9（或右键「更新域」）：目录是真 TOC 域，仍可刷新，刷新后按 Word 分页 |

### 7.2 DOCX 里没有 updateFields：打开不弹窗，但也不会自动跟随 Word 分页

`word/settings.xml` 中不存在 `updateFields`（实测计数 0）。好处是打开即见、无弹窗；代价是**Word 不会替你重算页码**——想对齐 Word 分页，只能手动更新域（见 7.1）。

### 7.3 PDF 只承诺版式级可复现

同输入两次运行的 PDF **SHA-256 不同**（实测见 §6.1），这是允许的：差异来自 XMP 创建时间与文档 ID。承诺的是页数、页面尺寸、逐页文本、目录页码一致。

### 7.4 内容降级：这些语法不渲染，但**原文一律保留**

v1 的解析器是自研的，遇到不支持的语法**不会报错、不会丢内容**，而是按原文保留并在 stderr 给出 `WARN`（同一文件同一码最多 3 条，第 4 条起折叠成一行「另有 N 处同类告警已省略」）。完整码表见 **附录 A**，最常撞到的几条：

| 语法 | 行为 | 告警码 |
| --- | --- | --- |
| 远程图片（http/https 链接）、绝对路径图片、文件缺失、格式不支持 | 不内嵌，降级为占位段落 | `image-degraded` |
| 脚注（方括号脱字符写法） | 按原文保留 | `footnote-unsupported` |
| 任务列表（`- [ ]` / `- [x]`） | 降级为普通列表，保留方括号原文 | `task-list-degraded` |
| 删除线、数学公式、内联 HTML | 按原文保留 | `strikethrough-unsupported` / `formula-unsupported` / `inline-html-unsupported` |
| 缩进代码块（4 空格） | 按普通段落处理 | `indented-code-unsupported` |

图片请用**相对路径**（相对 `.md` 文件所在目录）；远程图片请先下载到本地。

### 7.5 目录与书签的层级不同

| 项 | 范围 |
| --- | --- |
| DOCX / PDF 的**目录条目** | 仅 H1–H3（`toc.depth = 3`） |
| PDF **书签** | H1–**H6**（`bookmarkDepth = 6`） |
| 引用块内的标题 | 进书签，**不进**目录（v1 规则：目录只收顶层标题） |

所以「目录 9 条、书签 9 个」在只有 H1–H3 的文档上相同；一旦有 H4–H6，书签会比目录多。

### 7.6 没有 PDF 引擎时，长文档（docx-only）的目录页码是占位符

同时满足「长文（H1–H3 ≥ 3）+ 只出 docx + PDF 引擎不可用」时，页码无从测量，程序选择**照常交付**：

- 目录条目**完整**（H1–H3 全在列），页码列显示全角破折号 `——`；
- stderr 一条 `WARN toc-degraded`；日志 `toc.mode="degraded"`、`converged=false`；
- **退出码 0**（降级不是失败，但告警与日志都写清楚了，不静默）。

反之，只要 `--format` 含 `pdf` 而引擎不可用 → `pdf-engine-missing`，退出码 4，**零产物**。

### 7.7 首次安装必须联网

引擎不随源码走：全新目标机要么联网安装（≈68 MB tarball / 182 MB 解压），要么从已装好的机器复制 kit 目录并设 `DOCONVERT_LIBREOFFICE_KIT`，要么复用 npm/npx 缓存。缓存被清理后回退失效。

### 7.8 沙箱环境下的「只读目录」用例（TC-ER-02）记为已知限制

本项目的验收环境是受限完整性沙箱：`icacls /deny` 无法真正修改 DACL，因此**无法**用 ACL 构造「只读输出目录」来跑 TC-ER-02 的原生形态。产品行为改用**不可写路径**独立验证并通过：

```text
> node bin/docconvert.js examples/cjk.md -o "C:\Windows\System32\docconvert-should-fail"
ERROR output-not-writable: 无法写入输出目录：C:\Windows\System32\docconvert-should-fail（EPERM: operation not permitted, mkdir 'C:\Windows\System32\docconvert-should-fail'）
hint: 检查 -o 目录权限，或改用可写目录
```

实测退出码 **4**、**零产物**（目标目录未被创建）。即「ACL 拒绝」与「沙箱 EPERM」两种来源映射到同一 `output-not-writable`（退出码 4），行为一致；受限的只是**构造测试环境的手段**，不是产品行为。

### 7.9 其他口径

| 项 | 说明 |
| --- | --- |
| 3 位页码（> 99 页） | 未实机覆盖（最长样张 73 页）；目录列宽变化由收敛校验 + 重试 + 显式告警兜底 |
| 中文断行（kinsoku） | 不承诺与 Word 逐行一致；只承诺文本与页码口径 |
| 并发 | v1 串行处理；大目录请按子目录分批 |
| 中途换模板 | 不允许。换模板 = 换版本，旧产物的页码与字节可复现性均作废 |

---

## 8. 故障排查

固定格式：stderr 首行 `ERROR <code>: <说明>`，第二行 `hint: <建议>`。按下表对号入座即可。

| 现象（错误码） | 退出码 | 常见原因 | 处理 |
| --- | --- | --- | --- |
| `input-not-found` | 3 | 路径拼错；路径含空格未加引号 | 加引号或用 Tab 补全 |
| `pdf-engine-missing` | 4 | 首次安装没联网；`DOCONVERT_LIBREOFFICE_KIT` 指错；项目内没装 kit | 见 8.2 |
| `template-missing` | 4 | 内置模板被删 / 被改，或与 `config/default.yml` 不一致 | 见 8.3 |
| `output-conflict` | 2 | 多个输入映射到同一输出（`a.md` + `a.txt` 同目录）；或输出会覆盖输入 | 见 8.4 |
| `convert-failed` | 5 | 渲染失败（异常内容、磁盘满、引擎崩溃） | 见 8.5 |

### 8.1 input-not-found（3）

```text
ERROR input-not-found: 输入路径不存在：C:\...\docconvert\no-such.md
hint: 检查路径拼写；路径含空格时加引号
```

```powershell
node bin/docconvert.js ".\季度 报告.md"    # 含空格：加引号
```

### 8.2 pdf-engine-missing（4）

```text
ERROR pdf-engine-missing: DOCONVERT_LIBREOFFICE_KIT 指向的目录不可用：C:\no\such\kit（ENOENT: no such file or directory, open 'C:\no\such\kit\package.json'）
hint: 改为指向有效的 @deepseek-ai/libreoffice-kit@0.1.5 目录，或删除该环境变量以自动探测（npm 安装 / 复用 DSH 缓存）
```

三步定位：

```powershell
node bin/docconvert.js doctor --json          # 看每个候选的 path 与 reason
Remove-Item Env:DOCONVERT_LIBREOFFICE_KIT     # 怀疑环境变量指错时，先清掉再试
npm install -g ./docconvert                   # 在交付目录内安装（联网下载 kit）
```

只想先拿到 Word：`--format docx`（不需要引擎；长文目录页码会是占位符，见 §7.6）。

### 8.3 template-missing（4）

内置模板缺失、ZIP 不可解析、必需部件（`[Content_Types].xml` / `word/document.xml` / `word/styles.xml`）不全，或样式值与 `config/default.yml` 不一致。**不要手工修模板**——重新安装即可恢复：

```powershell
npm install -g ./docconvert --force
node bin/docconvert.js --version      # template 行应显示 eb4f560390ac
```

### 8.4 output-conflict（2）

```text
ERROR output-conflict: 多个输入映射到同一输出路径：C:\...\out\a.docx（C:\...\a.md、C:\...\a.txt）
hint: 改用独立的 -o 输出目录，或给同名文件改名
```

`a.md` 与 `a.txt` 同名不同扩展 → 映射到同一个 `a.docx`。按 hint 改名，或分两次跑。

### 8.5 convert-failed（5）

渲染阶段失败（内容已解析成功）。先看日志，再复现：

```powershell
Get-Content out\conversion-log.jsonl | Select-String '"status":"failed"'
```

日志里有 `errorCode`、`warnings`、`durationMs`；把 `conversion-log.jsonl` 附上反馈即可定位。

### 8.6 其他错误码速查

| 错误码 | 退出码 | 一句话处理 |
| --- | --- | --- |
| `usage-error` | 2 | `docconvert --help` 看合法选项 |
| `unsupported-extension` | 3 | 只支持 `.md` / `.txt` |
| `empty-input` | 3 | 文件是 0 字节 |
| `decode-error` | 3 | 另存为 UTF-8 后重试 |
| `no-input-files` | 3 | 目录里没有 `.md` / `.txt`；或漏了 `-r` |
| `input-permission` | 3 | 检查文件读权限 |
| `output-not-writable` | 4 | 换可写目录（见 §7.8） |
| `runtime-unsupported` | 4 | 升级到 Node 24 |
| `internal-error` | 1 | 程序缺陷，附日志反馈 |

---

## 9. 支持矩阵与工程结构

### 9.1 支持矩阵

| 维度 | 状态 |
| --- | --- |
| Node.js | 22.19.0+（推荐 24.x）；实测 24.19.0 |
| Windows x64 | 完整验证（含中文路径、超 260 字符长路径、大小写冲突） |
| macOS / Linux | 源码可运行，**未完全验证**（引擎可用性、字体、分页）。先跑 `doctor` |
| PDF 引擎 | `@deepseek-ai/libreoffice-kit@0.1.5`（精确版本，不自动升级） |
| 输入格式 | `.md` / `.txt`（UTF-8） |

### 9.2 目录结构

```text
docconvert/
├─ bin/
│  └─ docconvert.js          # 唯一入口：把 runCli 的返回值交给 process.exitCode
├─ src/
│  ├─ contracts/             # 错误码 / 退出码 / 类型契约（冻结）
│  ├─ preprocess/            # 读取、解码、图片资产
│  ├─ markdown/              # Markdown → AST
│  ├─ txt/                   # 纯文本 → AST
│  ├─ docx/                  # AST → OOXML + ZIP（模板渲染）
│  ├─ pdf/                   # kit 封装：docx → pdf
│  ├─ toc/                   # 两遍法：测量 → 回填 → 复测
│  ├─ kit/                   # 引擎定位 + doctor
│  ├─ cli/                   # 参数解析 / 批处理 / 汇总
│  ├─ log/                   # conversion-log.jsonl 写入
│  └─ config/                # default.yml 解析 + 双源一致性校验
├─ templates/
│  └─ reference.docx         # 内置模板（只读；版本 = SHA-256 前 12 位）
├─ config/
│  └─ default.yml            # 版式常量（只读，无用户覆盖入口）
├─ examples/                 # 输入样本（.md / .txt / 图片）
├─ tools/                    # 构建期：从 default.yml 生成模板
├─ .github/workflows/        # CI：Node 22.x 上跑单测与 smoke 转换
├─ package.json
├─ README.md
├─ LICENSE
└─ .gitignore
```

### 9.3 版本

- 程序版本 **0.1.0**；模板版本 **eb4f560390ac**；kit **0.1.5**（native 后端）。
- 依赖只有一个第三方包，精确版本、无 `^` / `~`、无 postinstall。
- 许可证：MIT。

---

## 10. 开发与测试

```bash
npm run test:unit   # 182 个单元测试（Node 内置 test runner，无需安装依赖）
npm test            # shell 验收（需要可用的 PDF 引擎）
node tools/build-template.js   # 重新生成内置模板（哈希应保持 eb4f560390ac）
```

- 单测不联网、不需要 kit；在沙箱里用 `--test-isolation=none` 绕过子进程限制。
- 验收需要 PDF 引擎；没有引擎时先用 `--format docx` 的 smoke 用例兜底（CI 的 unit job 就是这么跑的）。
- **不要手改 `templates/reference.docx`**：它由 `tools/build-template.js` 从 `config/default.yml` 生成；`test/shell/make-fixtures.mjs` 已不再写它（早期占位逻辑会把真实模板覆盖成 16 样式版本）。
- CI 在 `.github/workflows/test.yml`：Node 22.x，push / PR 触发单测 + DOCX smoke 转换。

---

## 附录 A　降级告警码表

18 个固定告警码（机器键），全部写 stderr 并进 `conversion-log.jsonl` 的 `warnings[]`。**告警不改变退出码**（退出码 0 只表示「文件成功产出」，不代表「排版完美」）。

| 告警码 | 含义 | 影响 |
| --- | --- | --- |
| `image-degraded` | 图片未内嵌（远程 / 绝对路径 / 缺失 / 格式不支持） | 占位段落，内容不丢 |
| `footnote-unsupported` | 不支持脚注 | 按原文保留 |
| `task-list-degraded` | 任务列表降级 | 变普通列表，保留方括号 |
| `inline-html-unsupported` | 不支持内联 HTML | 按原文保留 |
| `indented-code-unsupported` | 不支持缩进代码块 | 按普通段落 |
| `list-depth-clamped` | 列表超过 3 级 | 并入第 3 级 |
| `quote-depth-clamped` | 引用超过 2 级 | 并入第 2 级 |
| `table-ragged` | 表格行列数不一致 | 按规则补齐或合并 |
| `table-malformed` | 表格缺分隔行 | 整块按普通段落 |
| `table-nested-unsupported` | 单元格内嵌套表格 | 按原文保留 |
| `link-target-degraded` | 链接目标不是 http / https / mailto | 降级为文本 |
| `front-matter-not-recognized` | 文件头 YAML 块 | 按原文保留 |
| `strikethrough-unsupported` | 不支持删除线 | 按原文保留 |
| `formula-unsupported` | 不支持数学公式 | 按原文保留 |
| `no-heading-detected` | 全文没有标题 | 文档标题取文件名 |
| `font-fallback` | 首选字体缺失 / PDF 引擎缺字体 | 走回退链，可能影响版式 |
| `toc-degraded` | 目录页码降级为占位符 | 见 §7.6 |
| `toc-not-converged` | 两遍测量未收敛（已重试 1 次） | 用最后一次结果，可能个别页码偏差 |

---

## 常见问题（FAQ）

**Q：能改字体 / 字号 / 页边距吗？**
不能，v1 没有这类参数（§3.4）。版式只来自内置模板与只读配置。

**Q：能用自己的模板吗？**
不能。模板路径冻结，同名干扰文件会被忽略（§4）。

**Q：为什么 PDF 两次的哈希不一样，DOCX 却一样？**
PDF 引擎会写入创建时间与文档 ID；DOCX 的这些位置全部被钉死（§6）。

**Q：Word 里目录页码和 PDF 差 1 页？**
Word 与 LibreOffice 分页算法不同，属已知限制（§7.1）；需要 Word 页码请手动更新域。

**Q：能离线用吗？**
装完之后可以。安装期需要联网（§7.7）；已有 kit 的机器可复用项目依赖 / npx 缓存 / 环境变量。
