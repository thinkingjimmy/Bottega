/**
 * [INPUT]: An independent Widget source directory, the installed Bottega toolchain and explicit Darwin ARM64 target.
 * [OUTPUT]: Writes one package archive and prints its publication identities as JSON.
 * [POS]: Standalone production packager CLI. Run from an audited Bottega checkout with its frozen dependencies.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const { values } = parseArgs({ options: {
  source: { type: "string" }, output: { type: "string" }, target: { type: "string" },
} });
if (!values.source || !values.output || values.target !== "darwin/arm64") {
  throw new Error("Usage: node config/native/widget-package.mjs --source <directory> --output <archive> --target darwin/arm64");
}
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repo = resolve(desktop, "../..");
const compiled = buildSync({
  absWorkingDir: desktop, entryPoints: ["config/native/widget-packager.ts"], bundle: true,
  write: false, format: "cjs", platform: "node", target: "node24", metafile: true,
  external: ["esbuild", "@tailwindcss/node", "@tailwindcss/oxide"],
  define: { "import.meta.url": JSON.stringify(new URL("../../package.json", import.meta.url).href) },
});
const digest = createHash("sha256");
const sources = [fileURLToPath(import.meta.url), ...Object.keys(compiled.metafile.inputs)
  .map(path => resolve(desktop, path)).filter(path => !path.includes("/node_modules/"))];
for (const path of sources.sort()) {
  const bytes = readFileSync(path);
  digest.update(JSON.stringify([relative(repo, path), bytes.length])).update(bytes);
}
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(
  createRequire(resolve(desktop, "package.json")), module, module.exports,
);
const result = await module.exports.buildWidgetArchive({
  source: resolve(values.source), output: resolve(values.output),
  toolchainSourceDigest: "sha256:" + digest.digest("hex"), lockfile: resolve(repo, "pnpm-lock.yaml"),
});
console.log(JSON.stringify(result));
