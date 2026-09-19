/**
 * [INPUT]: Depends on the closed output-root parser, Node fs/path and the selected assembly's main-process chunks.
 * [OUTPUT]: Fails the build when the eager main closure statically pulls TypeScript, ExcelJS, electron-updater, the Claude Agent SDK or a libsodium chunk, or when the pre-window cloud prepare chunk statically reaches the cloud composition chunk or libsodium; prints the closure's byte total. Every pattern is proven against both the spaced and the minified shape of the same assembly.
 * [POS]: Main-process counterpart to check-renderer-bundle; the startup cost of the main bundle is enforced mechanically here, with negative self-tests for every banned package.
 */

import { Buffer } from "node:buffer";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import console from "node:console";
import process from "node:process";
import { resolveOutputRoot } from "./assembly/output-root.mjs";

/**
 * 主进程没有 index.html 可读，边界写在 chunk 之间：出口 `index.js` 是个两 KB
 * 的门房，它做的唯一一件事就是立刻把真正的 main chunk 拉起来——所以门房的
 * 动态 require 与静态 require 同样是启动开销，而其余 chunk 的动态 require
 * 才是真的懒边界。
 *
 * 名单上的四个包都不为第一帧服务，却都曾经在 `app.whenReady` 之前被求值：
 * TypeScript 9.1 MB、ExcelJS 约 100 ms、electron-updater 约 47 ms（首检在
 * 30 秒之后）、Claude SDK 1.3 MB。数字会变，结构不会：它们只能活在动态边界
 * 之后，这条断言防的就是某次重构悄悄把边界拆掉。
 */
const BANNED_PACKAGES = [
  "typescript",
  "exceljs",
  "electron-updater",
  "@anthropic-ai/claude-agent-sdk",
];

/* Rollup 的 CJS 产物里，外部依赖的动态 import 原样保留为 `import("pkg")`，
   chunk 之间的动态 import 则写成 `Promise.resolve().then(() => require("./x"))`。
   两者都是懒边界，先把它们的文本范围遮掉，剩下的调用位置才算启动闭包。 */
const LAZY_CALL_PATTERNS = [
  /import\(\s*"(?:[^"\\]|\\.)*"\s*\)/g,
  /Promise\.resolve\(\)\.then\(\s*\(\s*\)\s*=>\s*require\(\s*"(?:[^"\\]|\\.)*"\s*\)\s*\)/g,
];
const RELATIVE_REQUIRE = /(?<![\w$.])require\(\s*"(\.[^"]*)"\s*\)/g;
/* 调用位置的字符串字面量：`require("x")`、`createRequire(…)("x")`、被 Rollup
   改名后的 `require$1("x")` 都在内。前置字符限定为标识符/右括号，JSON 里的
   `"typescript": { … }` 这种键名因此不会被误判——runtime-dependencies.json
   正是整份打进了 admission chunk。 */
const CALL_ARGUMENT = /[\w$)\]]\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

function lazyMask(source) {
  const mask = new Uint8Array(source.length);
  for (const pattern of LAZY_CALL_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      mask.fill(1, match.index, match.index + match[0].length);
    }
  }
  return mask;
}

function moduleEdges(source) {
  const mask = lazyMask(source);
  const staticRelative = new Set();
  const dynamicRelative = new Set();
  for (const match of source.matchAll(RELATIVE_REQUIRE)) {
    (mask[match.index] ? dynamicRelative : staticRelative).add(match[1]);
  }
  const eagerPackages = new Set();
  for (const match of source.matchAll(CALL_ARGUMENT)) {
    const specifier = match[1];
    const at = match.index + match[0].indexOf('"');
    if (mask[at] || specifier.startsWith(".")) continue;
    const owner = BANNED_PACKAGES.find(
      (name) => specifier === name || specifier.startsWith(`${name}/`)
    );
    if (owner) eagerPackages.add(owner);
  }
  return { staticRelative, dynamicRelative, eagerPackages };
}

/**
 * @param {{ entry: string, read: (name: string) => string, size?: (name: string) => number, entryFollowsDynamic?: boolean }} assembly
 */
function eagerClosure(assembly) {
  const entryFollowsDynamic = assembly.entryFollowsDynamic !== false;
  const visited = new Map();
  const violations = [];
  const queue = [assembly.entry];
  while (queue.length) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    const source = assembly.read(name);
    const edges = moduleEdges(source);
    visited.set(name, assembly.size ? assembly.size(name) : Buffer.byteLength(source));
    for (const owner of edges.eagerPackages) violations.push({ name, owner });
    const next = name === assembly.entry && entryFollowsDynamic
      ? [...edges.staticRelative, ...edges.dynamicRelative]
      : [...edges.staticRelative];
    for (const reference of next) queue.push(reference.replace(/^\.\//, ""));
  }
  return { chunks: visited, violations };
}


/**
 * 云端 composition 是个 1.1 MB 的块（外加 libsodium 的 wasm 初始化），但建窗前
 * 真正需要的只有 `prepareCloudRuntime` 读绑定那几步。两半被拆成 prepare.ts 与
 * composition.ts，边界同样只能靠 chunk 之间的 require 来证明：prepare 所在 chunk
 * 的静态闭包里一旦出现 composition 或 libsodium，拆分就白做了。
 * chunk 名带哈希，因此用各自的出口符号认人。
 */
/* libsodium 走的是 chunk 而不是包名（它在 externalizeDeps.exclude 里），所以
   “wasm 不进启动路径”只能按 chunk 名断言，包名黑名单看不见它。 */
const WASM_CHUNK_PREFIX = "libsodium";

const CLOUD_PREPARE_EXPORT = "prepareCloudRuntime";
const CLOUD_COMPOSITION_EXPORT = "createCloudRuntime";

/* 压缩产物里 `exports.x = y` 会被写成 `exports.x=y`：认人用的字面量一旦
   带上空格，这条边界就会在 main/preload 打开 minify 的那一刻静静地认不出
   任何 chunk，然后 cloudPrepareBoundary 返回 null、整条断言变成空跑。
   下方 selfTest 因此同时喂压缩与未压缩两种形态。 */
function chunkExporting(names, read, symbol) {
  const assignment = new RegExp(`exports\\.${symbol}\\s*=`);
  return names.filter((name) => assignment.test(read(name)));
}

/**
 * @param {{ names: string[], read: (name: string) => string }} assembly
 */
function cloudPrepareBoundary(assembly) {
  const { names, read } = assembly;
  const prepare = chunkExporting(names, read, CLOUD_PREPARE_EXPORT);
  const composition = chunkExporting(names, read, CLOUD_COMPOSITION_EXPORT);
  // 无云装配（stable）两半都不存在；只剩一半说明拆分被合并回去了。
  if (!prepare.length && !composition.length) return null;
  if (prepare.length !== 1 || composition.length !== 1) {
    throw new Error("云端 prepare/composition 边界不是一对一的 chunk");
  }
  const { chunks } = eagerClosure({ entry: prepare[0], read, entryFollowsDynamic: false });
  const forbidden = [composition[0], ...names.filter((name) => name.startsWith(WASM_CHUNK_PREFIX))];
  return { prepare: prepare[0], reached: forbidden.filter((name) => chunks.has(name)), chunks };
}

function format(bytes) {
  return bytes.toLocaleString("en-US");
}

function checkAssembly(outputRoot) {
  const mainRoot = resolve(import.meta.dirname, "..", outputRoot, "main");
  const { chunks, violations } = eagerClosure({
    entry: "index.js",
    read: (name) => readFileSync(resolve(mainRoot, name), "utf8"),
    size: (name) => statSync(resolve(mainRoot, name)).size,
  });
  const total = [...chunks.values()].reduce((sum, bytes) => sum + bytes, 0);
  for (const [name, bytes] of [...chunks].sort((left, right) => right[1] - left[1])) {
    console.log(`[main-budget] ${name}: ${format(bytes)} raw`);
  }
  console.log(
    `[main-budget] eager closure: ${chunks.size} chunks, ${format(total)} raw bytes`
  );
  const names = readdirSync(mainRoot).filter((name) => name.endsWith(".js"));
  const boundary = cloudPrepareBoundary({
    names,
    read: (name) => readFileSync(resolve(mainRoot, name), "utf8"),
  });
  if (boundary) {
    console.log(
      `[main-budget] cloud prepare closure: ${boundary.prepare}, ${boundary.chunks.size} chunks`
    );
    for (const name of boundary.reached) {
      console.error(`[main-budget] 建窗前的 cloud prepare 静态依赖了 ${name}`);
    }
    if (boundary.reached.length) {
      throw new Error("cloud prepare 闭包静态依赖了 composition 或 libsodium");
    }
  }
  const wasm = [...chunks.keys()].filter((name) => name.startsWith(WASM_CHUNK_PREFIX));
  for (const name of wasm) console.error(`[main-budget] ${name} 进入启动闭包`);
  if (violations.length) {
    for (const violation of violations) {
      console.error(`[main-budget] ${violation.owner} 进入启动闭包: ${violation.name}`);
    }
    throw new Error("主进程启动闭包静态依赖了启动无关的重包");
  }
  if (wasm.length) throw new Error("主进程启动闭包静态依赖了 libsodium 的 wasm 块");
}

/**
 * 每个被禁包都带自己的反例：没有「摘掉就会红」的证据，一条断言与一行注释
 * 没有区别。懒形态、JSON 键名与 createRequire 形态同样逐条对照。
 */
function selfTest() {
  const lazy = (specifier) => `void import("${specifier}");`;
  const eager = (specifier) => `const value = require("${specifier}");`;
  const viaCreateRequire = (specifier) =>
    `const value = node_module.createRequire(require("url").pathToFileURL(__filename).href)(\n  "${specifier}"\n);`;
  const build = (body) => ({
    entry: "index.js",
    read: (name) =>
      name === "index.js"
        ? 'void Promise.resolve().then(() => require("./main-abc.js"));'
        : name === "main-abc.js"
          ? `const chunk = require("./shared-def.js");\n${body}\nvoid Promise.resolve().then(() => require("./lazy-ghi.js"));`
          : name === "lazy-ghi.js"
            ? BANNED_PACKAGES.map(eager).join("\n")
            : "module.exports = {};",
  });

  const wasmFixture = eagerClosure({
    entry: "index.js",
    read: (name) =>
      name === "index.js"
        ? 'void Promise.resolve().then(() => require("./main-abc.js"));'
        : name === "main-abc.js"
          ? 'const sodium = require("./libsodium-wrappers-def.js");'
          : "module.exports = {};",
  });
  if (![...wasmFixture.chunks.keys()].some((name) => name.startsWith(WASM_CHUNK_PREFIX))) {
    throw new Error("main bundle guard 的 libsodium 失败 fixture 未变红");
  }

  const clean = eagerClosure(
    build(
      [
        ...BANNED_PACKAGES.map(lazy),
        '/* JSON payload */ const manifest = { "typescript": { version: "5" }, "exceljs": {} };',
      ].join("\n")
    )
  );
  if (clean.violations.length) throw new Error("main bundle guard 误判了干净装配");
  if (!clean.chunks.has("main-abc.js") || !clean.chunks.has("shared-def.js")) {
    throw new Error("main bundle guard 未跟随启动闭包");
  }
  if (clean.chunks.has("lazy-ghi.js")) {
    throw new Error("main bundle guard 把非出口 chunk 的动态边界算成了启动闭包");
  }

  for (const name of BANNED_PACKAGES) {
    for (const shape of [eager, viaCreateRequire]) {
      const { violations } = eagerClosure(build(shape(name)));
      if (!violations.some((violation) => violation.owner === name)) {
        throw new Error(`main bundle guard 的 ${name} 失败 fixture 未变红`);
      }
    }
  }

  /* 压缩与未压缩共用一套 fixture：赋值形态由 prepareBody 是否带空格决定，
     两种写法都必须被 chunkExporting 认出来。 */
  const cloud = (prepareBody) => {
    const spaced = prepareBody.includes(" = ") || prepareBody.includes("() =>");
    const assign = (symbol, value) => (spaced ? `exports.${symbol} = ${value};` : `exports.${symbol}=${value};`);
    return {
      names: [
        "prepare-abc.js",
        "composition-def.js",
        "libsodium-wrappers-ghi.js",
        "shared-jkl.js",
      ],
      read: (name) =>
        name === "prepare-abc.js"
          ? `${prepareBody}\n${assign(CLOUD_PREPARE_EXPORT, "prepareCloudRuntime")}`
          : name === "composition-def.js"
            ? `const shared = require("./shared-jkl.js");\n${assign(CLOUD_COMPOSITION_EXPORT, "createCloudRuntime")}`
            : "module.exports = {};",
    };
  };

  const split = cloudPrepareBoundary(
    cloud(
      'const shared = require("./shared-jkl.js");\n' +
        'void Promise.resolve().then(() => require("./composition-def.js"));'
    )
  );
  if (!split || split.reached.length) throw new Error("cloud prepare guard 误判了拆开的装配");
  if (!split.chunks.has("shared-jkl.js")) throw new Error("cloud prepare guard 未跟随静态闭包");

  /* 压缩形态：同一装配去掉赋值两侧的空格与换行，结论必须一字不差。
     没有这一格，打开 minify 只会让守卫安静地不再认人。 */
  const minified = cloudPrepareBoundary(
    cloud('const shared=require("./shared-jkl.js");void Promise.resolve().then(()=>require("./composition-def.js"));')
  );
  if (!minified || minified.reached.length) throw new Error("cloud prepare guard 在压缩产物上误判了拆开的装配");
  if (!minified.chunks.has("shared-jkl.js")) throw new Error("cloud prepare guard 在压缩产物上未跟随静态闭包");
  const minifiedMerged = cloudPrepareBoundary(cloud('const chunk=require("./composition-def.js");'));
  if (!minifiedMerged.reached.length) {
    throw new Error("cloud prepare guard 的压缩失败 fixture 未变红");
  }

  for (const merged of ["./composition-def.js", "./libsodium-wrappers-ghi.js"]) {
    const { reached } = cloudPrepareBoundary(cloud(`const chunk = require("${merged}");`));
    if (!reached.length) throw new Error(`cloud prepare guard 的 ${merged} 失败 fixture 未变红`);
  }

  if (cloudPrepareBoundary({ names: ["index.js"], read: () => "module.exports = {};" })) {
    throw new Error("cloud prepare guard 在无云装配上不应有结论");
  }
  let halved = false;
  try {
    cloudPrepareBoundary({
      names: ["composition-def.js"],
      read: () => `exports.${CLOUD_COMPOSITION_EXPORT} = createCloudRuntime;`,
    });
  } catch { halved = true; }
  if (!halved) throw new Error("cloud prepare guard 未拦住被合回去的一半");
}

try {
  if (process.argv.includes("--self-test")) selfTest();
  checkAssembly(resolveOutputRoot(process.argv.slice(2), process.env, ["--self-test"]));
} catch (cause) {
  console.error(
    `[main-budget] ${cause instanceof Error ? cause.message : String(cause)}`
  );
  process.exitCode = 1;
}
