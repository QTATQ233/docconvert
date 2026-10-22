# Pull Request

## 摘要

请用 1–3 句话说明这个 PR 做了什么，以及为什么。

## 类型

- [ ] feat：新能力
- [ ] fix：缺陷修复
- [ ] docs：文档 / 资产
- [ ] test：测试
- [ ] chore：工程与依赖

## 改动范围

- 涉及模块：
- 是否改动模板 / 版式 / 分页：
- 是否改动 CLI 契约 / 错误码：

## 验证

- [ ] ~npm run test:unit~ 全绿（182 条）
- [ ] ~node bin/docconvert.js examples/cjk.md -o out/pr~ exit 0
- [ ] 涉及渲染时，附 DOCX/PDF 渲染截图或页码对照
- [ ] 涉及长文时，附 ~examples/long-50.md~ 的 spec

## 检查清单

- [ ] 没有引入新的第三方运行时依赖
- [ ] 没有把字体/边距/颜色硬编码进代码
- [ ] 错误码来自 ~src/contracts~，没有私有字符串
- [ ] 没有提交 ~out/~、~_archive/~、~_spike/~、~drafts/~、个人路径或凭据
- [ ] 新增/修改的文档已同步（README / docs）
