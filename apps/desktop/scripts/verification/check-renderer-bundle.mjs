/**
 * [INPUT]: Depends on the closed output-root parser, the shared LAZY_LANES table, Node fs/path, the shared system-font asset policy, the sealed Sketch boundary checker and the temporary Rollup module report.
 * [OUTPUT]: Enforces the independent dynamic boundaries declared in LAZY_LANES (charts, native/composer locales and the rest), with a generated negative self-test per lane, that no chunk carries main-only modules (MAIN_ONLY: shared/i18n/native) or the full shiki bundle, Oniguruma or non-GitHub themes (SHIKI_EXCLUDED, OPT-24), or any @phosphor-icons/react module (PHOSPHOR_PACKAGE, OPT-36), that the task panel, Dock bar and Dock panel first paint carry no zod (ZOD_FREE_ENTRIES, OPT-34), and that a build without the workbench flag, of any flavor, renders none of the workbench-only modules (E-01; the shared workbench copy stays, the read-only workflow columns use it in both builds); Sketch editor/history must remain outside every renderer chunk and in the exact signed on-demand resource pinned by the compiler while host compute retains a dedicated Worker; byte ceilings live in budget/check-budgets.mjs. Enforces shared system-font policy over emitted renderer assets.
 * [POS]: apps/desktop/scripts/verification; Last segment of the desktop build script; the renderer first-load boundary is enforced mechanically here and the module report is deleted after checking so it never ships
 */

import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import console from "node:console";
import process from "node:process";
import { resolveOutputRoot } from "../assembly/output-root.mjs";
import { assertSystemFontAssets } from "../../../../packages/ui/src/styles/system-fonts.mjs";
import { LAZY_LANES } from "../assembly/lazy-lanes.mjs";
import { SKETCH_HOST_MODULE, SEALED_SKETCH_MODULES, sketchDigest, validateSketchReport, validateSketchArtifacts, validatePluginArtifacts, verifySketchBuild } from "../budget/sketch-boundary.mjs";

const outputRoot = resolveOutputRoot(process.argv.slice(2), process.env, ["--self-test"]);
const rendererRoot = resolve(import.meta.dirname, "../..", outputRoot, "renderer");
const reportPath = resolve(rendererRoot, ".chart-module-report.json");

/* Workbench-only surfaces: pages, dialogs and run views that exist only with BOTTEGA_WORKBENCH_UI=1. The flag-constant entry
   hooks (`() => null` with the flag off) are not listed: a few bytes by design. */
export const WORKBENCH_ONLY = /src\/views\/settings\/(?:agent-configs|plugins)\/settings-(?:agent-configs|plugins)\.tsx$|components\/settings\/project\/workflows\/|components\/settings\/agent-configs\/(config-dialog|config-list|available-in|guarantee-copy)|components\/settings\/plugins\/plugin-rows|components\/bases\/workflow\/(setup-host|runs-host)|base-ui\/dist\/ui\/workflow\/(setup-dialog|run-details|confirm-panel|record-section|run-chooser)\.js$/;

/* A build without the workbench flag renders none of the workbench-only modules (any flavor, production included). */
function validateWorkbenchOff(report) {
  if (report.workbenchUi !== false) return;
  for (const chunk of report.chunks) {
    const kept = (chunk.rendered ?? []).filter((id) => WORKBENCH_ONLY.test(id));
    if (kept.length) throw new Error(`workbench 开关关闭的构建仍含 workbench 模块: ${chunk.fileName} → ${kept.join(", ")}`);
  }
}

/* Main-only copy (`settings.native.*`) never reaches any renderer chunk, eager or lazy. */
export const MAIN_ONLY = /shared\/i18n\/native\//;

function validateMainOnlyAbsent(report) {
  for (const chunk of report.chunks ?? []) {
    const leaked = (chunk.moduleIds ?? []).filter((id) => MAIN_ONLY.test(id));
    if (leaked.length) throw new Error(`renderer chunk ${chunk.fileName} 含主进程专用模块: ${leaked.join(", ")}`);
  }
}

/* OPT-24: the code highlighter uses shiki/core with the JS engine and the two GitHub themes; the root bundle, the Oniguruma
   engine/WASM and every other theme stay out of the renderer entirely. */
export const SHIKI_EXCLUDED = /shiki\/dist\/(?:bundle-(?:full|web)|engine-oniguruma|onig)|@shikijs\/engine-oniguruma\/|@shikijs\/themes\/dist\/(?!github-(?:light|dark)\.mjs$)/;

function validateShikiSlim(report) {
  for (const chunk of report.chunks ?? []) {
    const kept = (chunk.moduleIds ?? []).filter((id) => SHIKI_EXCLUDED.test(id));
    if (kept.length) throw new Error(`renderer chunk ${chunk.fileName} 含 shiki 全量模块: ${kept.slice(0, 3).join(", ")}`);
  }
}

/* OPT-36: the product UI draws its two Phosphor glyphs from regular-weight copies (packages/ui components/icons); the package,
   with its six weights, IconBase and context, stays out of the renderer. The App GUI compiler's own Phosphor use is main-side. */
export const PHOSPHOR_PACKAGE = /@phosphor-icons\/react\//;
function validatePhosphorAbsent(report) {
  for (const chunk of report.chunks ?? []) {
    const kept = (chunk.moduleIds ?? []).filter((id) => PHOSPHOR_PACKAGE.test(id));
    if (kept.length) throw new Error(`renderer chunk ${chunk.fileName} 含 @phosphor-icons/react: ${kept.slice(0, 3).join(", ")}`);
  }
}

/* OPT-34: the auxiliary windows' first paint carries no zod: the notch task panel, the Dock bar and the Dock panel read their
   contracts as types and zod-free helpers only (the main window index is tracked separately, see DEV/platform/opt-34). */
export const ZOD_FREE_ENTRIES = /^assets\/(?:task-panel|system-dock-bar|system-dock-panel)-[\w-]+\.js$/;
export const ZOD_MODULE = /node_modules\/(?:\.pnpm\/zod@[^/]+\/node_modules\/)?zod\//;
function validateAuxiliaryZodFree(report) {
  const chunks = new Map((report.chunks ?? []).map((chunk) => [chunk.fileName, chunk]));
  for (const entry of (report.chunks ?? []).filter((chunk) => chunk.isEntry && ZOD_FREE_ENTRIES.test(chunk.fileName))) {
    const seen = new Set(), queue = [entry.fileName];
    while (queue.length) {
      const name = queue.shift(); if (seen.has(name)) continue; seen.add(name);
      const chunk = chunks.get(name); if (!chunk) continue;
      const kept = (chunk.moduleIds ?? []).filter((id) => ZOD_MODULE.test(id));
      if (kept.length) throw new Error(`${entry.fileName} 首屏闭包含 zod（${name}）: ${kept.slice(0, 2).join(", ")}`);
      queue.push(...(chunk.imports ?? []));
    }
  }
}

function validateBuiltBaseUi(report) {
  for (const chunk of report.chunks ?? []) {
    const source = (chunk.moduleIds ?? []).find(id => /packages\/base-ui\/src\//.test(id));
    if (source) throw new Error(`Renderer imported unbuilt Base UI: ${source}`);
  }
}

function validateModuleReport(report) {
  validateBuiltBaseUi(report);
  validateSketchReport(report);
  validateWorkbenchOff(report);
  validateAuxiliaryZodFree(report);
  validateMainOnlyAbsent(report);
  validateShikiSlim(report);
  validatePhosphorAbsent(report);
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
  const host = { fileName: "host.js", moduleIds: [SKETCH_HOST_MODULE] };
  validateSketchReport({ chunks: [host] });
  const reject = (run, name) => { let failed = false; try { run(); } catch { failed = true; } if (!failed) throw new Error(`Sketch boundary self-test did not reject ${name}`); };
  reject(() => validateBuiltBaseUi({ chunks: [{ moduleIds: ["packages/base-ui/src/ui/base-workbench.tsx"] }] }), "unbuilt Base UI");
  for (const sample of SEALED_SKETCH_MODULES.map(value => value.sample)) {
    reject(() => validateSketchReport({ chunks: [host, { fileName: "lazy.js", moduleIds: [sample] }] }), sample);
  }
  reject(() => validateSketchReport({ chunks: [] }), "missing trusted compute host");
  const snapshot = { runtime: "export function SketchPlugin(){}", styles: ".sketch{}" }, types = "export function SketchPlugin():unknown;";
  const identity = { sourceDigest: sketchDigest(snapshot.runtime + types + snapshot.styles) };
  const resourceBytes = JSON.stringify({ schema: "bottega.sketch-module/v1", ...snapshot, types, sourceDigest: identity.sourceDigest });
  const manifestModule = { path: "modules/sketch.json", sha256: sketchDigest(resourceBytes), sourceDigest: identity.sourceDigest };
  const artifact = { snapshot, types, identity, resourceBytes, manifestModule, compiledStrings: new Set(["modules/sketch.json", identity.sourceDigest]),
    workers: [{ name: "coverage.worker-test.js", source: "self.onmessage=()=>self.postMessage({});" }],
    hostSources: ['new Worker(new URL("coverage.worker-test.js",import.meta.url))'] };
  validateSketchArtifacts(artifact);
  const sdk = { schema: "bottega.plugin-module/v1", runtime: "sdk", types: "types", bootstrap: "bootstrap" };
  const sdkDigest = sketchDigest(sdk.runtime + sdk.types + sdk.bootstrap), sdkBytes = JSON.stringify({ ...sdk, sourceDigest: sdkDigest });
  const sdkArtifact = { resourceBytes: sdkBytes, identity: { sourceDigest: sdkDigest }, manifestModule: { path: "modules/plugin.json", sha256: sketchDigest(sdkBytes), sourceDigest: sdkDigest }, compiledStrings: new Set([sdkDigest, "modules/plugin.json"]) };
  validatePluginArtifacts(sdkArtifact);
  reject(() => validatePluginArtifacts({ ...sdkArtifact, resourceBytes: "" }), "missing SDK resource");
  reject(() => validatePluginArtifacts({ ...sdkArtifact, identity: { sourceDigest: "bad" } }), "SDK identity drift");
  reject(() => validatePluginArtifacts({ ...sdkArtifact, compiledStrings: new Set() }), "missing SDK compiler identity");
  reject(() => validatePluginArtifacts({ ...sdkArtifact, compiledStrings: new Set([...sdkArtifact.compiledStrings, sdk.bootstrap]) }), "embedded SDK bootstrap");
  for (const [name, change] of [
    ["missing official runtime", { snapshot: { ...snapshot, runtime: "" } }],
    ["missing official styles", { snapshot: { ...snapshot, styles: "" } }],
    ["missing declarations", { types: "" }],
    ["identity drift", { identity: { sourceDigest: "sha256:" + "0".repeat(64) } }],
    ["missing compiler identity", { compiledStrings: new Set(["modules/sketch.json"]) }],
    ["embedded compiler snapshot", { compiledStrings: new Set([...artifact.compiledStrings, snapshot.runtime]) }],
    ["missing module resource", { resourceBytes: "" }],
    ["module resource corruption", { resourceBytes: resourceBytes + "corrupt" }],
    ["module manifest mismatch", { manifestModule: { ...manifestModule, sha256: "bad" } }],
    ["missing Worker", { workers: [] }],
    ["duplicate Worker", { workers: [...artifact.workers, ...artifact.workers] }],
    ["empty Worker", { workers: [{ ...artifact.workers[0], source: "" }] }],
    ["Worker protocol missing", { workers: [{ ...artifact.workers[0], source: "void 0" }] }],
    ["Worker host disconnected", { hostSources: ["new Worker(new URL('wrong.js',import.meta.url))"] }],
  ]) reject(() => validateSketchArtifacts({ ...artifact, ...change }), name);

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
    moduleIds: ["src/main.tsx", SKETCH_HOST_MODULE],
  };
  validateModuleReport({ chunks: [entry, ...lazyChunks] });

  // The flag-off guard reddens on a kept workbench page and stays quiet with the flag on.
  const withPage = (workbenchUi) => ({ workbenchUi, chunks: [{ ...entry, rendered: ["src/views/settings/plugins/settings-plugins.tsx"] }, ...lazyChunks] });
  validateModuleReport(withPage(true));
  let kept = false;
  try { validateModuleReport(withPage(false)); } catch { kept = true; }
  if (!kept) throw new Error("bundle guard 的 workbench 关闭失败 fixture 未变红");
  let leaked = false;
  try { validateModuleReport({ chunks: [{ ...entry, moduleIds: [...entry.moduleIds, "shared/i18n/native/en.ts"] }, ...lazyChunks] }); } catch { leaked = true; }
  if (!leaked) throw new Error("bundle guard 未拦下含主进程专用文案的 renderer fixture");
  for (const heavy of ["node_modules/shiki/dist/bundle-full.mjs", "node_modules/@shikijs/themes/dist/nord.mjs", "node_modules/@shikijs/engine-oniguruma/dist/index.mjs"]) {
    let refused = false;
    try { validateModuleReport({ chunks: [{ ...entry, moduleIds: [...entry.moduleIds, heavy] }, ...lazyChunks] }); } catch { refused = true; }
    if (!refused) throw new Error(`bundle guard 未拦下 ${heavy}`);
  }
  validateModuleReport({ chunks: [{ ...entry, moduleIds: [...entry.moduleIds, "node_modules/@shikijs/themes/dist/github-dark.mjs"] }, ...lazyChunks] });
  let phosphorRefused = false;
  try { validateModuleReport({ chunks: [{ ...entry, moduleIds: [...entry.moduleIds, "node_modules/@phosphor-icons/react/dist/csr/Confetti.es.js"] }, ...lazyChunks] }); } catch { phosphorRefused = true; }
  if (!phosphorRefused) throw new Error("bundle guard 未拦下 @phosphor-icons/react");
  let zodRefused = false;
  const dock = { ...entry, fileName: "assets/system-dock-panel-test.js", imports: ["shared.js"], dynamicImports: [] };
  try { validateModuleReport({ chunks: [entry, dock, { fileName: "shared.js", isEntry: false, imports: [], dynamicImports: [], moduleIds: ["node_modules/.pnpm/zod@4.6.4/node_modules/zod/v4/core/schemas.js"] }, ...lazyChunks] }); } catch { zodRefused = true; }
  if (!zodRefused) throw new Error("bundle guard 未拦下 Dock 面板首屏闭包里的 zod");

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
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  validateModuleReport(report);
  verifySketchBuild({ desktopRoot: resolve(import.meta.dirname, "../.."), rendererRoot, outputRoot, report });
  assertSystemFontAssets(rendererRoot);
  rmSync(reportPath, { force: true });
} catch (cause) {
  console.error(
    `[bundle-budget] ${cause instanceof Error ? cause.message : String(cause)}`
  );
  process.exitCode = 1;
}
