/**
 * [INPUT]: Maintained host/page source, exact installed D3/esbuild and shared native comment/transport modules.
 * [OUTPUT]: Isolated browser assets, complete dependency notices and deterministic input/output identities.
 * [POS]: Dashboard runtime build owner; authored pages are never build inputs or host programs.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url))), require = createRequire(join(root, "package.json"));
const { build } = require("esbuild"), sha = bytes => createHash("sha256").update(bytes).digest("hex"), output = join(root, "dist");
rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
const results = [];
for (const name of ["host", "page"]) results.push(await build({ entryPoints: [join(root, "src", name + ".ts")], outfile: join(output, name === "host" ? "runtime.js" : "page.js"), absWorkingDir: root, bundle: true, format: "iife", platform: "browser", target: "es2022", minify: true, legalComments: "inline", metafile: true, logLevel: "error" }));
const d3Entry = require.resolve("d3"), d3Root = resolve(dirname(d3Entry), ".."), d3Package = JSON.parse(readFileSync(join(d3Root, "package.json")));
if (d3Package.version !== "7.9.0") throw new Error("The fixed Dashboard D3 version changed");
const d3Build = await build({ stdin: { contents: 'import * as d3 from "d3";Object.defineProperty(globalThis,"d3",{value:d3});', resolveDir: root }, outfile: join(output, "d3.js"), absWorkingDir: root, bundle: true, format: "iife", platform: "browser", target: "es2022", minify: true, legalComments: "inline", metafile: true, logLevel: "error" }); results.push(d3Build);
writeFileSync(join(output, "runtime.css"), readFileSync(join(root, "src/style.css")));
writeFileSync(join(output, "page.css"), Buffer.concat([readFileSync(join(root, "src/page.css")), readFileSync(resolve(root, "../ui/src/styles/chart-palette.css"))]));
writeFileSync(join(output, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="runtime.css"></head><body><div id="root"></div><script type="module" src="runtime.js"></script></body></html>');
const inputs = [...new Set(results.flatMap(result => Object.keys(result.metafile.inputs)).filter(path => path !== "<stdin>").map(path => resolve(root, path)))].sort();
const packages = new Set([d3Root]);
for (const file of inputs) { let folder = dirname(file); while (folder !== dirname(folder)) { if (existsSync(join(folder, "package.json"))) { packages.add(folder); break; } folder = dirname(folder); } }
let notices = readFileSync(join(root, "LICENSE"), "utf8") + "\nLucide SVG controls:\n" + readFileSync(resolve(root, "../canvas-runtime/licenses/lucide-ISC.txt"), "utf8");
for (const folder of [...packages].sort()) {
  const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  const licenses = readdirSync(folder).filter(name => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(name));
  if (!licenses.length && folder.includes("node_modules")) throw new Error("A bundled Dashboard dependency has no license: " + pkg.name);
  for (const name of licenses) notices += "\n\n" + pkg.name + " " + pkg.version + " / " + name + "\n" + readFileSync(join(folder, name), "utf8");
}
writeFileSync(join(output, "third-party-licenses.txt"), notices);
const outputs = readdirSync(output).sort().map(path => { const bytes = readFileSync(join(output, path)); return { path, bytes: bytes.length, sha256: sha(bytes) }; });
const own = ["package.json", "LICENSE", "build/index.mjs", "src/style.css", "src/page.css", "../ui/src/styles/chart-palette.css", "../canvas-runtime/licenses/lucide-ISC.txt", "../../pnpm-lock.yaml"].map(path => resolve(root, path));
writeFileSync(join(output, "build.json"), JSON.stringify({ format: "bottega-dashboard-runtime/v1", reference: "6759e358eb88d83986c753b0fc60c84e4aabdb3a", d3: "7.9.0", inputs: [...new Set([...inputs, ...own])].sort().map(path => ({ path: relative(root, path).replaceAll("\\", "/"), sha256: sha(readFileSync(path)) })), outputs }, null, 2) + "\n");
