/**
 * [INPUT]: Depends on the closed output-root parser, the shared main-closure walker, Node fs/path/zlib and surface-budgets.json (v2)
 * [OUTPUT]: Measures every listed surface (reading the build's flavour marker; preload and main gate only production, renderers every build; `--production` and `--resample` require production): three renderer entries' eager JS/CSS, three preloads including isolated Dock details, the main eager closure and each worker/host closure with its eager external packages. Gates each surface against its release baseline: renderer raw blocks above the renderer line; Node raw warns above the Node warning line and blocks above its block line; a new two-byte chunk or a new eager external package blocks. Renderer gzip/brotli are reported only. `--resample --reason` moves every baseline to the measured build and records why.
 * [POS]: The one byte gate for every desktop surface (OPT-30); check-renderer-bundle keeps the lazy boundaries and check-main-bundle keeps the banned-package boundaries, this file owns the numbers
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, sep, isAbsolute } from "node:path";
import console from "node:console";
import process from "node:process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { resolveOutputRoot } from "../assembly/output-root.mjs";
import { eagerClosure, eagerExternalPackages } from "../assembly/main-closure.mjs";

const LEDGER = resolve(import.meta.dirname, "surface-budgets.json");
const RENDERER_ENTRIES = ["index", "system-dock-bar", "system-dock-panel"];
const PRELOADS = ["index", "system-dock", "system-dock-detail"];
/* Every main-process input that starts its own process or worker; each is resident for that process's life. */
const NODE_ENTRIES = ["index", "sync-crypto-worker-entry", "builtin-tools-server", "codec-host-entry", "custody-guardian-entry",
  "utility-host-entry", "provider-bridge-entry", "app-gui-compiler-entry", "app-gui-query-worker-entry", "chat-database-worker-entry", "history-import-worker-entry",
  /* The built-in Providers' bridge modules (TASK-11 d2), inside their bundled packages (d3): each self-contained, pinned in runtime-entries.json. */
  "providers/codex/bridge", "providers/claude/bridge", "providers/kimi/bridge", "providers/opencode/bridge"];

const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
const twoByte = (text) => Array.from(text).some(character => character.codePointAt(0) > 255);

/** Eager JS (module scripts + modulepreload) and blocking CSS of one HTML entry. */
function htmlReferences(root, html) {
  const js = new Set(), css = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const isScript = /^<script\b/i.test(tag) && attribute(tag, "type") === "module";
    const rel = attribute(tag, "rel");
    const reference = attribute(tag, isScript ? "src" : "href");
    if (!reference) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) throw new Error(`non-local asset: ${reference}`);
    const path = resolve(root, decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/^\.?\//, ""));
    const local = relative(root, path);
    if (local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error(`asset escapes the renderer output: ${reference}`);
    if ((isScript || rel === "modulepreload") && /\.js$/.test(path)) js.add(path);
    if (rel === "stylesheet" && /\.css$/.test(path)) css.add(path);
  }
  return { js: [...js], css: [...css] };
}

function measureFiles(paths) {
  const total = { raw: 0, gzip: 0, brotli: 0, twoByteChunks: 0, files: paths.length };
  for (const path of paths) {
    const bytes = readFileSync(path);
    total.raw += bytes.byteLength;
    total.gzip += gzipSync(bytes, { level: 9 }).byteLength;
    total.brotli += brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength;
    if (twoByte(bytes.toString("utf8"))) total.twoByteChunks += 1;
  }
  return total;
}

export function measureSurfaces(outputRoot) {
  const base = resolve(import.meta.dirname, "..", "..", outputRoot);
  const surfaces = {};
  const rendererRoot = resolve(base, "renderer");
  for (const entry of RENDERER_ENTRIES) {
    const { js, css } = htmlReferences(rendererRoot, readFileSync(resolve(rendererRoot, `${entry}.html`), "utf8"));
    if (!js.length) throw new Error(`${entry}.html declares no eager module JS`);
    surfaces[`renderer/${entry}/js`] = measureFiles(js);
    if (css.length) surfaces[`renderer/${entry}/css`] = measureFiles(css);
  }
  for (const name of PRELOADS) {
    const path = resolve(base, "preload", `${name}.js`);
    surfaces[`preload/${name}`] = { ...measureFiles([path]), eagerPackages: [...eagerExternalPackages(readFileSync(path, "utf8"))].sort() };
  }
  const mainRoot = resolve(base, "main");
  for (const entry of NODE_ENTRIES) {
    const file = `${entry}.js`;
    if (!existsSync(resolve(mainRoot, file))) throw new Error(`main entry missing: ${file}`);
    /* The main index is a two-KB doorway whose dynamic edges are startup cost; every other entry follows static edges only. */
    const { chunks } = eagerClosure({ entry: file, read: name => readFileSync(resolve(mainRoot, name), "utf8"), entryFollowsDynamic: entry === "index" });
    const paths = [...chunks.keys()].map(name => resolve(mainRoot, name));
    const packages = new Set(paths.flatMap(path => [...eagerExternalPackages(readFileSync(path, "utf8"))]));
    surfaces[`main/${entry}`] = { ...measureFiles(paths), eagerPackages: [...packages].sort() };
  }
  return surfaces;
}

const isRenderer = (surface) => surface.startsWith("renderer/");
/* Node surfaces (preload, main) gate only the build that ships: non-production inputs such as e2e-entry re-split shared chunks. */
const gatesInFlavor = (surface, flavor) => isRenderer(surface) || flavor === "production";
export const requireProduction = (flavor) => flavor === "production" ? [] : [`the production gate needs a production build; this output was built as ${flavor}`];
const lineOf = (baseline, fraction) => Math.ceil(baseline * (1 + fraction));
const share = (fraction) => `${Math.round(fraction * 100)}%`;
const bytes = (value) => value.toLocaleString("en-US");
const growth = (actual, baseline) => `${actual >= baseline ? "+" : ""}${((actual / baseline - 1) * 100).toFixed(2)}%`;

/* Raw bytes are what a desktop process reads and parses; renderer gzip and brotli are kept in the baseline for the record only,
   because the desktop loads local files and never transfers compressed bytes. */
export function compare(ledger, measured, flavor = "production") {
  const failures = [], warnings = [];
  for (const surface of Object.keys({ ...ledger.surfaces, ...measured })) {
    const entry = ledger.surfaces[surface], actual = measured[surface];
    if (!entry) { failures.push(`${surface}: measured but has no baseline in the ledger`); continue; }
    if (!actual) { failures.push(`${surface}: has a baseline but was not built`); continue; }
    if (!gatesInFlavor(surface, flavor)) continue;
    const { warn, block } = ledger.policy[isRenderer(surface) ? "renderer" : "node"], baseline = entry.baseline.raw;
    const size = `${bytes(actual.raw)} raw is ${growth(actual.raw, baseline)} against the ${bytes(baseline)} baseline`;
    if (actual.raw > lineOf(baseline, block)) failures.push(`${surface}: ${size} (blocks above +${share(block)})`);
    else if (warn !== undefined && actual.raw > lineOf(baseline, warn)) warnings.push(`${surface}: ${size} (warns above +${share(warn)}, blocks above +${share(block)})`);
    if (actual.twoByteChunks > entry.twoByteChunks) failures.push(`${surface}: ${actual.twoByteChunks} two-byte chunks > ${entry.twoByteChunks}`);
    if (isRenderer(surface)) continue;
    if (!Array.isArray(entry.eagerPackages)) { failures.push(`${surface}: no recorded eager packages; resample to record them`); continue; }
    for (const name of actual.eagerPackages ?? []) {
      if (!entry.eagerPackages.includes(name)) failures.push(`${surface}: new eager external package ${name} now loads when the process starts`);
    }
  }
  return { failures, warnings };
}

/* A baseline is the measured build of a formal release (or an approved exception), so the lines bound the growth of a whole release
   cycle rather than of one change. Two-byte chunk counts and eager packages are exact: they have no headroom. */
export function resample(ledger, measured, reason, date) {
  const surfaces = Object.fromEntries(Object.entries(measured).map(([surface, value]) => [surface, {
    baseline: { raw: value.raw, gzip: value.gzip, brotli: value.brotli }, twoByteChunks: value.twoByteChunks,
    ...(isRenderer(surface) ? {} : { eagerPackages: [...value.eagerPackages].sort() }),
  }]));
  return { ...ledger, surfaces, history: [...ledger.history, { date, reason }] };
}

function selfTest() {
  const ledger = { policy: { renderer: { block: 0.02 }, node: { warn: 0.02, block: 0.05 } }, history: [], surfaces: {} };
  const one = { raw: 1000, gzip: 400, brotli: 350, twoByteChunks: 1, files: 1 };
  const node = { ...one, eagerPackages: ["react"] };
  const frozen = resample(ledger, { "renderer/index/js": one, "main/index": node }, "self-test", "2026-01-01");
  const run = (sample, flavor) => compare(frozen, sample, flavor);
  const fresh = run({ "renderer/index/js": one, "main/index": node });
  if (fresh.failures.length || fresh.warnings.length) throw new Error("self-test: a fresh sample did not pass silently");
  const cases = [
    [{ "renderer/index/js": { ...one, raw: 1021 }, "main/index": node }, "renderer raw over +2 %"],
    [{ "renderer/index/js": one, "main/index": { ...node, raw: 1051 } }, "main raw over +5 %"],
    [{ "renderer/index/js": { ...one, twoByteChunks: 2 }, "main/index": node }, "a new two-byte chunk"],
    [{ "renderer/index/js": one, "main/index": { ...node, eagerPackages: ["lodash", "react"] } }, "a new eager external package"],
    [{ "renderer/index/js": one }, "a surface that disappeared"],
    [{ "renderer/index/js": one, "main/index": node, "renderer/new/js": one }, "a surface without a baseline"],
  ];
  for (const [sample, name] of cases) if (!run(sample).failures.length) throw new Error(`self-test: ${name} did not fail`);
  const warned = run({ "renderer/index/js": one, "main/index": { ...node, raw: 1050 } });
  if (warned.failures.length || warned.warnings.length !== 1) throw new Error("self-test: main raw between +2 % and +5 % must warn without failing");
  if (run({ "renderer/index/js": one, "main/index": { ...node, raw: 1020 } }).warnings.length) throw new Error("self-test: main raw at +2 % warned");
  if (run({ "renderer/index/js": { ...one, gzip: 10_000, brotli: 10_000 }, "main/index": node }).failures.length) throw new Error("self-test: desktop renderer gzip or brotli gated");
  if (run({ "renderer/index/js": one, "main/index": { ...node, eagerPackages: [] } }).failures.length) throw new Error("self-test: dropping an eager package failed");
  const unrecorded = { ...frozen, surfaces: { ...frozen.surfaces, "main/index": { ...frozen.surfaces["main/index"], eagerPackages: undefined } } };
  if (!compare(unrecorded, { "renderer/index/js": one, "main/index": node }).failures.length) throw new Error("self-test: a Node surface without recorded eager packages passed");
  /* Doc ruling 2026-09-26: Node surfaces gate the shipped (production) build only; e2e-entry and other non-production inputs re-split
     shared chunks, so a staging or stable build reports its Node deltas without failing. Renderer surfaces gate every flavour. */
  const overNode = { "renderer/index/js": one, "main/index": { ...node, raw: 5_000 } };
  if (!run(overNode, "production").failures.length) throw new Error("self-test: a production Node surface over its block line passed");
  if (run(overNode, "staging").failures.length) throw new Error("self-test: a staging Node surface failed although it only reports");
  if (!run({ "renderer/index/js": { ...one, raw: 5_000 }, "main/index": node }, "staging").failures.length) throw new Error("self-test: a staging renderer surface stopped gating");
  if (!requireProduction("staging").length || requireProduction("production").length) throw new Error("self-test: --production does not insist on a production build");
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
const args = process.argv.slice(2);
const flag = (name) => { const index = args.indexOf(name); if (index < 0) return undefined; const value = args[index + 1]; args.splice(index, 2); return value; };
try {
  const reason = flag("--reason");
  const doResample = args.includes("--resample");
  const doSelfTest = args.includes("--self-test");
  const production = args.includes("--production");
  const outputRoot = resolveOutputRoot(args.filter(arg => arg !== "--resample" && arg !== "--self-test" && arg !== "--production"), process.env);
  if (doSelfTest) selfTest();
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  /* A build without its flavour marker is treated as shipped: the stricter reading. */
  const flavorFile = resolve(import.meta.dirname, "..", "..", outputRoot, "main", "build-flavor.json");
  const flavor = existsSync(flavorFile) ? JSON.parse(readFileSync(flavorFile, "utf8")).flavor : "production";
  /* Ceilings describe shipped bytes, so they are only ever sampled from a production build too. */
  if (production || doResample) { const refused = requireProduction(flavor); if (refused.length) throw new Error(refused[0]); }
  const measured = measureSurfaces(outputRoot);
  for (const [surface, value] of Object.entries(measured)) {
    const entry = ledger.surfaces[surface];
    console.log(`[surface-budget] ${surface}: ${bytes(value.raw)} raw / ${bytes(value.gzip)} gzip / ${bytes(value.brotli)} br, ${value.twoByteChunks} two-byte of ${value.files}${entry ? ` (${growth(value.raw, entry.baseline.raw)} against the ${bytes(entry.baseline.raw)} baseline)` : ""}`);
  }
  if (doResample) {
    if (!reason) throw new Error("--resample needs --reason: every baseline change is recorded in the ledger history");
    writeFileSync(LEDGER, `${JSON.stringify(resample(ledger, measured, reason, new Date().toISOString().slice(0, 10)), null, 2)}\n`);
    console.log(`[surface-budget] baselines resampled from ${outputRoot}`);
  } else {
    if (flavor !== "production") console.log(`[surface-budget] ${flavor} build: preload and main deltas are reported, not gated (they gate the production build)`);
    const { failures, warnings } = compare(ledger, measured, flavor), shipped = compare(ledger, measured);
    for (const line of [...shipped.failures, ...shipped.warnings].filter(line => !failures.includes(line) && !warnings.includes(line))) console.log(`[surface-budget] reported, not gated: ${line}`);
    for (const warning of warnings) console.warn(`[surface-budget] warning: ${warning}`);
    if (warnings.length) console.warn(`[surface-budget] ${warnings.length} surface(s) grew past the warning line. This does not block; record the reason in this week's CHANGLOGS entry.`);
    for (const failure of failures) console.error(`[surface-budget] ${failure}`);
    if (failures.length) throw new Error("surface budget exceeded; reclaim bytes, or rebaseline with --resample and an approved, recorded reason");
  }
} catch (cause) {
  console.error(`[surface-budget] ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
}
}
