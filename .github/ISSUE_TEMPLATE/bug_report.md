---
name: Bug report
about: 报告 docconvert 的转换错误、崩溃或排版异常
title: "[bug] "
labels: bug
assignees: ""
---

## 运行环境（必填）

请粘贴 ~docconvert --version~ 的完整输出（7 行）：

~~~text
docconvert: 0.1.0
node: v24.19.0
template: eb4f560390ac
pdf-kit: 0.1.5
pdf-engine: 0.1.5 (native)
toc: two-pass
fonts: Calibri / 微软雅黑 / Consolas
~~~

- 操作系统与版本：
- Node.js 版本：
- 安装方式（本地目录 / npm tarball / 其他）：
- PDF 引擎来源（项目依赖 / 环境变量 / npx 缓存 / 不确定）：

## 复现命令

~~~powershell
# 例：
node bin/docconvert.js examples/cjk.md -o out/bug
~~~

## 最小输入

请附上能复现的最小 .md/.txt（或其中的关键片段），并说明图片/字体等外部资源。

## 期望结果

## 实际结果

请附截图或渲染图；若是分页/目录问题，请注明页码。

## 日志

请粘贴 ~conversion-log.jsonl~ 中相关行（注意删除个人路径与敏感信息）：

~~~json
{}
~~~

## 附加说明

- 是否稳定复现（每次 / 偶发）：
- 是否在干净环境复现：
- 其他上下文：
