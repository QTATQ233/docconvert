# 架构

> 一条单向流水线：输入只读，版式只来自内置模板；**PDF 永远由 DOCX 导出**，两种格式共享同一份排版与目录页码。

~~~mermaid
flowchart LR
    A["Input<br/>.md / .txt"] --> B["input-preprocess<br/>decode · assets"]
    B --> C{"format"}
    C -->|.md| D["markdown-parser"]
    C -->|.txt| E["txt-structurer"]
    D --> F["AST"]
    E --> F
    F --> G["docx-render<br/>OOXML + reference.docx"]
    G --> H["out.docx"]
    H --> I["pdf-render<br/>LibreOffice Kit"]
    I --> J["out.pdf"]
    F -.-> T["toc two-pass<br/>PDF outline → page numbers"]
    T -.-> G
    T -.-> I
~~~

## 模块边界

| 模块 | 职责 | 不做什么 |
| --- | --- | --- |
| input-preprocess | 读取、解码、格式分派、图片资产登记 | 不解析 Markdown、不生成文档 |
| markdown-parser | 受控 GFM → AST，降级并告警 | 不做文件 IO、不决定样式 |
| txt-structurer | 按 §2.3 规则把纯文本转 AST | 不改写原文、不猜测语义 |
| docx-render | AST → OOXML/ZIP，套用内置 reference.docx | 不接受样式覆盖参数、不直接出 PDF |
| toc-two-pass | 解析 PDF outline、回填页码、校验收敛 | 不渲染正文、不改模板 |
| pdf-render | docx → pdf（kit），绝对路径、独占创建 | 不修改 DOCX、不换引擎 |
| cli | 参数解析、批处理、日志、汇总 | 不暴露字体/边距/颜色/模板参数 |

## 关键不变量

1. **PDF 只能从 DOCX 导出**：不允许 HTML/浏览器直出，避免两套版式。
2. **模板只读**：样式全部来自 templates/reference.docx 与 config/default.yml，代码里不硬编码字号/边距/颜色。
3. **可复现**：DOCX 字节级一致（固定 ZIP 时间、稳定条目顺序）；PDF 保证版式与内容一致，不承诺字节级。
4. **显式降级**：无法测量的目录页码写占位符并输出 WARN toc-degraded；不静默。
5. **两遍法闭环**：第一遍 PDF 测量 → 回填 DOCX 目录缓存 → 第二遍导出；校验失败重试一次，仍失败则显式告警。

## 两遍法时序

~~~mermaid
sequenceDiagram
    participant D as docx-render
    participant P as pdf-render (kit)
    participant O as outline parser
    participant C as CLI
    C->>D: 生成带目录缓存（页码 00）的 DOCX
    C->>P: DOCX → PDF#1
    P-->>O: PDF#1
    O-->>C: 标题 → 页码映射
    C->>D: 回填页码，重新生成 DOCX
    C->>P: DOCX → PDF#2
    C->>O: 校验两遍分页一致
    O-->>C: converged=true / false
~~~

## 相关文档

- [README](../README.md)：安装、命令、已知限制与故障排查
- [requirements.md](../requirements.md)：140 条可验收需求
- [architecture.md](../architecture.md)：接口、token 与决策的完整定稿
