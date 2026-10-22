# 错误输入场景（errors/）

本目录只用于**设计**错误输入用例，不含任何实现代码。执行者按下列场景准备环境，并把实际输出记入 test-report.md。

所有用例的判定标准相同：**进程非零退出、stderr 有一行以 `docconvert:` 开头的人类可读信息、信息中包含"发生了什么 + 该怎么办"两部分，且不产生残缺的输出文件**。

## 场景 E1：输入文件不存在

准备：无需准备，直接使用一个不存在的文件名。

```powershell
docconvert examples/errors/does-not-exist.md -o out/E1
```

期望：退出码非 0；stderr 含输入路径原文与"未找到"义项；不创建 `out/E1` 目录（或创建了空目录但其中无任何文件）。

## 场景 E2：输出目录不可写（只读目录）

准备（Windows，以当前用户身份执行）：

```powershell
New-Item -ItemType Directory -Force out/E2-readonly | Out-Null
icacls out/E2-readonly /deny "$($env:USERNAME):(OI)(CI)(W)"
```

执行：

```powershell
docconvert examples/errors/readonly-target.md -o out/E2-readonly
```

清理（无论成败都要执行）：

```powershell
icacls out/E2-readonly /remove:d "$env:USERNAME"
Remove-Item -Recurse -Force out/E2-readonly
```

期望：退出码非 0；stderr 明确指出"无法写入输出目录"并给出该目录的绝对路径；不得静默改用其它目录；不得留下 0 字节的 .docx/.pdf。

## 场景 E3：输入是空文件

准备：本目录已提供 0 字节的 `empty.md`。

```powershell
docconvert examples/errors/empty.md -o out/E3
```

期望：二选一均可接受，但必须**明确**且**有文档依据**（由 requirements.md 定稿）：
- 退出码非 0 并说明"输入为空"；或
- 退出码 0，产出一个只有页眉页脚的合法 docx/pdf，并在 stderr 给出警告。

失败判据：崩溃堆栈、无提示的空产出、或产生 0 字节文件。

## 场景 E4：输入扩展名不受支持

准备：本目录的 `unsupported.txt.bin` 是一个改名的二进制文件。

```powershell
docconvert examples/errors/unsupported.txt.bin -o out/E4
```

期望：退出码非 0；stderr 说明"仅支持 .md / .txt"并列出实际收到的扩展名。

## 场景 E5：输出路径已存在且为文件

```powershell
Set-Content out/E5 -Value "occupied"
docconvert examples/headings.md -o out/E5
```

期望：退出码非 0；stderr 指出该路径是文件而非目录；**不得覆盖**该文件（执行后用 `Get-Content out/E5` 确认内容仍是 "occupied"）。

## 场景 E6：--reference 指向不存在的模板

```powershell
docconvert examples/headings.md -o out/E6 --reference examples/errors/no-such-template.docx
```

期望：退出码非 0；stderr 指出模板路径不存在；**不得**静默回退到内置模板继续执行。

> 说明：E6 的 `--reference` 参数名以 requirements.md 定稿为准；若最终未提供该参数，本场景改判为 N/A 并在 test-report 记录。
