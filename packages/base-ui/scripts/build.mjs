/**
 * [INPUT]: Depends on official Base UI source/configuration, external semantic/UI contracts, the workspace lockfile, TypeScript and Vite.
 * [OUTPUT]: Builds and verifies a content-addressed runtime JavaScript/type declaration artifact under an exclusive process lock, including type-only exports; optional watch mode rebuilds it.
 * [POS]: Shared preparation step for Desktop/Web dev, typecheck and build, safe when workspace builds request it concurrently.
 */
import { createHash } from "node:crypto";
import console from "node:console";
import { setTimeout, clearTimeout } from "node:timers";
import { existsSync, watch } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { build } from "vite";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const repository = resolve(root, "../..");
const output = join(root, "dist");
const lock = join(root, "node_modules/.cache/build.lock");
const receipt = join(output, ".build.json");
const inputRoots = [join(root, "src"), join(root, "scripts"), resolve(root, "../base-core/src"),
  resolve(root, "../ui/src"), resolve(root, "../sdk/contracts/src")];
const inputFiles = [join(root, "package.json"), join(root, "tsconfig.json"), join(root, "vite.config.mjs"),
  resolve(root, "../base-core/package.json"), resolve(root, "../ui/package.json"),
  resolve(root, "../sdk/contracts/package.json"), join(repository, "pnpm-lock.yaml")];
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return /^(?:__tests__|tests|test-support|node_modules)$/.test(entry.name) ? [] : files(path);
    return entry.isFile() && !/\.md$|\.(?:test|spec)\.|^\.build\.json$/.test(entry.name) ? [path] : [];
  }));
  return groups.flat().sort();
}
async function digest(paths) {
  const hash = createHash("sha256");
  for (const path of paths.sort()) hash.update(relative(repository, path)).update("\0").update(await readFile(path)).update("\0");
  return hash.digest("hex");
}
async function acquire() {
  await mkdir(dirname(lock), { recursive: true });
  for (const deadline = Date.now() + 180_000; ; await sleep(200)) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, "owner"), String(process.pid));
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number(await readFile(join(lock, "owner"), "utf8").catch(() => ""));
      if (owner > 0) {
        try { process.kill(owner, 0); }
        catch (cause) { if (cause.code === "ESRCH") { await rm(lock, { recursive: true, force: true }); continue; } }
      }
      if (Date.now() > deadline) throw new Error("Base UI build is still owned by another process");
    }
  }
}
async function declarations() {
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options, noEmit: false, declaration: true, emitDeclarationOnly: true,
    declarationMap: false, rootDir: repository, outDir: output,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  const writes = [];
  const result = program.emit(undefined, (_file, text, _bom, _error, sources) => {
    const source = sources?.[0]?.fileName;
    if (!source) return;
    const path = relative(join(root, "src"), source);
    if (path.startsWith("..") || isAbsolute(path)) return;
    const target = join(output, path.replace(/\.tsx?$/, ".d.ts"));
    writes.push(mkdir(dirname(target), { recursive: true }).then(() => writeFile(target, text)));
  }, undefined, true);
  await Promise.all(writes);
  if (result.emitSkipped || result.diagnostics.length) throw new Error("Base UI declaration emit failed");
}
async function prepare() {
  await acquire();
  try {
    const input = await digest([...inputFiles, ...(await Promise.all(inputRoots.map(files))).flat()]);
    const previous = JSON.parse(await readFile(receipt, "utf8").catch(() => "null"));
    if (previous?.input === input && previous.output === await digest(await files(output))) {
      console.log("[base-ui] artifact current");
      return;
    }
    await build({ configFile: join(root, "vite.config.mjs"), root, logLevel: "warn" });
    await declarations();
    const after = await digest([...inputFiles, ...(await Promise.all(inputRoots.map(files))).flat()]);
    if (after !== input) throw new Error("Base UI source changed during compilation; rebuild the artifact");
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    for (const target of Object.values(manifest.exports)) {
      if (!Object.values(target).every(path => existsSync(join(root, path)))) {
        throw new Error("Base UI artifact is missing an exported module or declaration");
      }
    }
    await writeFile(receipt, JSON.stringify({ input, output: await digest(await files(output)) }) + "\n");
    console.log("[base-ui] built JavaScript and declarations");
  } finally { await rm(lock, { recursive: true, force: true }); }
}

await prepare();
if (process.argv.includes("--watch")) {
  let timer;
  let pending = Promise.resolve();
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = pending.then(prepare).catch(error => console.error(error));
    }, 100);
  };
  for (const path of inputRoots) watch(path, { recursive: true }, changed);
  for (const path of inputFiles) watch(path, changed);
  console.log("[base-ui] watching library inputs");
}
