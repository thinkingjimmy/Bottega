/**
 * [INPUT]: Main Chat/workspace authority and an explicit bounded source selection.
 * [OUTPUT]: No-follow immutable source bytes, exact Git/digest versions and a complete omission list.
 * [POS]: Read-only source boundary; source code and repository metadata never become instructions.
 */
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, posix, relative } from "node:path";
import ts from "typescript";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import { sourcePath, DesignDocumentError, designDigest, type DesignAuthority } from "../documents/model";
import type { SystemSource, SystemUnsynced } from "@ai-chat/cloud-protocol/artifacts/design/system/model";

export type CapturedSource = { record: SystemSource; data: Buffer };
export type CapturedSources = { files: CapturedSource[]; unsynced: SystemUnsynced[]; digest: string };
const LIMIT = { files: 52, bytes: 24 * 1024 * 1024, file: 8 * 1024 * 1024, nodes: 256 };
const stamp = (value: Stats) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
const textFile = /\.(?:css|json|[cm]?js|jsx|tsx?|mdx?|svg)$/i;
const allowedFile = /\.(?:css|json|[cm]?js|jsx|tsx?|mdx?|svg|png|jpe?g|webp|gif|woff2?|ttf|otf)$/i;
const toolchainFile = /^(?:package\.json|(?:pnpm|package|yarn|bun).*lock.*|tsconfig.*\.json|AGENTS\.md|CLAUDE\.md|SKILL\.md)$/i;
function boundedGit(workspace: string, args: string[], maxBuffer = 1024) {
  return new Promise<Buffer>((resolve, reject) => execFile("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", workspace, ...args],
    { timeout: 2000, maxBuffer, encoding: "buffer", windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}
async function sourceVersion(workspace: string, path: string, data: Buffer, commit: string | null, repository: string | null) {
  const digest = designDigest(data);
  if (!commit || !repository) return { kind: "digest" as const, digest };
  const name = relative(repository, join(workspace, path)).split("\\").join("/");
  if (!sourcePath.safeParse(name).success) return { kind: "digest" as const, digest };
  const committed = await boundedGit(repository, ["cat-file", "blob", `${commit}:${name}`], LIMIT.file).catch(() => null);
  return { kind: "git" as const, commit, workingTree: !committed || designDigest(committed) !== digest };
}
function localReferences(path: string, data: Buffer) {
  if (!textFile.test(path) || data.length > 2 * 1024 * 1024) return [];
  const text = new TextDecoder("utf-8", { fatal: true }).decode(data), refs: string[] = [];
  if (/\.(?:[cm]?js|jsx|tsx?)$/i.test(path)) {
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) refs.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        const argument = node.arguments[0]; if (argument && ts.isStringLiteral(argument)) refs.push(argument.text);
      }
      ts.forEachChild(node, visit);
    }; visit(ast);
  }
  if (/\.css$/i.test(path)) {
    const ast = postcss.parse(text, { from: path });
    ast.walkAtRules("import", rule => { const value = valueParser(rule.params).nodes[0];
      if (value?.type === "string") refs.push(value.value); });
    ast.walkDecls(declaration => { valueParser(declaration.value).walk(node => {
      if (node.type === "function" && node.value.toLowerCase() === "url") {
        const value = node.nodes[0]; if (value && (value.type === "word" || value.type === "string")) refs.push(value.value);
        return false;
      } return undefined;
    }); });
  }
  if (/\.json$/i.test(path)) {
    const value = JSON.parse(text) as { type?: { fonts?: { file?: unknown }[] }; fonts?: { file?: unknown }[] };
    const fonts = value.type?.fonts ?? value.fonts;
    if (Array.isArray(fonts)) for (const font of fonts) if (font && typeof font.file === "string") refs.push(/^(?:\.|\/|[a-z]+:)/i.test(font.file) ? font.file : "./" + font.file);
  }
  return [...new Set(refs)];
}
export async function captureSystemSources(authority: DesignAuthority, requested: readonly string[], assertAuthority: () => void): Promise<CapturedSources> {
  if (!requested.length || requested.length > 32 || new Set(requested).size !== requested.length) throw new DesignDocumentError("INVALID_DOCUMENT", "Select 1–32 unique source files or directories");
  const workspace = await realpath(authority.workspace), files = new Map<string, { data: Buffer; stamp: string }>(), directories = new Map<string, string>();
  const unsynced: SystemUnsynced[] = []; let bytes = 0, nodes = 0;
  const rememberDirectory = (path: string, metadata: Stats) => {
    const value = stamp(metadata), previous = directories.get(path);
    if (previous && previous !== value) throw new DesignDocumentError("SOURCE_CHANGED", "Source directory changed during capture");
    if (!previous) directories.set(path, value);
  };
  const omit = (path: string, reason: string) => { if (unsynced.length >= 1024) throw new DesignDocumentError("BUDGET_EXCEEDED", "Source omission list exceeds its budget");
    unsynced.push({ path, kind: "source", reason: reason.slice(0, 500) }); };
  const inspectParents = async (path: string) => {
    const parts = path.split("/"); parts.pop(); let current = workspace;
    for (const part of parts) {
      current = join(current, part); const metadata = await lstat(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(current) !== current) throw new DesignDocumentError("PATH_DENIED", "Source directories cannot contain symbolic links");
      rememberDirectory(current, metadata);
    }
  };
  const read = async (path: string, selected = false): Promise<void> => {
    sourcePath.parse(path); if (files.has(path)) return;
    await inspectParents(path); assertAuthority();
    const target = join(workspace, path), before = await lstat(target).catch(() => null);
    if (!before) { if (selected) throw new DesignDocumentError("NOT_READY", `Source is missing: ${path}`); omit(path, "Referenced local file is missing"); return; }
    if (before.isSymbolicLink()) { omit(path, "Symbolic link skipped; no linked bytes were read"); return; }
    if (++nodes > LIMIT.nodes) throw new DesignDocumentError("BUDGET_EXCEEDED", "Selected source tree exceeds its node budget");
    if (before.isDirectory()) {
      if (await realpath(target) !== target) throw new DesignDocumentError("PATH_DENIED", "Source directory authority changed");
      rememberDirectory(target, before);
      for (const child of (await readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        const name = `${path}/${child.name}`;
        if (sourcePath.safeParse(name).success) await read(name);
        else if (!child.name.startsWith(".") && child.name !== "node_modules") throw new DesignDocumentError("PATH_DENIED", `Source path exceeds the document contract: ${name.slice(0, 240)}`);
      } return;
    }
    if (!before.isFile() || await realpath(target) !== target) throw new DesignDocumentError("PATH_DENIED", "Source must be an ordinary local file");
    if (toolchainFile.test(posix.basename(path)) || !allowedFile.test(path)) { omit(path, "Not a token, component, usage or local resource file"); return; }
    if (files.size >= LIMIT.files || before.size > LIMIT.file || bytes + before.size > LIMIT.bytes) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete source capture exceeds its file or byte budget");
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: Buffer;
    try {
      if (stamp(await handle.stat()) !== stamp(before)) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed before capture");
      data = Buffer.alloc(before.size); let offset = 0;
      while (offset < data.length) { const value = await handle.read(data, offset, Math.min(65536, data.length - offset), offset);
        if (!value.bytesRead) throw new DesignDocumentError("SOURCE_CHANGED", "Source was truncated during capture"); offset += value.bytesRead; }
      if (stamp(await handle.stat()) !== stamp(before) || stamp(await lstat(target)) !== stamp(before)) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed during capture");
    } finally { await handle.close(); }
    files.set(path, { data, stamp: stamp(before) }); bytes += data.length;
    let references: string[];
    try { references = localReferences(path, data); } catch { omit(path, "Source syntax or UTF-8 could not be read; original bytes were retained"); return; }
    for (const reference of references) {
      if (/^(?:react|react-dom)(?:\/|$)/.test(reference)) continue;
      if (/^data:/i.test(reference)) continue;
      const fromCss = /\.css$/i.test(path);
      if (!reference.startsWith(".") && !fromCss) { omit(path, `Dependency is outside the locked local runtime: ${reference.slice(0, 200)}`); continue; }
      if (/^(?:[a-z]+:|\/\/|\/)/i.test(reference) || /[?\\]/.test(reference) || Array.from(reference).some(character => character.charCodeAt(0) < 32)) { omit(path, `External or invalid resource was not captured: ${reference.slice(0, 200)}`); continue; }
      const target = posix.normalize(posix.join(posix.dirname(path), reference.split("#")[0]!));
      if (!sourcePath.safeParse(target).success) { omit(path, `Reference leaves the authorized document path contract: ${reference.slice(0, 200)}`); continue; }
      const options = /\.[a-z\d]+$/i.test(target) ? [target] : [target, ...[".tsx", ".ts", ".jsx", ".js", ".css", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"].map(suffix => target + suffix)];
      const found = await Promise.all(options.filter(value => sourcePath.safeParse(value).success).map(async value => ({ value, metadata: await lstat(join(workspace, value)).catch(() => null) })));
      const candidate = found.find(value => value.metadata?.isFile() || value.metadata?.isSymbolicLink());
      if (candidate) await read(candidate.value); else omit(path, `Local dependency is unavailable: ${reference.slice(0, 200)}`);
    }
  };
  for (const path of requested) await read(path, true);
  const repositoryText = await boundedGit(workspace, ["rev-parse", "--show-toplevel"], 4096).catch(() => null);
  const repository = repositoryText ? await realpath(repositoryText.toString("utf8").trim()).catch(() => null) : null;
  const commitText = repository ? await boundedGit(repository, ["rev-parse", "--verify", "HEAD"], 256).catch(() => null) : null;
  const commit = commitText?.toString("utf8").trim(), validCommit = commit && /^[a-f0-9]{40,64}$/.test(commit) ? commit : null;
  const captured: CapturedSource[] = [];
  for (const [path, file] of [...files].sort((a, b) => a[0].localeCompare(b[0], "en"))) {
    const digest = designDigest(file.data), id = "s_" + designDigest(JSON.stringify([path, digest])).slice(7, 31);
    const filename = posix.basename(path).slice(-80), capturedPath = `sources/${id}-${filename}`;
    captured.push({ data: file.data, record: { id, path, capturedPath, digest, bytes: file.data.length,
      version: await sourceVersion(workspace, path, file.data, validCommit, repository) } });
    if (stamp(await lstat(join(workspace, path))) !== file.stamp || await realpath(join(workspace, path)) !== join(workspace, path)) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed before inventory completion");
  }
  for (const [path, previous] of directories) if (stamp(await lstat(path)) !== previous || await realpath(path) !== path) throw new DesignDocumentError("SOURCE_CHANGED", "Source directory changed during inventory capture");
  assertAuthority();
  return { files: captured, unsynced, digest: designDigest(JSON.stringify([captured.map(file => file.record), unsynced])) };
}
