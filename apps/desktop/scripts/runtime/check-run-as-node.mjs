/**
 * [INPUT]: Depends on node:fs/path, the typescript parser and run-as-node-allowlist.json.
 * [OUTPUT]: Provides checkRunAsNode (count, from the TypeScript syntax tree, ELECTRON_RUN_AS_NODE and process.execPath uses in any spelling per production source file under electron/ and shared/, tests and docs excluded, against the allowlist's exact counts; refuse any production source and any built main / runtime / preload file naming the dev runtime cache; with `final`, every entry not marked keep and not scoped to another platform than `platform` is a failure) and a CLI (`--final [--platform=<p>]` for G1, the host platform by default) that exits non-zero on any problem.
 * [POS]: TASK-35 gate G0 (from slice 1, the list only shrinks) and G1 (slice 6, only `keep` entries — uses of process.execPath that are not Node launches — remain before the RunAsNode fuse goes off).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";
import ts from "typescript";
import { resolveOutputRoot } from "../assembly/output-root.mjs";

const ROOTS = ["electron", "shared"];
const TOKEN = "ELECTRON_RUN_AS_NODE";
/* Main never reads the dev runtime cache (doc ruling 2026-09-26): the fetch script writes the dev manifest, and main reads manifests only. */
const CACHE_TOKENS = /BOTTEGA_RUNTIME_CACHE|Bottega Dev Runtime|bottega-dev-runtime/;
const BUILT = ["main", "runtime", "preload"];
const skippedDirectory = name => name === "__tests__" || name === "tests" || name === "node_modules";
/* The constant string value of an expression (literals, no-substitution templates and `+` of those), or undefined. */
function constant(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return constant(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constant(node.left), right = constant(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}
const isProcess = node => ts.isIdentifier(node) && node.text === "process";
const nodeProcessModule = node => ts.isStringLiteral(node) && (node.text === "process" || node.text === "node:process");

/** RunAsNode uses in one source file, by syntax rather than spelling: `process.execPath` however it is read (member, element,
    destructuring, a named import from node:process) and any identifier or constant string equal to ELECTRON_RUN_AS_NODE. */
function countUses(file, text) {
  const kind = /\.[cm]?tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const named = (element, name) => { const key = element.propertyName ?? element.name; return (ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text === name; };
  /* A folded string is counted once, at its outermost constant expression, not again for its parts. */
  const outermost = node => !(ts.isBinaryExpression(node.parent) || ts.isParenthesizedExpression(node.parent)) || constant(node.parent) === undefined;
  let found = 0;
  const visit = node => {
    if (ts.isPropertyAccessExpression(node) && isProcess(node.expression) && node.name.text === "execPath") found++;
    else if (ts.isElementAccessExpression(node) && isProcess(node.expression) && constant(node.argumentExpression) === "execPath") found++;
    else if (ts.isVariableDeclaration(node) && node.initializer && isProcess(node.initializer) && ts.isObjectBindingPattern(node.name)) {
      found += node.name.elements.filter(element => named(element, "execPath")).length;
    } else if (ts.isImportDeclaration(node) && nodeProcessModule(node.moduleSpecifier) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      found += node.importClause.namedBindings.elements.filter(element => named(element, "execPath")).length;
    } else if (ts.isIdentifier(node) && node.text === TOKEN) found++;
    else if (constant(node) === TOKEN && outermost(node)) found++;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}
const scanned = name => /\.(?:[cm]?[jt]sx?)$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name) && !/\.d\.ts$/.test(name);

function uses(root) {
  const counts = {}, cacheReaders = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { if (!skippedDirectory(entry.name)) walk(path); continue; }
      if (!scanned(entry.name)) continue;
      const text = readFileSync(path, "utf8"), file = relative(root, path).split(sep).join("/");
      const found = countUses(file, text);
      if (found) counts[file] = found;
      if (CACHE_TOKENS.test(text)) cacheReaders.push(file);
    }
  };
  for (const name of ROOTS) { try { walk(join(root, name)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  return { counts, cacheReaders };
}

/** Built JavaScript under <outputRoot>/{main,runtime,preload} that names the dev runtime cache. */
function builtCacheReaders(root, outputRoot) {
  const found = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.[cm]?js$/.test(entry.name) && CACHE_TOKENS.test(readFileSync(path, "utf8"))) found.push(relative(root, path).split(sep).join("/"));
    }
  };
  for (const name of BUILT) { try { walk(join(root, outputRoot, name)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  return found;
}

export function checkRunAsNode(root, allowlist, options = {}) {
  /* An entry scoped to one platform (the Windows npm path) only blocks that platform's fuse flip, so G1 must name its target. */
  if (options.final && !options.platform && Object.values(allowlist).some(entry => entry.platform)) throw new Error("--final needs a target platform (--platform=<darwin|win32|linux>)");
  const { counts, cacheReaders } = uses(root), problems = [];
  const built = options.outputRoot ? builtCacheReaders(root, options.outputRoot) : [];
  for (const file of [...cacheReaders, ...built]) problems.push(`${file}: names the dev runtime cache (BOTTEGA_RUNTIME_CACHE); main reads only runtime manifests`);
  for (const [file, found] of Object.entries(counts)) {
    const allowed = allowlist[file];
    if (!allowed) problems.push(`${file}: ${found} RunAsNode / process.execPath use(s), not in the allowlist; launch Node through electron/main/runtime`);
    else if (found > allowed.uses) problems.push(`${file}: ${found} use(s), the allowlist allows ${allowed.uses}; launch Node through electron/main/runtime`);
  }
  for (const [file, allowed] of Object.entries(allowlist)) {
    const found = counts[file] ?? 0;
    if (found < allowed.uses) problems.push(`${file}: the allowlist counts ${allowed.uses}, the source has ${found}; lower it (the list only shrinks)`);
    const elsewhere = allowed.platform && allowed.platform !== options.platform;
    if (options.final && !allowed.keep && !elsewhere && found > 0) problems.push(`${file}: ${allowed.class} is still on RunAsNode; G1 needs it migrated`);
  }
  return { counts, problems };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const desktop = join(import.meta.dirname, "..", "..");
  const allowlist = JSON.parse(readFileSync(join(import.meta.dirname, "run-as-node-allowlist.json"), "utf8")).files;
  const args = process.argv.slice(2);
  const platform = args.find(arg => arg.startsWith("--platform="))?.slice("--platform=".length) ?? process.platform;
  const outputRoot = resolveOutputRoot(args.filter(arg => arg !== "--final" && !arg.startsWith("--platform=")), process.env);
  const { problems } = checkRunAsNode(desktop, allowlist, { final: args.includes("--final"), platform, outputRoot });
  if (problems.length) { console.error(`[run-as-node] ${problems.length} problem(s):\n${problems.join("\n")}`); process.exit(1); }
  console.log(`[run-as-node] ${args.includes("--final") ? `G1 (${platform})` : "G0"} passed`);
}
