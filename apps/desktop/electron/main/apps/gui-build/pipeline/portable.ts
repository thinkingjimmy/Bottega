/**
 * [INPUT]: Depends on a locally verified compiled-v3 artifact, its immutable source projection, and strict package inspection
 * [OUTPUT]: Provides data-free compiled-source sharing, exact outer/source verification, and receipt-enumerated envelope cleanup before target-machine rebuild
 * [POS]: gui-build/pipeline distribution boundary; foreign runtime/receipt bytes are never exported, adopted, or made Gateway-visible
 */

import { lstat, mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { AppManifest } from "../../../../../shared/apps-ipc";
import type { Sha256Digest } from "../../../../../shared/extensions-ipc";
import { inspectPackage } from "../../share/package-contract";
import { canonicalDigest, canonicalJson, sha256 } from "../metadata";
import { type CompiledV3DigestSet, verifyCompiledV3Artifact } from "./seal";

export const PORTABLE_COMPILED_SOURCE_PATH = ".bottega/compiled-source-v1";

type SourceFile = Readonly<{ path: string; bytes: number; sha256: Sha256Digest }>;
type SourceReceipt = Readonly<{
  schema: "bottega.compiled-source/v1";
  manifestDigest: Sha256Digest;
  sourcePackageDigest: Sha256Digest;
  files: readonly SourceFile[];
}>;

export async function exportPortableCompiledSource(input: Readonly<{
  artifactRoot: string;
  packageRoot: string;
  expected: CompiledV3DigestSet;
}>) {
  await discardPortableCompiledSource(input.packageRoot);
  const verified = await verifyCompiledV3Artifact(input.artifactRoot, input.expected);
  const sourceRoot = join(input.artifactRoot, "source");
  const files = (await inspectFiles(sourceRoot)).filter(
    (file) => file.path !== "data/base.json"
  );
  const targetRoot = join(input.packageRoot, PORTABLE_COMPILED_SOURCE_PATH);
  await mkdir(join(targetRoot, "source"), { recursive: true, mode: 0o700 });
  for (const file of files) {
    const target = join(targetRoot, "source", file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, await readFile(join(sourceRoot, file.path)), {
      mode: 0o400,
      flag: "wx",
    });
  }
  const receipt: SourceReceipt = {
    schema: "bottega.compiled-source/v1",
    manifestDigest: verified.manifestDigest,
    sourcePackageDigest: verified.sourcePackageDigest,
    files,
  };
  await writeFile(
    join(targetRoot, "source-receipt.json"),
    `${canonicalJson(receipt)}\n`,
    { mode: 0o400, flag: "wx" }
  );
  return targetRoot;
}

/**
 * The source envelope is author-controlled portability evidence, not executable
 * provenance. The outer package must contain exactly the same source bytes; a
 * mismatch is rejected instead of being overwritten by either copy.
 */
export async function verifyPortableCompiledSource(
  packageRoot: string,
  manifest: AppManifest
): Promise<Readonly<{ manifestDigest: Sha256Digest; sourcePackageDigest: Sha256Digest }> | null> {
  const portableRoot = join(packageRoot, PORTABLE_COMPILED_SOURCE_PATH);
  if (!(await isDirectory(portableRoot))) return null;
  if (manifest.kind !== "base" || !manifest.gui?.build) {
    throw invalid("portable compiled source requires a compiled Base manifest");
  }
  const receipt = await readReceipt(portableRoot);
  const sourceRoot = join(portableRoot, "source");
  const files = await inspectFiles(sourceRoot);
  if (canonicalJson(files) !== canonicalJson(receipt.files)) {
    throw invalid("portable compiled source file receipt mismatch");
  }
  const sourceManifest = JSON.parse(await readFile(join(sourceRoot, "app.json"), "utf8"));
  if (
    canonicalJson(sourceManifest) !== canonicalJson(manifest) ||
    canonicalDigest(sourceManifest) !== receipt.manifestDigest
  ) {
    throw invalid("portable compiled source manifest differs from the package manifest");
  }
  if (files.some((file) => file.path === "data/base.json")) {
    throw invalid("portable compiled source must not contain Base data");
  }
  const sourcePaths = new Set(files.map((file) => file.path));
  const outer = (await inspectPackage(packageRoot)).files.filter(
    (file) => !file.path.startsWith(".bottega/") && file.path !== "data/base.json"
  );
  if (
    outer.length !== files.length ||
    outer.some((file) => !sourcePaths.has(file.path))
  ) {
    throw invalid("outer package source differs from the immutable compiled source set");
  }
  for (const file of files) {
    const bytes = await readFile(join(packageRoot, file.path));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      throw invalid(`outer package source differs from immutable source: ${file.path}`);
    }
  }
  return {
    manifestDigest: receipt.manifestDigest,
    sourcePackageDigest: receipt.sourcePackageDigest,
  };
}

/** Removes only files enumerated by the validated receipt; unknown content blocks cleanup. */
export async function discardPortableCompiledSource(packageRoot: string) {
  const portableRoot = join(packageRoot, PORTABLE_COMPILED_SOURCE_PATH);
  if (!(await isDirectory(portableRoot))) return;
  const receipt = await readReceipt(portableRoot);
  const directories = new Set<string>();
  for (const file of receipt.files) {
    await unlinkIfExists(join(portableRoot, "source", file.path));
    let directory = dirname(file.path);
    while (directory !== ".") {
      directories.add(directory);
      directory = dirname(directory);
    }
  }
  for (const directory of [...directories].sort((left, right) => depth(right) - depth(left) || compareText(right, left))) {
    await rmdirIfMissing(join(portableRoot, "source", directory));
  }
  await rmdirIfMissing(join(portableRoot, "source"));
  await unlinkIfExists(join(portableRoot, "source-receipt.json"));
  await rmdirIfMissing(portableRoot);
  await rmdir(join(packageRoot, ".bottega")).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOTEMPTY") throw cause;
  });
}

async function unlinkIfExists(path: string) {
  await unlink(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
  });
}

async function rmdirIfMissing(path: string) {
  await rmdir(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
  });
}

async function readReceipt(root: string) {
  return parseReceipt(JSON.parse(await readFile(join(root, "source-receipt.json"), "utf8")));
}

async function inspectFiles(root: string) {
  const files: SourceFile[] = [];
  const visit = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareText(left.name, right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const info = await lstat(path);
      if (!entry.isFile() || !info.isFile() || info.nlink !== 1) {
        throw invalid("portable compiled source contains a non-regular file");
      }
      const bytes = await readFile(path);
      files.push({
        path: relative(root, path).split(sep).join("/"),
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    }
  };
  await visit(root);
  return files.sort((left, right) => compareText(left.path, right.path));
}

function parseReceipt(value: unknown): SourceReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("portable compiled source receipt is invalid");
  const receipt = value as Partial<SourceReceipt>;
  const files = receipt.files;
  if (
    receipt.schema !== "bottega.compiled-source/v1" ||
    !isDigest(receipt.manifestDigest) ||
    !isDigest(receipt.sourcePackageDigest) ||
    !Array.isArray(files) ||
    files.length > 512 ||
    files.some((file) =>
      !file || !safeSourcePath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !isDigest(file.sha256)
    ) ||
    new Set(files.map((file) => file.path)).size !== files.length
  ) throw invalid("portable compiled source receipt is invalid");
  return receipt as SourceReceipt;
}

function safeSourcePath(path: unknown): path is string {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((part) => part && part !== "." && part !== "..");
}

function depth(path: string) { return path.split("/").length; }
function isDirectory(path: string) { return stat(path).then((value) => value.isDirectory(), () => false); }
function isDigest(value: unknown): value is Sha256Digest { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value); }
function compareText(left: string, right: string) { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }
function invalid(message: string) { return Object.assign(new Error(message), { code: "GUI_PORTABLE_SOURCE_INVALID" }); }
