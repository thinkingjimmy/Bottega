/**
 * [INPUT]: Depends on Node Buffer only
 * [OUTPUT]: Provides moduleEdges and eagerClosure, the static-require walk over a Rollup CJS main assembly that masks lazy `import()` / `Promise.resolve().then(() => require())` edges
 * [POS]: Shared by check-main-bundle (banned packages, cloud prepare boundary) and budget/check-budgets (main and worker surface bytes)
 */
import { Buffer } from "node:buffer";

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

export function moduleEdges(source, banned = []) {
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
    const owner = banned.find(
      (name) => specifier === name || specifier.startsWith(`${name}/`)
    );
    if (owner) eagerPackages.add(owner);
  }
  return { staticRelative, dynamicRelative, eagerPackages };
}

/**
 * @param {{ entry: string, read: (name: string) => string, size?: (name: string) => number, entryFollowsDynamic?: boolean, banned?: readonly string[] }} assembly
 */
export function eagerClosure(assembly) {
  const entryFollowsDynamic = assembly.entryFollowsDynamic !== false;
  const visited = new Map();
  const violations = [];
  const queue = [assembly.entry];
  while (queue.length) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    const source = assembly.read(name);
    const edges = moduleEdges(source, assembly.banned);
    visited.set(name, assembly.size ? assembly.size(name) : Buffer.byteLength(source));
    for (const owner of edges.eagerPackages) violations.push({ name, owner });
    const next = name === assembly.entry && entryFollowsDynamic
      ? [...edges.staticRelative, ...edges.dynamicRelative]
      : [...edges.staticRelative];
    for (const reference of next) queue.push(reference.replace(/^\.\//, ""));
  }
  return { chunks: visited, violations };
}
