# 模板冲突场景（conflict/）

本目录模拟"工作区里散落着多份 `reference.docx`"的真实情况，用于验证**模板来源的唯一性**：程序只认自己内置的那份（`docconvert/templates/reference.docx`），不会被当前目录或子目录里的同名文件劫持，也不会因为搜索路径顺序不同而产生不同版式。

## 目录内容

| 路径 | 用途 |
| --- | --- |
| `conflict/reference.docx` | 干扰文件 A：在本目录直接放一份旧模板（内容是既有《钓鱼鱼类调查报告》的副本，版式与内置模板不同） |
| `conflict/templates/reference.docx` | 干扰文件 B：在 `templates/` 子目录再放一份，模拟常见的"项目自带模板目录"布局 |
| `conflict/decoy-marker.txt` | 说明文件，记录两份干扰文件的来源与 SHA-256，便于执行者确认没有被替换 |

## 场景 C1：在干扰目录内执行

```powershell
Push-Location docconvert/examples/conflict
docconvert headings.md -o ../../../out/C1
Pop-Location
```

期望（同时满足才算通过）：
1. 退出码为 0，正常产出 docx 与 pdf；
2. stderr **不得**出现"使用 conflict/reference.docx"之类的内容；若程序选择告警，只允许出现"检测到同名模板但已忽略"的说明，且必须写明忽略的路径；
3. 产出的 docx 与"在 `docconvert/` 目录下用同一输入转换"的 docx 在 `word/styles.xml` 上**逐字节一致**（模板相同 ⇒ 样式相同）；
4. 产出的 PDF 页数与在 `docconvert/` 目录下转换的结果相同。

## 场景 C2：显式指定模板

```powershell
docconvert headings.md -o ../../../out/C2 --reference templates/reference.docx
```

预期行为（**待需求定稿**）：若 `--reference` 的语义是"用户显式覆盖"，则 C2 必须使用该文件并产出与默认模板不同的版式；若 v1 不提供该参数，C2 记 N/A。

## 场景 C3：模板文件被改名/删除后的内置模板完整性

本场景不修改 `docconvert/templates/reference.docx`（它属于他人的产物），只在 test-report 中记录：

```powershell
Get-FileHash docconvert/templates/reference.docx -Algorithm SHA256
```

期望：哈希与 README.md 中登记的模板哈希一致；若不一致，说明模板被改动，须先确认变更来源再跑回归。
