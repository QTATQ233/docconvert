# 贡献指南

感谢你愿意改进 docconvert。这个项目刻意保持小：一条命令、两种输出、一个内置模板。

## 先提 Issue

- 使用 [Bug 报告模板](.github/ISSUE_TEMPLATE/bug_report.md)，附上 ~docconvert --version~ 的 7 行输出。
- 先搜索已有 Issue；同类问题请跟帖补充复现条件，而不是新开一条。
- 功能建议请说明「为什么现有 CLI 与模板做不到」，并尽量给出输入样例。

## 开发环境

- Node.js >= 22.19.0（推荐 24.x）。
- Windows / macOS / Linux 均可开发；Windows 为完整验证平台。
- PDF 引擎：~@deepseek-ai/libreoffice-kit@0.1.5~（首次安装联网；DSH 环境可复用 npx 缓存）。
- 零第三方运行时依赖是硬约束；不要引入新的 npm 包。

## 跑测试

~~~powershell
npm install
npm run test:unit                              # 182 条单测
node bin/docconvert.js examples/cjk.md -o out/dev   # 端到端 smoke
node test/shell/run-acceptance.mjs             # shell 验收（需要 kit）
~~~

提交前请保证：

- ~npm run test:unit~ 全绿；
- 至少跑一次 ~examples/cjk.md~ 与 ~examples/long-50.md~；
- 若改模板或渲染，附上 DOCX/PDF 的差异说明。

## 代码风格

- 纯 ESM JavaScript + JSDoc 类型注释；无构建步骤。
- 单一职责：preprocess / markdown / docx / pdf / toc / cli 不跨层写入。
- 错误一律走 ~src/contracts~ 的已登记错误码；不新增私有字符串。
- 不把字体、边距、颜色写成代码常量——它们属于 ~config/default.yml~ 与模板。
- 注释解释「为什么」，不复述「做了什么」。

## Pull Request

- 一个 PR 只做一件事；标题用 ~type: summary~ 前缀（feat/fix/docs/test/chore）。
- 描述里写清：动机、改动范围、如何验证、已知风险。
- 改动渲染/分页时，附上渲染截图或 PDF 页码对照。
- 不提交 ~out/~、~_archive/~、~_spike/~、~drafts/~、~node_modules/~ 或个人路径。

## 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
