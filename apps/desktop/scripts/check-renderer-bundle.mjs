/**
 * [INPUT]: Depends on Node fs/path/zlib, renderer HTML/eager JS with Rollup Temporary chunk→module report
 * [OUTPUT]: The first package is tested and the first order is stated as a boundary (ECharts, non-en language directory) target is not empty, not entering entry, statically closed and only reachable across dynamic import; Each of these devices is a failure
 * [POS]: The first package of desktop builds with a mechanical access to the border; Delete not to distribution after reporting
 */

import { readFileSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import console from "node:console";
import process from "node:process";
import { gzipSync } from "node:zlib";

/**
 * 闸门只说「胖了」，说不出「为什么不该胖」。所以数字之外还有一张懒边界表：
 * 每一条都声明「这类模块必须存在、且只能在动态边界之后」。数字防的是缓慢
 * 增重，结构断言防的是某次重构悄悄把整条边界拆掉——后者才是首包真正的死因。
 * 新增一条懒边界，就是往表里加一行，而不是再抄一遍三十行遍历。
 */
const LAZY_LANES = [
  {
    name: "ECharts",
    pattern: /(?:^|\/)(?:echarts(?:@[^/]+)?\/|node_modules\/echarts\/)/,
    sample: "node_modules/echarts/core.js",
  },
  {
    name: "非 en 语言目录",
    pattern: /shared\/i18n\/locales\/(?:zh-cn|ja|fr|es)\.ts$/,
    sample: "shared/i18n/locales/ja.ts",
  },
];

const MAX_RAW_BYTES = 3_520_000;
const MAX_GZIP_BYTES = 742_000;
const rendererRoot = resolve(import.meta.dirname, "../out/renderer");
const indexPath = resolve(rendererRoot, "index.html");
const reportPath = resolve(rendererRoot, ".chart-module-report.json");

function attribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i")
  );
  return match?.[1];
}

function eagerReferences(html) {
  const references = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const script = /^<script\b/i.test(tag) && attribute(tag, "type") === "module";
    const preload =
      /^<link\b/i.test(tag) && attribute(tag, "rel") === "modulepreload";
    const reference = attribute(tag, script ? "src" : "href");
    if ((script || preload) && reference?.match(/\.js(?:[?#]|$)/)) {
      references.add(reference);
    }
  }
  return [...references];
}

function resolveReference(reference) {
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) {
    throw new Error(`eager JS 不是本地产物: ${reference}`);
  }
  const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  const filePath = resolve(rendererRoot, pathname.replace(/^\.?\//, ""));
  const localPath = relative(rendererRoot, filePath);
  if (localPath.startsWith(`..${sep}`) || isAbsolute(localPath)) {
    throw new Error(`eager JS 越过 renderer 输出目录: ${reference}`);
  }
  return { filePath, localPath };
}

function measureReference(reference) {
  const { filePath, localPath } = resolveReference(reference);
  const source = readFileSync(filePath);
  if (!source.byteLength) throw new Error(`eager JS 为空: ${reference}`);
  return {
    filePath,
    path: localPath,
    raw: source.byteLength,
    gzip: gzipSync(source, { level: 9 }).byteLength,
  };
}

function format(bytes) {
  return bytes.toLocaleString("en-US");
}

function checkBundle() {
  const html = readFileSync(indexPath, "utf8");
  const references = eagerReferences(html);
  if (!references.length) throw new Error("index.html 未声明 eager module JS");

  const measured = references.map(measureReference);
  const chunks = [
    ...new Map(measured.map((chunk) => [chunk.filePath, chunk])).values(),
  ];
  const raw = chunks.reduce((total, chunk) => total + chunk.raw, 0);
  const gzip = chunks.reduce((total, chunk) => total + chunk.gzip, 0);

  for (const chunk of chunks) {
    console.log(
      `[bundle-budget] ${chunk.path}: ${format(chunk.raw)} raw / ${format(chunk.gzip)} gzip`
    );
  }
  console.log(
    `[bundle-budget] eager total: ${format(raw)} / ${format(MAX_RAW_BYTES)} raw, ${format(gzip)} / ${format(MAX_GZIP_BYTES)} gzip`
  );
  if (raw > MAX_RAW_BYTES || gzip > MAX_GZIP_BYTES) {
    throw new Error("renderer eager JS 超过体积预算");
  }
}

function validateModuleReport(report) {
  if (!Array.isArray(report?.chunks) || !report.chunks.length) {
    throw new Error("renderer 模块报告为空");
  }
  const chunks = new Map(
    report.chunks.map((chunk) => [chunk.fileName, chunk])
  );
  const entries = report.chunks.filter((chunk) => chunk.isEntry);
  if (!entries.length) throw new Error("renderer 模块报告没有 entry");
  const laneChunks = LAZY_LANES.map((lane) => {
    const hits = report.chunks.filter((chunk) =>
      chunk.moduleIds.some((id) => lane.pattern.test(id))
    );
    if (!hits.length) {
      throw new Error(`renderer 模块报告未命中任何${lane.name}模块`);
    }
    return { lane, hits };
  });

  const staticVisited = new Set();
  const visitStatic = (name) => {
    if (staticVisited.has(name)) return;
    staticVisited.add(name);
    const chunk = chunks.get(name);
    if (!chunk) throw new Error(`renderer 模块报告缺少 import chunk: ${name}`);
    for (const lane of LAZY_LANES) {
      if (chunk.moduleIds.some((id) => lane.pattern.test(id))) {
        throw new Error(`${lane.name}进入 renderer entry 静态闭包: ${name}`);
      }
    }
    chunk.imports.forEach(visitStatic);
  };
  entries.forEach((entry) => visitStatic(entry.fileName));

  const dynamicallyReachable = new Set();
  const queue = entries.map((entry) => [entry.fileName, false]);
  const visited = new Set();
  while (queue.length) {
    const [name, crossedDynamic] = queue.shift();
    const key = `${name}:${crossedDynamic}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const chunk = chunks.get(name);
    if (!chunk) continue;
    if (crossedDynamic) dynamicallyReachable.add(name);
    chunk.imports.forEach((next) => queue.push([next, crossedDynamic]));
    chunk.dynamicImports.forEach((next) => queue.push([next, true]));
  }
  for (const { lane, hits } of laneChunks) {
    for (const chunk of hits) {
      if (!dynamicallyReachable.has(chunk.fileName)) {
        throw new Error(
          `${lane.name} chunk 未经 dynamic import 边界到达: ${chunk.fileName}`
        );
      }
    }
  }
}

/**
 * 每条懒边界都必须有自己的负向对照：没有「摘掉就会红」的证据，一条断言
 * 与一行注释没有区别。故 fixture 逐条生成——加边界即自动带上它的反例。
 */
function selfTest() {
  const lazyChunks = LAZY_LANES.map((lane, index) => ({
    fileName: `lazy-${index}.js`,
    isEntry: false,
    imports: [],
    dynamicImports: [],
    moduleIds: [lane.sample],
  }));
  const entry = {
    fileName: "entry.js",
    isEntry: true,
    imports: [],
    dynamicImports: lazyChunks.map((chunk) => chunk.fileName),
    moduleIds: ["src/main.tsx"],
  };
  validateModuleReport({ chunks: [entry, ...lazyChunks] });

  for (const [index, lane] of LAZY_LANES.entries()) {
    const hoisted = lazyChunks[index].fileName;
    let failed = false;
    try {
      validateModuleReport({
        chunks: [
          {
            ...entry,
            imports: [hoisted],
            dynamicImports: entry.dynamicImports.filter(
              (name) => name !== hoisted
            ),
          },
          ...lazyChunks,
        ],
      });
    } catch {
      failed = true;
    }
    if (!failed) {
      throw new Error(`bundle guard 的${lane.name}失败 fixture 未变红`);
    }
  }
}

try {
  if (process.argv.includes("--self-test")) selfTest();
  checkBundle();
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  validateModuleReport(report);
  rmSync(reportPath, { force: true });
} catch (cause) {
  console.error(
    `[bundle-budget] ${cause instanceof Error ? cause.message : String(cause)}`
  );
  process.exitCode = 1;
}
