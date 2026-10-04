/**
 * [INPUT]: Fixed Sketch snapshot/identity, Rollup module report, emitted compiler and dedicated coverage Worker bytes.
 * [OUTPUT]: Enforces sealed-editor custody, exact on-demand resource identity and the trusted host's separate Worker boundary.
 * [POS]: Renderer structural-budget leaf; numeric byte ceilings remain in check-budgets.mjs and surface-budgets.json.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const SKETCH_HOST_MODULE = "packages/chat-ui/src/plugins/compute-host.ts";
const hostModule = /chat-ui\/src\/plugins\/compute-host\.ts$/;
export const SEALED_SKETCH_MODULES = Object.freeze([
  { pattern: /(?:^|\/)konva(?:@[^/]+)?\//, sample: "node_modules/konva/lib/index.js" },
  { pattern: /(?:^|\/)react-konva(?:@[^/]+)?\//, sample: "node_modules/react-konva/lib/ReactKonva.js" },
  { pattern: /chat-ui\/src\/sketch\/(?:editor|render)\//, sample: "packages/chat-ui/src/sketch/editor/state.ts" },
  { pattern: /chat-ui\/src\/sketch\/model\/history\.ts$/, sample: "packages/chat-ui/src/sketch/model/history.ts" },
  { pattern: /chat-ui\/src\/sketch\/(?:dialog|content|toolbar|color-panel)\.tsx$/, sample: "packages/chat-ui/src/sketch/dialog.tsx" },
  { pattern: /chat-ui\/src\/plugins\/sketch\//, sample: "packages/chat-ui/src/plugins/sketch/entry.tsx" },
  { pattern: /apps\/gui-build\/product-modules\/sketch\/(?:index\.ts|bundle\.json)$/, sample: "electron/main/apps/gui-build/product-modules/sketch/bundle.json" },
  { pattern: /chat-ui\/src\/sketch\/worker\/(?:engine|coverage\.worker)\.ts(?:\?|$)/, sample: "packages/chat-ui/src/sketch/worker/engine.ts" },
]);
function syntaxFacts(source) {
  const ts = createRequire(import.meta.url)("typescript");
  const parsed = ts.createSourceFile("artifact.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw new Error("Sketch build artifact is not valid JavaScript");
  const strings = new Set(), workerReferences = new Set();
  let receives = false, sends = false;
  const property = node => ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
  const named = (node, name) => ts.isIdentifier(node) ? node.text === name : property(node) === name;
  const visit = node => {
    if (ts.isStringLiteralLike(node)) strings.add(node.text);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && property(node.left) === "onmessage") receives = true;
    if (ts.isCallExpression(node) && property(node.expression) === "postMessage") sends = true;
    if (ts.isNewExpression(node) && named(node.expression, "Worker") && node.arguments?.[0]) {
      const urls = new Set(); let localUrl = false;
      const argument = part => {
        if (ts.isStringLiteralLike(part)) urls.add(part.text);
        if (ts.isNewExpression(part) && named(part.expression, "URL")) localUrl = true;
        ts.forEachChild(part, argument);
      };
      argument(node.arguments[0]);
      if (localUrl) for (const url of urls) workerReferences.add(url);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed); return { strings, workerReferences, receives, sends };
}
export const sketchDigest = source => "sha256:" + createHash("sha256").update(source).digest("hex");

export function validateSketchReport(report) {
  const hosts = [];
  for (const chunk of report.chunks ?? []) {
    for (const id of chunk.moduleIds ?? []) {
      if (SEALED_SKETCH_MODULES.some(rule => rule.pattern.test(id))) throw new Error(`Sketch sealed editor or Worker engine entered renderer chunk: ${chunk.fileName} -> ${id}`);
      if (hostModule.test(id)) hosts.push(chunk);
    }
  }
  if (!hosts.length) throw new Error("Sketch trusted compute host is missing from the renderer");
  return hosts;
}

export function validateSketchArtifacts({ snapshot, types, identity, resourceBytes, manifestModule, compiledStrings, workers, hostSources }) {
  if (typeof snapshot?.runtime !== "string" || !snapshot.runtime || typeof snapshot.styles !== "string" || !snapshot.styles || typeof types !== "string" || !types) {
    throw new Error("Sketch official runtime, styles and declarations must all exist");
  }
  const digest = sketchDigest(snapshot.runtime + types + snapshot.styles);
  if (identity?.sourceDigest !== digest) throw new Error("Sketch signed snapshot identity does not match its source bytes");
  if (!resourceBytes || manifestModule?.path !== "modules/sketch.json" || manifestModule.sha256 !== sketchDigest(resourceBytes) || manifestModule.sourceDigest !== digest) throw new Error("Sketch resource differs from its manifest identity");
  const resource = JSON.parse(resourceBytes.toString());
  if (resource.schema !== "bottega.sketch-module/v1" || resource.sourceDigest !== digest || resource.runtime !== snapshot.runtime || resource.styles !== snapshot.styles || resource.types !== types) throw new Error("Sketch resource differs from its signed source snapshot");
  if (!compiledStrings.has(digest) || !compiledStrings.has("modules/sketch.json")) throw new Error("Built GUI compiler does not pin the fixed Sketch resource identity");
  if (compiledStrings.has(snapshot.runtime) || compiledStrings.has(snapshot.styles)) throw new Error("Large Sketch snapshot was embedded into the self-contained compiler");
  if (workers.length !== 1 || !/^coverage\.worker-[\w-]+\.js$/.test(workers[0].name)) throw new Error("Exactly one dedicated Sketch coverage Worker must be emitted");
  const worker = workers[0];
  const workerFacts = syntaxFacts(worker.source);
  if (!worker.source || !workerFacts.receives || !workerFacts.sends) throw new Error("Sketch coverage Worker message protocol is missing");
  if (!hostSources.some(source => syntaxFacts(source).workerReferences.has(worker.name))) {
    throw new Error("Sketch trusted compute host does not construct the emitted dedicated Worker");
  }
}

export function validatePluginArtifacts({ resourceBytes, identity, manifestModule, compiledStrings }) {
  if (!resourceBytes || manifestModule?.path !== "modules/plugin.json" || manifestModule.sha256 !== sketchDigest(resourceBytes)) throw new Error("Plugin SDK resource differs from its manifest identity");
  const resource = JSON.parse(resourceBytes.toString());
  if (resource.schema !== "bottega.plugin-module/v1" || [resource.runtime, resource.types, resource.bootstrap].some(value => typeof value !== "string" || !value)) throw new Error("Plugin SDK resource is incomplete");
  const digest = sketchDigest(resource.runtime + resource.types + resource.bootstrap);
  if (resource.sourceDigest !== digest || identity?.sourceDigest !== digest || manifestModule.sourceDigest !== digest) throw new Error("Plugin SDK resource identity mismatch");
  if (!compiledStrings.has(digest) || !compiledStrings.has("modules/plugin.json")) throw new Error("Built GUI compiler does not pin the plugin SDK resource");
  if (compiledStrings.has(resource.bootstrap)) throw new Error("Plugin bootstrap was embedded into the self-contained compiler");
}

export function verifySketchBuild({ desktopRoot, rendererRoot, outputRoot, report }) {
  const moduleRoot = resolve(desktopRoot, "electron/main/apps/gui-build/product-modules/sketch");
  const snapshot = JSON.parse(readFileSync(resolve(moduleRoot, "bundle.json"), "utf8"));
  const identity = JSON.parse(readFileSync(resolve(moduleRoot, "identity.json"), "utf8"));
  const declaration = readFileSync(resolve(moduleRoot, "index.ts"), "utf8");
  const types = declaration.match(/PLUGIN_SKETCH_TYPES_SOURCE\s*=\s*`([\s\S]*?)`;/)?.[1];
  if (!types || types.includes("\\") || types.includes("${")) throw new Error("Sketch declaration must be an exact literal");
  // Parse cooked string values without executing any emitted compiler or plugin code.
  const compiler = readFileSync(resolve(desktopRoot, outputRoot, "main/app-gui-compiler-entry.js"), "utf8");
  const compiledStrings = syntaxFacts(compiler).strings;
  const metadataRoot = resolve(desktopRoot, "resources/app-gui-toolchain");
  const resourceBytes = readFileSync(resolve(metadataRoot, "modules/sketch.json"));
  const manifestModule = JSON.parse(readFileSync(resolve(metadataRoot, "toolchain-manifest.json"), "utf8")).productModules?.sketch;
  const workers = readdirSync(resolve(rendererRoot, "assets")).filter(name => /^coverage\.worker-.*\.js$/.test(name))
    .map(name => ({ name, source: readFileSync(resolve(rendererRoot, "assets", name), "utf8") }));
  const hostSources = validateSketchReport(report).map(chunk => {
    if (!/^assets\/[\w.-]+\.js$/.test(chunk.fileName)) throw new Error("Sketch host chunk path is invalid");
    return readFileSync(resolve(rendererRoot, chunk.fileName), "utf8");
  });
  validateSketchArtifacts({ snapshot, types, identity, resourceBytes, manifestModule, compiledStrings, workers, hostSources });
  validatePluginArtifacts({ resourceBytes: readFileSync(resolve(metadataRoot, "modules/plugin.json")),
    identity: JSON.parse(readFileSync(resolve(metadataRoot, "modules/plugin-identity.json"), "utf8")),
    manifestModule: JSON.parse(readFileSync(resolve(metadataRoot, "toolchain-manifest.json"), "utf8")).productModules?.plugin, compiledStrings });
}
