/**
 * toc/outline.js —— PDF 书签解析（纯 Node，零依赖；architecture §3.8 / §7.3，预算 250–400 LOC）。
 *
 * 两遍法的测量仪：读 PDF 书签树与页树，给出「每条书签落在第几物理页」。
 * 只读 PDF、不调用 kit、不解析内容流（标题是 PDF 文本串，不需要 ToUnicode CMap）。
 * level 为 0-based 真实深度：H1=0 … H6=5（spike §1.9），目录只取 level <= 2。
 * 结构不可读抛 convert-failed；「没有书签」返回空数组，由调用方决定降级。
 *
 * @module toc/outline
 */
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { DocconvertError } from "../contracts/errors.js";

/** 目录允许的最深书签层级（0-based：2 = H3）。 */
export const TOC_OUTLINE_MAX_LEVEL = 2;

const WS = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c, 0x00]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const ESCAPES = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };

/** PDF 语法读取器：解析结果统一为 { type, value } / { type:"ref", num, gen }。 */
class PdfReader {
  constructor(text) {
    this.t = text;
    this.p = 0;
  }

  skipWs() {
    while (this.p < this.t.length) {
      const code = this.t.charCodeAt(this.p);
      if (WS.has(code)) this.p += 1;
      else if (code === 0x25) while (this.p < this.t.length && ![0x0a, 0x0d].includes(this.t.charCodeAt(this.p++)));
      else break;
    }
  }

  parseName() {
    this.p += 1;
    let out = "";
    while (this.p < this.t.length) {
      const c = this.t[this.p];
      const code = c.charCodeAt(0);
      if (WS.has(code) || DELIM.has(code)) break;
      if (c === "#" && /^[0-9a-fA-F]{2}$/.test(this.t.slice(this.p + 1, this.p + 3))) {
        out += String.fromCharCode(parseInt(this.t.slice(this.p + 1, this.p + 3), 16));
        this.p += 3;
      } else {
        out += c;
        this.p += 1;
      }
    }
    return out;
  }

  parseLiteralString() {
    this.p += 1;
    let depth = 1;
    const bytes = [];
    while (this.p < this.t.length) {
      const c = this.t[this.p];
      this.p += 1;
      if (c === "\\") {
        const n = this.t[this.p];
        this.p += 1;
        if (n === "\r") {
          if (this.t[this.p] === "\n") this.p += 1;
        } else if (n === "\n") {
          /* 续行：忽略 */
        } else if (n >= "0" && n <= "7") {
          let oct = n;
          while (oct.length < 3 && this.t[this.p] >= "0" && this.t[this.p] <= "7") oct += this.t[this.p++];
          bytes.push(parseInt(oct, 8) & 0xff);
        } else bytes.push(ESCAPES[n] ?? (n.charCodeAt(0) & 0xff));
      } else if (c === "(" || c === ")") {
        depth += c === "(" ? 1 : -1;
        if (depth === 0) break;
        bytes.push(c.charCodeAt(0));
      } else bytes.push(c.charCodeAt(0) & 0xff);
    }
    return Buffer.from(bytes);
  }

  parseHexString() {
    this.p += 1;
    let hex = "";
    while (this.p < this.t.length && this.t[this.p] !== ">") {
      const c = this.t[this.p++];
      if (!WS.has(c.charCodeAt(0))) hex += c;
    }
    this.p += 1;
    if (hex.length % 2) hex += "0";
    return Buffer.from(hex, "hex");
  }

  parseNumber() {
    const start = this.p;
    if ("+-".includes(this.t[this.p])) this.p += 1;
    while ((this.t[this.p] >= "0" && this.t[this.p] <= "9") || this.t[this.p] === ".") this.p += 1;
    return Number(this.t.slice(start, this.p));
  }

  parseValue() {
    this.skipWs();
    const c = this.t[this.p];
    if (c === undefined) return null;
    if (c === "/") return { type: "name", value: this.parseName() };
    if (c === "(") return { type: "string", value: this.parseLiteralString() };
    if (c === "<" && this.t[this.p + 1] === "<") {
      this.p += 2;
      const dict = {};
      for (;;) {
        this.skipWs();
        if (this.t[this.p] === ">" && this.t[this.p + 1] === ">") {
          this.p += 2;
          return { type: "dict", value: dict };
        }
        if (this.t[this.p] !== "/") throw new Error("dict key expected");
        dict[this.parseName()] = this.parseValue();
      }
    }
    if (c === "<") return { type: "string", value: this.parseHexString() };
    if (c === "[") {
      this.p += 1;
      const arr = [];
      for (;;) {
        this.skipWs();
        if (this.t[this.p] === "]") {
          this.p += 1;
          return { type: "array", value: arr };
        }
        arr.push(this.parseValue());
      }
    }
    if (this.t.startsWith("true", this.p)) {
      this.p += 4;
      return { type: "bool", value: true };
    }
    if (this.t.startsWith("false", this.p)) {
      this.p += 5;
      return { type: "bool", value: false };
    }
    if (this.t.startsWith("null", this.p)) {
      this.p += 4;
      return { type: "null", value: null };
    }
    if ("+-.0123456789".includes(c)) {
      const num = this.parseNumber();
      const save = this.p;
      this.skipWs();
      // 间接引用 "num gen R"：num 已被吃掉，只需再读 gen 与 R。
      const ref = /^(\d+)\s+R\b/.exec(this.t.slice(this.p, this.p + 32));
      if (ref) {
        this.p += ref[0].length;
        return { type: "ref", num, gen: Number(ref[1]) };
      }
      this.p = save;
      return { type: "number", value: num };
    }
    throw new Error("unexpected token");
  }
}

/** 扫描间接对象（含流对象）：对象号 -> 记录。只认行首对象头，避免流数据里的假对象头。 */
function scanObjects(buffer) {
  const text = buffer.toString("latin1");
  const objects = new Map();
  const re = /^(\d+)\s+(\d+)\s+obj\b/gm;
  let scan = 0;
  for (;;) {
    re.lastIndex = scan;
    const match = re.exec(text);
    if (!match) break;
    const objectNumber = Number(match[1]);
    const reader = new PdfReader(text);
    reader.p = re.lastIndex;
    let value;
    try {
      value = reader.parseValue();
    } catch {
      scan = match.index + 1;
      continue;
    }
    reader.skipWs();
    // 对象体之后必须是 stream 或 endobj，否则是流数据里的假对象头：只前移 1 字节。
    if (!text.startsWith("stream", reader.p) && !text.startsWith("endobj", reader.p)) {
      scan = match.index + 1;
      continue;
    }
    let record = value;
    let next;
    if (text.startsWith("stream", reader.p)) {
      let dataStart = reader.p + 6;
      if (text[dataStart] === "\r") dataStart += 1;
      if (text[dataStart] === "\n") dataStart += 1;
      const dict = value && value.type === "dict" ? value.value : {};
      const declared = dict.Length && dict.Length.type === "number" ? dict.Length.value : -1;
      let dataEnd;
      if (declared >= 0 && dataStart + declared <= text.length) dataEnd = dataStart + declared;
      else {
        const stop = text.indexOf("endstream", dataStart);
        dataEnd = stop < 0 ? text.length : stop;
      }
      record = { type: "stream", dict, raw: buffer.subarray(dataStart, dataEnd) };
      const endobj = text.indexOf("endobj", dataEnd);
      next = endobj < 0 ? text.length : endobj + 6;
    } else {
      const endobj = text.indexOf("endobj", reader.p);
      next = endobj < 0 ? text.length : endobj + 6;
    }
    objects.set(objectNumber, record);
    scan = next;
  }
  return objects;
}

/** 解压流（FlateDecode / ASCIIHexDecode）。 */
function decodeStream(obj) {
  const dict = obj.dict || {};
  const filters = [];
  if (dict.Filter && dict.Filter.type === "name") filters.push(dict.Filter.value);
  else if (dict.Filter && dict.Filter.type === "array") for (const item of dict.Filter.value) if (item && item.type === "name") filters.push(item.value);
  let data = obj.raw;
  for (const name of filters) {
    if (name === "FlateDecode") data = inflateSync(data);
    else if (name === "ASCIIHexDecode") {
      const hex = data.toString("latin1").replace(/>.*$/, "").replace(/\s/g, "");
      data = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex");
    } else throw new Error("unsupported filter " + name);
  }
  return data;
}

/** 展开 /Type /ObjStm 对象流。 */
function expandObjectStreams(objects) {
  for (const obj of [...objects.values()]) {
    if (!obj || obj.type !== "stream" || nameOf(obj.dict.Type) !== "ObjStm") continue;
    let data;
    try {
      data = decodeStream(obj);
    } catch {
      continue;
    }
    const text = data.toString("latin1");
    const count = numberOf(obj.dict.N, 0);
    const first = numberOf(obj.dict.First, 0);
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i += 1) {
      const objectNumber = header[i * 2];
      const offset = header[i * 2 + 1];
      if (!Number.isFinite(objectNumber) || !Number.isFinite(offset)) continue;
      const reader = new PdfReader(text);
      reader.p = first + offset;
      try {
        objects.set(objectNumber, reader.parseValue());
      } catch {
        /* 单对象损坏不影响测量 */
      }
    }
  }
}

const nameOf = (value) => (value && value.type === "name" ? value.value : undefined);
const numberOf = (value, fallback) => (value && value.type === "number" ? value.value : fallback);
const refNumber = (value) => (value && value.type === "ref" ? value.num : -1);

function resolve(objects, value, seen = new Set()) {
  let current = value;
  while (current && current.type === "ref") {
    if (seen.has(current.num)) return undefined;
    seen.add(current.num);
    current = objects.get(current.num);
  }
  return current;
}

function dictOf(objects, value) {
  const resolved = resolve(objects, value);
  return resolved && resolved.type === "dict" ? resolved.value : null;
}

/** 走页树：页数 + 「页对象号 -> 1-based 页序」。 */
function collectPages(objects, catalog) {
  let pageCount = 0;
  const pageIndexByObject = new Map();
  const seen = new Set();
  const walk = (nodeRef, depth) => {
    if (depth > 64) return;
    const objectNumber = refNumber(nodeRef);
    if (objectNumber >= 0) {
      if (seen.has(objectNumber)) return;
      seen.add(objectNumber);
    }
    const dict = dictOf(objects, nodeRef);
    if (!dict) return;
    if (nameOf(dict.Type) === "Page") {
      pageCount += 1;
      if (objectNumber >= 0) pageIndexByObject.set(objectNumber, pageCount);
      return;
    }
    const kids = resolve(objects, dict.Kids);
    if (kids && kids.type === "array") for (const kid of kids.value) walk(kid, depth + 1);
  };
  if (catalog) walk(catalog.Pages, 0);
  return { pageCount, pageIndexByObject };
}

/** 命名目的地：/Names /Dests 名字树 + 旧式 /Dests 字典。 */
function collectNamedDestinations(objects, catalog) {
  const destinations = new Map();
  if (!catalog) return destinations;
  const names = dictOf(objects, catalog.Names);
  const tree = names ? dictOf(objects, names.Dests) : null;
  const seen = new Set();
  const walkTree = (node, depth) => {
    if (depth > 32) return;
    const dict = dictOf(objects, node);
    if (!dict || seen.has(dict)) return;
    seen.add(dict);
    const pairs = resolve(objects, dict.Names);
    if (pairs && pairs.type === "array") {
      for (let i = 0; i + 1 < pairs.value.length; i += 2) {
        const key = pairs.value[i];
        if (key && key.type === "string") destinations.set(decodeTextString(key.value), pairs.value[i + 1]);
      }
    }
    const kids = resolve(objects, dict.Kids);
    if (kids && kids.type === "array") for (const kid of kids.value) walkTree(kid, depth + 1);
  };
  if (tree) walkTree(tree, 0);
  const flat = dictOf(objects, catalog.Dests);
  if (flat) for (const [key, value] of Object.entries(flat)) destinations.set(key, value);
  return destinations;
}

/** 目的地 -> 0-based 页序；失败 -1。 */
function destinationPageIndex(objects, destination, pageIndexByObject, namedDestinations, seen = new Set()) {
  const value = resolve(objects, destination);
  if (!value) return -1;
  if (value.type === "name" || value.type === "string") {
    const key = value.type === "name" ? value.value : decodeTextString(value.value);
    if (seen.has(key)) return -1;
    seen.add(key);
    const target = namedDestinations.get(key);
    return target === undefined ? -1 : destinationPageIndex(objects, target, pageIndexByObject, namedDestinations, seen);
  }
  if (value.type === "dict") {
    return value.value.D === undefined ? -1 : destinationPageIndex(objects, value.value.D, pageIndexByObject, namedDestinations, seen);
  }
  if (value.type === "array") {
    const first = value.value[0];
    const objectNumber = refNumber(first);
    if (objectNumber >= 0 && pageIndexByObject.has(objectNumber)) return pageIndexByObject.get(objectNumber) - 1;
    if (first && first.type === "number") return first.value - 1;
  }
  return -1;
}

/** PDF 文本串解码：UTF-16BE(BOM) / UTF-8(BOM) / PDFDocEncoding（latin1 近似）。 */
function decodeTextString(buffer) {
  if (!buffer || buffer.length === 0) return "";
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2));
    if (body.length % 2 === 1) return body.toString("latin1");
    body.swap16();
    return body.toString("utf16le");
  }
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString("utf8");
  return buffer.toString("latin1");
}

/** 走书签树（父 -> 子 -> 下一兄弟）。 */
function walkOutline(objects, outlineRoot, pageIndexByObject, namedDestinations) {
  const entries = [];
  if (!outlineRoot || !outlineRoot.First) return entries;
  const seen = new Set();
  const stack = [{ ref: outlineRoot.First, level: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    const objectNumber = refNumber(item.ref);
    if (objectNumber >= 0) {
      if (seen.has(objectNumber)) continue;
      seen.add(objectNumber);
    }
    const dict = dictOf(objects, item.ref);
    if (!dict) continue;
    const titleValue = resolve(objects, dict.Title);
    let destination = dict.Dest;
    if (destination === undefined) {
      const action = dictOf(objects, dict.A);
      if (action && action.D !== undefined) destination = action.D;
    }
    const pageIndex = destination === undefined
      ? -1
      : destinationPageIndex(objects, destination, pageIndexByObject, namedDestinations);
    entries.push({
      order: entries.length + 1,
      level: item.level,
      title: titleValue && titleValue.type === "string" ? decodeTextString(titleValue.value) : "",
      page: pageIndex < 0 ? 0 : pageIndex + 1,
    });
    if (dict.Next) stack.push({ ref: dict.Next, level: item.level });
    if (dict.First) stack.push({ ref: dict.First, level: item.level + 1 });
  }
  return entries;
}

/** 结构不可读：统一抛 convert-failed（detail.kind=pdf-outline，交给调用方降级）。 */
function outlineFailure(pdfPath, stage, message, extra = {}) {
  return new DocconvertError("convert-failed", message + "：" + pdfPath, {
    hint: "查看 conversion-log.jsonl",
    detail: { kind: "pdf-outline", stage, pdfPath, ...extra },
  });
}

/**
 * 读取 PDF 书签树与页数。
 * @param {string} pdfPath
 * @returns {Promise<import("../contracts/index.js").PdfOutline>}
 */
export async function readPdfOutline(pdfPath) {
  let buffer;
  try {
    buffer = await readFile(pdfPath);
  } catch (error) {
    throw new DocconvertError("convert-failed", "无法读取 PDF 以测量目录页码：" + pdfPath, {
      hint: "查看 conversion-log.jsonl",
      detail: { kind: "pdf-outline", stage: "read", pdfPath },
      cause: error,
    });
  }
  if (buffer.length < 8 || buffer.toString("latin1", 0, 5) !== "%PDF-") throw outlineFailure(pdfPath, "header", "不是有效的 PDF，无法测量目录页码");
  const objects = scanObjects(buffer);
  expandObjectStreams(objects);
  let catalog = null;
  for (const value of objects.values()) if (value && value.type === "dict" && nameOf(value.value.Type) === "Catalog") { catalog = value.value; break; }
  if (!catalog) throw outlineFailure(pdfPath, "catalog", "PDF 缺少 Catalog，无法测量目录页码", { objectCount: objects.size });
  const pages = collectPages(objects, catalog);
  if (pages.pageCount === 0) throw outlineFailure(pdfPath, "pages", "PDF 页树为空，无法测量目录页码");
  const namedDestinations = collectNamedDestinations(objects, catalog);
  return {
    pageCount: pages.pageCount,
    entries: walkOutline(objects, dictOf(objects, catalog.Outlines), pages.pageIndexByObject, namedDestinations),
  };
}

/**
 * 只保留目录范围（H1–H3，level <= 2）的书签。
 * @param {import("../contracts/index.js").PdfOutline} outline
 * @param {number} [maxLevel]
 * @returns {Array<{ order: number, level: number, title: string, page: number }>}
 */
export function tocOutlineEntries(outline, maxLevel = TOC_OUTLINE_MAX_LEVEL) {
  return outline.entries.filter((entry) => entry.level <= maxLevel);
}
