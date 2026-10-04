/**
 * [INPUT]: Depends on the closed output-root parser, the shared main-closure walker, Node fs/path/zlib and surface-budgets.json
 * [OUTPUT]: Measures every built surface (reading the build's flavour marker; preload and main gate only a production build, renderer surfaces every build; `--production` and `--resample` refuse anything but a production build) (four renderer entries' eager JS and CSS, three preloads, the main eager closure and each worker/host entry closure) as raw / gzip-9 / brotli-11 bytes plus its count of two-byte (non-Latin-1) chunks, fails when any surface exceeds a ceiling on a metric that gates it (renderer: all; preload and Node: raw and two-byte, their gzip / brotli are informational under `measured`), and with `--resample --reason "<why>"` rewrites the ceilings from a fresh measurement
 * [POS]: The one byte gate for every desktop surface (OPT-30); check-renderer-bundle keeps the lazy boundaries and check-main-bundle keeps the banned-package boundaries, this file owns the numbers
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, sep, isAbsolute } from "node:path";
import console from "node:console";
import process from "node:process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { resolveOutputRoot } from "../assembly/output-root.mjs";
import { eagerClosure } from "../assembly/main-closure.mjs";

const LEDGER = resolve(import.meta.dirname, "surface-budgets.json");
const RENDERER_ENTRIES = ["index", "task-panel", "system-dock-bar", "system-dock-panel"];
const PRELOADS = ["index", "task-panel", "system-dock"];
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
  for (const name of PRELOADS) surfaces[`preload/${name}`] = measureFiles([resolve(base, "preload", `${name}.js`)]);
  const mainRoot = resolve(base, "main");
  for (const entry of NODE_ENTRIES) {
    const file = `${entry}.js`;
    if (!existsSync(resolve(mainRoot, file))) throw new Error(`main entry missing: ${file}`);
    /* The main index is a two-KB doorway whose dynamic edges are startup cost; every other entry follows static edges only. */
    const { chunks } = eagerClosure({ entry: file, read: name => readFileSync(resolve(mainRoot, name), "utf8"), entryFollowsDynamic: entry === "index" });
    surfaces[`main/${entry}`] = measureFiles([...chunks.keys()].map(name => resolve(mainRoot, name)));
  }
  return surfaces;
}

/** Which metrics gate a surface: renderer bytes are also transfer and parse cost; Node bytes are resident source. */
const gatedMetrics = (surface) => surface.startsWith("renderer/") ? ["raw", "gzip", "brotli", "twoByteChunks"] : ["raw", "twoByteChunks"];
/* Node surfaces (preload, main) gate only the build that ships: non-production inputs such as e2e-entry re-split shared chunks. */
const gatesInFlavor = (surface, flavor) => surface.startsWith("renderer/") || flavor === "production";
export const requireProduction = (flavor) => flavor === "production" ? [] : [`the production gate needs a production build; this output was built as ${flavor}`];

export function compare(ledger, measured, flavor = "production") {
  const failures = [];
  for (const surface of Object.keys({ ...ledger.surfaces, ...measured })) {
    const limit = ledger.surfaces[surface], actual = measured[surface];
    if (!limit) { failures.push(`${surface}: measured but has no ceiling in the ledger`); continue; }
    if (!actual) { failures.push(`${surface}: has a ceiling but was not built`); continue; }
    if (!gatesInFlavor(surface, flavor)) continue;
    for (const metric of gatedMetrics(surface)) {
      if (actual[metric] > limit[metric]) failures.push(`${surface} ${metric}: ${actual[metric].toLocaleString("en-US")} > ${limit[metric].toLocaleString("en-US")}`);
    }
  }
  return failures;
}

/* Ceiling = measured + headroom, rounded up, for the metrics that gate the surface only: a Node surface's gzip and brotli are recorded
   under `measured` for information and never written as a ceiling nothing enforces. Two-byte chunk counts get no headroom. */
export function resample(ledger, measured, reason, date) {
  const headroom = ledger.policy.headroom;
  const surfaces = Object.fromEntries(Object.entries(measured).map(([surface, value]) => {
    const gated = gatedMetrics(surface);
    const ceiling = Object.fromEntries(["raw", "gzip", "brotli"].filter(metric => gated.includes(metric)).map(metric => [metric, Math.ceil(value[metric] * (1 + headroom))]));
    return [surface, { ...ceiling, twoByteChunks: value.twoByteChunks, measured: { raw: value.raw, gzip: value.gzip, brotli: value.brotli } }];
  }));
  return { ...ledger, surfaces, history: [...ledger.history, { date, reason }] };
}

function selfTest() {
  const ledger = { policy: { headroom: 0.02 }, history: [], surfaces: {} };
  const one = { raw: 1000, gzip: 400, brotli: 350, twoByteChunks: 1, files: 1 };
  const frozen = resample(ledger, { "renderer/index/js": one, "main/index": one }, "self-test", "2026-01-01");
  if (frozen.surfaces["renderer/index/js"].gzip !== 408) throw new Error("self-test: headroom not applied");
  if (compare(frozen, { "renderer/index/js": one, "main/index": one }).length) throw new Error("self-test: a fresh sample failed its own ceiling");
  const cases = [
    [{ "renderer/index/js": { ...one, gzip: 409 }, "main/index": one }, "renderer gzip over ceiling"],
    [{ "renderer/index/js": one, "main/index": { ...one, raw: 1021 } }, "main raw over ceiling"],
    [{ "renderer/index/js": { ...one, twoByteChunks: 2 }, "main/index": one }, "a new two-byte chunk"],
    [{ "renderer/index/js": one }, "a surface that disappeared"],
    [{ "renderer/index/js": one, "main/index": one, "renderer/new/js": one }, "a surface without a ceiling"],
  ];
  for (const [sample, name] of cases) if (!compare(frozen, sample).length) throw new Error(`self-test: ${name} did not fail`);
  /* gzip and brotli do not gate Node surfaces: they are never transferred. */
  if (compare(frozen, { "renderer/index/js": one, "main/index": { ...one, gzip: 10_000 } }).length) throw new Error("self-test: main gzip gated");
  if ("gzip" in frozen.surfaces["main/index"] || "brotli" in frozen.surfaces["main/index"]) throw new Error("self-test: a Node surface got a compressed ceiling nothing enforces");
  /* Doc ruling 2026-09-26: Node surfaces gate the shipped (production) build only; e2e-entry and other non-production inputs re-split
     shared chunks, so a staging or stable build reports its Node deltas without failing. Renderer surfaces gate every flavour. */
  const overNode = { "renderer/index/js": one, "main/index": { ...one, raw: 5_000 } };
  if (!compare(frozen, overNode, "production").length) throw new Error("self-test: a production Node surface over its ceiling passed");
  if (compare(frozen, overNode, "staging").length) throw new Error("self-test: a staging Node surface failed although it only reports");
  if (!compare(frozen, { "renderer/index/js": { ...one, raw: 5_000 }, "main/index": one }, "staging").length) throw new Error("self-test: a staging renderer surface stopped gating");
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
    const limit = ledger.surfaces[surface];
    console.log(`[surface-budget] ${surface}: ${value.raw.toLocaleString("en-US")} raw / ${value.gzip.toLocaleString("en-US")} gzip / ${value.brotli.toLocaleString("en-US")} br, ${value.twoByteChunks} two-byte of ${value.files}${limit ? ` (ceiling ${gatedMetrics(surface).filter(metric => metric !== "twoByteChunks").map(metric => `${limit[metric].toLocaleString("en-US")} ${metric}`).join(" / ")})` : ""}`);
  }
  if (doResample) {
    if (!reason) throw new Error("--resample needs --reason: every ceiling change is recorded in the ledger history");
    writeFileSync(LEDGER, `${JSON.stringify(resample(ledger, measured, reason, new Date().toISOString().slice(0, 10)), null, 2)}\n`);
    console.log(`[surface-budget] ledger resampled from ${outputRoot}`);
  } else {
    if (flavor !== "production") console.log(`[surface-budget] ${flavor} build: preload and main deltas are reported, not gated (they gate the production build)`);
    const failures = compare(ledger, measured, flavor);
    for (const over of compare(ledger, measured).filter(line => !failures.includes(line))) console.log(`[surface-budget] reported, not gated: ${over}`);
    for (const failure of failures) console.error(`[surface-budget] ${failure}`);
    if (failures.length) throw new Error("surface budget exceeded; reclaim bytes, or resample with a recorded reason after review");
  }
} catch (cause) {
  console.error(`[surface-budget] ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
}
}
