# 代码块与长行

本文档验证代码块的等宽字体、浅底样式与长行换行行为。代码内容取自本手册配套脚本的片段。

## 1. 短代码块

下面是一段设置样区参数的 JavaScript，行宽均在八十列以内：

```js
const sample = {
  areaId: "A2",
  habitat: "自然滩涂",
  method: "样点法",
  radius: 200,
};

function visitCount(sample) {
  return sample.method === "样点法" ? 5 : 1;
}
```

## 2. 超长单行

下面这一行长度超过二百个字符，用于验证换行策略。期望在页面宽度内自动换行或横向滚动，不得被裁切、不得伸出页边距：

```js
const observationRecord = { recordId: "20261018-A2-003", date: "2026-10-18", areaId: "A2", slot: "06:20-07:10", weather: "晴，微风", observer: "志愿者-07", species: "白鹭", scientificName: "Egretta garzetta", count: 12, behavior: "在浅滩觅食", remark: "与池鹭混群，部分个体在芦苇边缘停留", gps: { lat: 31.23841, lon: 121.50672 }, photo: "20261018_A2_003.jpg" };
```

## 3. 中文注释与缩进

代码中的中文注释用于验证等宽字体与中文字体的回退是否协调：

```ts
// 统计每条样线的记录数，空值不计入
function summarize(records: Observation[]): Map<string, number> {
  const counter = new Map<string, number>();
  for (const record of records) {
    if (!record.species) continue;   // 跳过空记录
    counter.set(record.areaId, (counter.get(record.areaId) ?? 0) + 1);
  }
  return counter;
}
```

## 4. JSON 与命令

```json
{
  "template": "default",
  "page": { "size": "A4", "margin": "2.2cm 2.0cm" },
  "fonts": { "latin": "Calibri", "eastAsia": "微软雅黑", "mono": "Consolas" }
}
```

```powershell
node .\bin\docconvert.js .\examples\code.md -o .\out\code --to docx,pdf
```

## 5. 行内代码

行内代码例如 `--reference`、`config/default.yml` 与 `Heading1`，应与正文基线对齐，不得出现半行空白或字号突变。

## 6. 制表符与窄字符

下面一行含有制表符与大量窄字符，用于检查是否出现列错位：

```text
序号	样区	数量	备注
1	A1	12	成群
2	B1	3	单只
3	C2	27	隐蔽
```
