/**
 * [INPUT]: Depends on Node descriptor-level filesystem primitives, package inspection, and GUI build budgets
 * [OUTPUT]: Provides the only ancestor-identity/no-follow/no-hardlink immutable App source snapshot implementation, with package-budget rejections typed as GUI_BUILD_SOURCE_FREEZE_UNSAFE
 * [POS]: apps/gui-build/pipeline ingress security boundary; every manifest, validator, compiler, digest, and seal reads its snapshot
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Sha256Digest } from "../../../../../shared/extensions-ipc";
import { inspectPackage } from "../../share/package/package-contract";
import { APP_GUI_BUILD_BUDGET, type AppSourcePreparePort, type SourceFreezeReceipt } from "../contracts";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_WINDOWS_END = /[. ]$/;

export class AppSourcePreparer implements AppSourcePreparePort {
  async freeze(input: Readonly<{
    appId: string;
    liveRoot: string;
    stagingParent: string;
    compiled: boolean;
  }>): Promise<SourceFreezeReceipt> {
    const canonicalLiveRoot = await realpath(input.liveRoot);
    /* 单文件 512 KiB 的权威在 share/package-contract.ts，inspectPackage 判死时抛的
       是无类型 Error，一路裸奔到 renderer 就变成一条没有 code 的构建失败。冻结是
       这条路径上唯一知道「这是 App 源码」的地方，类型化必须在这里补上。 */
    const inspection = await inspectPackage(canonicalLiveRoot).catch((cause) => {
      throw unsafe(cause instanceof Error ? cause.message : String(cause));
    });
    const sourceFiles = inspection.files.filter(
      (file) => !file.path.startsWith(".bottega/")
    );
    validatePortablePaths(sourceFiles.map((file) => file.path));
    if (
      sourceFiles.length > APP_GUI_BUILD_BUDGET.sourceFiles ||
      sourceFiles.reduce((total, file) => total + file.bytes, 0) >
        APP_GUI_BUILD_BUDGET.sourceBytes
    ) {
      throw unsafe("App source exceeds the fixed source budget");
    }

    await mkdir(input.stagingParent, { recursive: true, mode: 0o700 });
    const temporary = join(input.stagingParent, `.source-${input.appId}-${randomUUID()}.tmp`);
    const finalRoot = temporary.replace(/\.tmp$/, "");
    const files: Array<{ path: string; bytes: number; sha256: Sha256Digest }> = [];
    try {
      await mkdir(temporary, { recursive: false, mode: 0o700 });
      for (const file of ordered(sourceFiles)) {
        const from = join(canonicalLiveRoot, file.path);
        const to = join(temporary, file.path);
        await mkdir(dirname(to), { recursive: true, mode: 0o700 });
        const ancestors = await captureDirectoryChain(canonicalLiveRoot, file.path);
        const source = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const before = await source.stat();
          if (!before.isFile() || before.nlink !== 1 || before.size !== file.bytes) {
            throw unsafe(`Unsafe source identity: ${file.path}`);
          }
          await verifyOpenedSource(canonicalLiveRoot, from, before, ancestors, file.path);
          if (input.compiled && (before.mode & 0o111) !== 0) {
            throw unsafe(`Compiled source must not be executable: ${file.path}`);
          }
          const bytes = await source.readFile();
          const after = await source.stat();
          if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            bytes.byteLength !== before.size
          ) {
            throw unsafe(`Source changed while freezing: ${file.path}`);
          }
          await verifyOpenedSource(canonicalLiveRoot, from, after, ancestors, file.path);
          const target = await open(
            to,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o400
          );
          try {
            await target.writeFile(bytes);
            await target.sync();
          } finally {
            await target.close();
          }
          await chmod(to, 0o400);
          files.push({ path: file.path, bytes: bytes.byteLength, sha256: sha256(bytes) });
        } finally {
          await source.close();
        }
      }
      await makeDirectoriesReadOnly(temporary);
      await syncDirectory(temporary);
      await rename(temporary, finalRoot);
      await syncDirectory(input.stagingParent);
      return {
        snapshotRoot: finalRoot,
        sourcePackageDigest: sourceDigest(files),
        files,
      };
    } catch (cause) {
      await makeWritableAndRemove(temporary).catch(() => undefined);
      await makeWritableAndRemove(finalRoot).catch(() => undefined);
      throw cause;
    }
  }

  discard(receipt: SourceFreezeReceipt) {
    return makeWritableAndRemove(receipt.snapshotRoot);
  }
}

type DirectoryIdentity = Readonly<{ path: string; dev: number; ino: number }>;

async function captureDirectoryChain(root: string, filePath: string) {
  const paths = [root];
  let current = root;
  for (const part of dirname(filePath).split("/")) {
    if (part === ".") continue;
    current = join(current, part);
    paths.push(current);
  }
  return Promise.all(paths.map(async (path): Promise<DirectoryIdentity> => {
    const value = await lstat(path);
    if (!value.isDirectory() || value.isSymbolicLink()) {
      throw unsafe(`Source ancestor is not a real directory: ${filePath}`);
    }
    return { path, dev: value.dev, ino: value.ino };
  }));
}

async function verifyOpenedSource(
  root: string,
  path: string,
  opened: Readonly<{ dev: number; ino: number }>,
  expectedAncestors: readonly DirectoryIdentity[],
  filePath: string
) {
  const resolved = await realpath(path);
  const prefix = `${resolve(root)}${sep}`;
  if (!resolved.startsWith(prefix)) throw unsafe(`Source escaped its root: ${filePath}`);
  const current = await stat(resolved);
  if (current.dev !== opened.dev || current.ino !== opened.ino) {
    throw unsafe(`Source path changed during open: ${filePath}`);
  }
  const actual = await captureDirectoryChain(root, filePath);
  if (actual.some((value, index) => {
    const expected = expectedAncestors[index];
    return !expected || value.path !== expected.path || value.dev !== expected.dev || value.ino !== expected.ino;
  })) throw unsafe(`Source ancestor changed while freezing: ${filePath}`);
}

function validatePortablePaths(paths: readonly string[]) {
  const folded = new Map<string, string>();
  const normalized = new Map<string, string>();
  for (const path of paths) {
    if (Buffer.byteLength(path, "utf8") > 1_024) throw unsafe(`Source path is too long: ${path}`);
    const parts = path.split("/");
    for (const part of parts) {
      if (
        Buffer.byteLength(part, "utf8") > 240 ||
        WINDOWS_RESERVED.test(part) ||
        INVALID_WINDOWS_END.test(part) ||
        part.includes(":")
      ) {
        throw unsafe(`Source path is not cross-platform safe: ${path}`);
      }
    }
    const caseKey = path.toLocaleLowerCase("en-US");
    const unicodeKey = path.normalize("NFC");
    if (folded.has(caseKey) && folded.get(caseKey) !== path) {
      throw unsafe(`Case-folding source path collision: ${path}`);
    }
    if (normalized.has(unicodeKey) && normalized.get(unicodeKey) !== path) {
      throw unsafe(`Unicode-normalization source path collision: ${path}`);
    }
    folded.set(caseKey, path);
    normalized.set(unicodeKey, path);
  }
}

function ordered<T extends { path: string }>(files: readonly T[]) {
  return [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function sourceDigest(files: readonly { path: string; bytes: number; sha256: string }[]) {
  const hash = createHash("sha256");
  hash.update("bottega.app-source-freeze/v1\0");
  for (const file of ordered(files)) {
    hash.update(`${Buffer.byteLength(file.path)}:${file.path}:${file.bytes}:${file.sha256}\n`);
  }
  return `sha256:${hash.digest("hex")}` as const;
}

function sha256(bytes: Buffer) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

async function makeDirectoriesReadOnly(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await makeDirectoriesReadOnly(join(root, entry.name));
    await chmod(join(root, entry.name), 0o500);
  }
  await chmod(root, 0o500);
}

async function makeWritableAndRemove(root: string) {
  if (!(await exists(root))) return;
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await makeWritableAndRemove(join(root, entry.name));
  }
  await rm(root, { recursive: true, force: true });
}

async function exists(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
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

function unsafe(message: string) {
  return Object.assign(new Error(message), { code: "GUI_BUILD_SOURCE_FREEZE_UNSAFE" });
}
