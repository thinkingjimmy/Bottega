/**
 * [INPUT]: Depends on one immutable source freeze receipt, one validated compiler runtime, canonical build receipt bytes, and a generation-owned final root
 * [OUTPUT]: Provides atomic local compiled-v3 source/runtime/metadata sealing and four-digest startup verification
 * [POS]: apps/gui-build/pipeline content-layout-v3 custody boundary; Gateway receives only runtime/gui while source and receipt remain unreachable metadata
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { AppGuiBuildReceipt, AppManifest } from "../../../../../shared/apps-ipc";
import type { Sha256Digest } from "../../../../../shared/extensions-ipc";
import type { SourceFreezeReceipt } from "../contracts";
import { canonicalDigest, canonicalJson, sha256 } from "../metadata";

export type CompiledV3DigestSet = Readonly<{
  manifestDigest: Sha256Digest;
  sourcePackageDigest: Sha256Digest;
  contentDigest: Sha256Digest;
  buildReceiptDigest: Sha256Digest;
}>;

export type CompiledV3SealInput = Readonly<{
  source: SourceFreezeReceipt;
  compilerRuntimeRoot: string;
  finalRoot: string;
  manifest: AppManifest;
  receipt: AppGuiBuildReceipt;
  buildReceiptDigest: Sha256Digest;
}>;

export async function sealCompiledV3Artifact(input: CompiledV3SealInput) {
  await assertPrepared(input);
  await mkdir(dirname(input.finalRoot), { recursive: true, mode: 0o700 });
  if (await isDirectory(input.finalRoot)) {
    const verified = await verifyCompiledV3Artifact(input.finalRoot, expected(input));
    return { ...verified, root: join(input.finalRoot, "runtime") };
  }
  const temporary = join(dirname(input.finalRoot), `.${basename(input.finalRoot)}.compiled-${randomUUID()}`);
  try {
    await mkdir(temporary, { recursive: false, mode: 0o700 });
    await copySourceProjection(input.source, join(temporary, "source"));
    await copyRuntimeProjection(input.source, input.compilerRuntimeRoot, join(temporary, "runtime"));
    const metadataRoot = join(temporary, "metadata");
    await mkdir(metadataRoot, { recursive: true, mode: 0o700 });
    await writeSynced(join(metadataRoot, "gui-build-receipt.json"), Buffer.from(`${canonicalJson(input.receipt)}\n`, "utf8"));
    const verified = await verifyCompiledV3Artifact(temporary, expected(input));
    await makeTreeReadOnly(temporary);
    await syncDirectory(temporary);
    await rename(temporary, input.finalRoot);
    await syncDirectory(dirname(input.finalRoot));
    return { ...verified, root: join(input.finalRoot, "runtime") };
  } catch (cause) {
    await makeTreeWritable(temporary).catch(() => undefined);
    await rm(temporary, { recursive: true, force: true });
    throw cause;
  }
}

export async function verifyCompiledV3Artifact(
  root: string,
  expectedDigests?: CompiledV3DigestSet
) {
  const sourceRoot = join(root, "source");
  const runtimeRoot = join(root, "runtime");
  const receiptPath = join(root, "metadata/gui-build-receipt.json");
  const receipt = parseReceipt(await readFile(receiptPath, "utf8"));
  const sourceFiles = await walk(sourceRoot);
  const runtimeGuiFiles = await walk(join(runtimeRoot, "gui"));
  const runtimeFiles = await walk(runtimeRoot);
  const manifest = JSON.parse(await readFile(join(runtimeRoot, "app.json"), "utf8")) as AppManifest;
  const actual: CompiledV3DigestSet = {
    manifestDigest: canonicalDigest(manifest),
    sourcePackageDigest: sourceDigest(sourceFiles),
    contentDigest: contentDigest(sourceFiles, runtimeGuiFiles),
    buildReceiptDigest: canonicalDigest(receipt),
  };
  assertDigestSet(actual, expectedDigests ?? expectedFromReceipt(receipt));
  if (
    receipt.manifestDigest !== actual.manifestDigest ||
    receipt.sourcePackageDigest !== actual.sourcePackageDigest ||
    receipt.contentDigest !== actual.contentDigest ||
    receipt.sourceGuiDigest !== treeDigest("bottega.app-gui-source/v1", sourceFiles.filter((file) => file.path.startsWith("gui/"))) ||
    receipt.runtimeGuiDigest !== treeDigest("bottega.app-gui-runtime/v1", runtimeGuiFiles) ||
    canonicalJson(receipt.files) !== canonicalJson(runtimeGuiFiles)
  ) {
    throw invalid("compiled-v3 receipt does not describe the sealed source/runtime bytes");
  }
  const allowedRuntime = new Set([
    ...sourceFiles.filter((file) => file.path !== "data/base.json" && !file.path.startsWith("gui/")).map((file) => file.path),
    ...runtimeGuiFiles.map((file) => `gui/${file.path}`),
  ]);
  if (runtimeFiles.some((file) => !allowedRuntime.has(file.path))) {
    throw invalid("compiled-v3 runtime contains a non-projected file");
  }
  return { ...actual, receipt };
}

async function assertPrepared(input: CompiledV3SealInput) {
  if (input.manifest.kind !== "base" || !input.manifest.gui?.build) {
    throw invalid("compiled-v3 seal requires a compiled Base manifest");
  }
  if (input.source.sourcePackageDigest !== input.receipt.sourcePackageDigest) {
    throw invalid("source freeze and compiler receipt identities differ");
  }
  if (canonicalDigest(input.receipt) !== input.buildReceiptDigest) {
    throw invalid("buildReceiptDigest does not cover canonical receipt bytes");
  }
  const diskManifest = JSON.parse(await readFile(join(input.source.snapshotRoot, "app.json"), "utf8"));
  if (canonicalJson(diskManifest) !== canonicalJson(input.manifest)) {
    throw invalid("source snapshot manifest differs from the generation manifest");
  }
}

async function copySourceProjection(receipt: SourceFreezeReceipt, targetRoot: string) {
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  for (const file of ordered(receipt.files)) {
    const bytes = await readFile(join(receipt.snapshotRoot, file.path));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      throw invalid(`immutable source changed before seal: ${file.path}`);
    }
    await writeSynced(join(targetRoot, file.path), bytes);
  }
}

async function copyRuntimeProjection(
  source: SourceFreezeReceipt,
  compilerRuntimeRoot: string,
  targetRoot: string
) {
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  for (const file of ordered(source.files)) {
    if (file.path === "data/base.json" || file.path.startsWith("gui/")) continue;
    await writeSynced(join(targetRoot, file.path), await readFile(join(source.snapshotRoot, file.path)));
  }
  for (const file of await walk(compilerRuntimeRoot)) {
    if (!file.path.startsWith("gui/")) throw invalid(`compiler runtime escaped gui/: ${file.path}`);
    const bytes = await readFile(join(compilerRuntimeRoot, file.path));
    if (sha256(bytes) !== file.sha256) throw invalid(`compiler runtime changed before seal: ${file.path}`);
    await writeSynced(join(targetRoot, file.path), bytes);
  }
}

async function writeSynced(path: string, bytes: Buffer) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function walk(root: string) {
  const files: Array<{ path: string; bytes: number; sha256: Sha256Digest }> = [];
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        files.push({ path: relative(root, path).split(sep).join("/"), bytes: bytes.byteLength, sha256: sha256(bytes) });
      } else {
        throw invalid("compiled-v3 projections allow only regular files and directories");
      }
    }
  };
  await visit(root);
  return files;
}

function sourceDigest(files: readonly { path: string; bytes: number; sha256: string }[]) {
  const hash = createHash("sha256");
  hash.update("bottega.app-source-freeze/v1\0");
  for (const file of ordered(files)) {
    hash.update(`${Buffer.byteLength(file.path)}:${file.path}:${file.bytes}:${file.sha256}\n`);
  }
  return `sha256:${hash.digest("hex")}` as const;
}

function contentDigest(
  sourceFiles: readonly { path: string; bytes: number; sha256: Sha256Digest }[],
  runtimeGuiFiles: readonly { path: string; bytes: number; sha256: Sha256Digest }[]
) {
  const retained = sourceFiles.filter((file) => file.path !== "data/base.json" && !file.path.startsWith("gui/"));
  const gui = runtimeGuiFiles.map((file) => ({ ...file, path: `gui/${file.path}` }));
  return treeDigest("bottega.app-runtime/v3", [...retained, ...gui]);
}

function treeDigest(domain: string, files: readonly { path: string; bytes: number; sha256: Sha256Digest }[]) {
  return canonicalDigest({ domain, files: ordered(files) });
}

function ordered<T extends { path: string }>(files: readonly T[]) {
  return [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function parseReceipt(value: string): AppGuiBuildReceipt {
  const receipt = JSON.parse(value) as AppGuiBuildReceipt;
  if (
    !receipt ||
    receipt.preset !== "bottega-react-v1" ||
    receipt.compatibility?.kind !== "compiled-v3" ||
    !Array.isArray(receipt.files)
  ) {
    throw invalid("compiled-v3 receipt schema is invalid");
  }
  return receipt;
}

function expected(input: CompiledV3SealInput): CompiledV3DigestSet {
  return {
    manifestDigest: input.receipt.manifestDigest,
    sourcePackageDigest: input.receipt.sourcePackageDigest,
    contentDigest: input.receipt.contentDigest,
    buildReceiptDigest: input.buildReceiptDigest,
  };
}

/* 自洽检查，不是权威：没有外部 expected 时，buildReceiptDigest 只能由 receipt
   自身算出，这条比较必然成立。真正的权威是调用方传进来的那一组摘要。 */
function expectedFromReceipt(receipt: AppGuiBuildReceipt): CompiledV3DigestSet {
  return {
    manifestDigest: receipt.manifestDigest,
    sourcePackageDigest: receipt.sourcePackageDigest,
    contentDigest: receipt.contentDigest,
    buildReceiptDigest: canonicalDigest(receipt),
  };
}

function assertDigestSet(actual: CompiledV3DigestSet, expectedDigests: CompiledV3DigestSet) {
  for (const key of Object.keys(actual) as Array<keyof CompiledV3DigestSet>) {
    if (actual[key] !== expectedDigests[key]) throw invalid(`compiled-v3 ${key} mismatch`);
  }
}

async function makeTreeReadOnly(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeTreeReadOnly(path);
    else await chmod(path, 0o400);
  }
  await chmod(root, 0o500);
}

async function makeTreeWritable(root: string): Promise<void> {
  if (!(await isDirectory(root))) return;
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await makeTreeWritable(join(root, entry.name));
  }
}

async function syncDirectory(path: string) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function isDirectory(path: string) {
  return stat(path).then((value) => value.isDirectory(), () => false);
}

function invalid(message: string) {
  return Object.assign(new Error(message), { code: "GUI_BUILD_RECEIPT_INVALID" });
}
