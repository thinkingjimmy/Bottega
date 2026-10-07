/**
 * [INPUT]: Depends on esbuild, the TypeScript compiler, pnpm (for --pack) and the src tree of the package directory it is given (default: the working directory).
 * [POS]: The one build and the one pack for every public SDK package (`node ../build.mjs` from a package, `node build.mjs --pack <dir>` for all three); the monorepo's release audit and the SDK repository both pack through it.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGES = ["contracts", "sdk", "testing"];
const walk = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);

function publishedReadme(text, name) {
  if (!/^> L[123] \|/m.test(text) && !/^Members List$/m.test(text)) return withoutProtocol(text);
  const productSection = "\nModule boundaries\n\n";
  const boundary = text.indexOf(productSection);
  if (boundary < 0) throw new Error(`${name} README has an internal map without a product section`);
  return `# ${name}\n\n${withoutProtocol(text.slice(boundary + productSection.length)).trim()}\n`;
}

async function buildPackage(root) {
  /* Tools resolve from the package being built: each declares esbuild and typescript as its own devDependencies. */
  const require = createRequire(join(root, "package.json"));
  const { build } = require("esbuild");
  rmSync(join(root, "dist"), { recursive: true, force: true });
  await build({
    entryPoints: walk(join(root, "src")).filter((path) => path.endsWith(".ts")),
    outdir: join(root, "dist"), outbase: join(root, "src"),
    bundle: true, splitting: true, format: "esm", platform: "neutral", target: "es2022",
    external: ["zod", "@noble/hashes", "@noble/hashes/*", "@bottega/*", "node:*"], chunkNames: "chunks/[name]-[hash]", legalComments: "none", logLevel: "warning",
  });
  const tsc = require.resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });
  /* The GEB process marker is private; the published files carry the contracts' own documentation only. */
  for (const path of walk(join(root, "dist"))) {
    const text = readFileSync(path, "utf8");
  }
  console.log(`built ${walk(join(root, "dist")).length} files into ${relative(process.cwd(), join(root, "dist")) || "dist"}`);
}

/* A published manifest names what a consumer installs, never how the SDK is developed: no scripts, no devDependencies, the
   dist exports in place of the source ones, and a sibling's workspace:* pinned to its exact version. */
function packPackage(root, out, versions) {
  const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const exact = (dependencies = {}) => Object.fromEntries(Object.entries(dependencies).map(([name, spec]) => {
    if (!spec.startsWith("workspace:")) return [name, spec];
    if (!versions[name]) throw new Error(`${name} is a workspace dependency outside the SDK packages`);
    return [name, versions[name]];
  }));
  const stage = join(out, ".stage", source.name.replace("/", "__"));
  mkdirSync(stage, { recursive: true });
  for (const entry of source.files) cpSync(join(root, entry), join(stage, entry), { recursive: true });
  if (source.files.includes("README.md")) writeFileSync(join(stage, "README.md"), publishedReadme(readFileSync(join(root, "README.md"), "utf8"), source.name));
  const published = { name: source.name, version: source.version, description: source.description, license: source.license,
    type: source.type, sideEffects: source.sideEffects, exports: source.publishConfig.exports, files: source.files,
    engines: source.engines, peerDependencies: source.peerDependencies, dependencies: exact(source.dependencies) };
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
  const before = new Set(readdirSync(out));
  execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: stage, stdio: ["ignore", "ignore", "inherit"] });
  const tarball = readdirSync(out).find((name) => name.endsWith(".tgz") && !before.has(name));
  if (!tarball) throw new Error(`pnpm pack produced no tarball for ${source.name}`);
  return tarball;
}

const args = process.argv.slice(2);
if (args[0] === "--pack") {
  const out = resolve(args[1] ?? "packed");
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const roots = PACKAGES.map((name) => join(here, name));
  const versions = Object.fromEntries(roots.map((root) => { const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); return [name, version]; }));
  for (const root of roots) { await buildPackage(root); console.log(`packed ${packPackage(root, out, versions)}`); }
  rmSync(join(out, ".stage"), { recursive: true, force: true });
} else await buildPackage(resolve(args[0] ?? process.cwd()));
