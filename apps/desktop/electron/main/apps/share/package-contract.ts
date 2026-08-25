/**
 * [INPUT]: Depends on Node fs/path/crypto, shared AppManifest and base.json budget; Receiving local app/package directories
 * [OUTPUT]: Provides the only Base release whitelist, kind-aware source/runtime, three projections, three-domain digest, immutable artifact seal/verify/GC; Web only checks the runtime input, and safely retains the internal symlink and execution bit
 * [POS]: The two-way packet of apps/share is compatible with the generation artifact machine; Publish, pre-check, pre-set import with AppStore without self-building whitelist, copy or fingerprint algorithm
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { AppManifest } from "../../../../shared/apps-ipc";

export const PACKAGE_ALLOWLIST = [
  "app.json",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "AGENTS.md",
  "CLAUDE.md",
  ".agents/skills/**",
  "data/base.json",
  "migrations/**",
  "gui/**",
] as const;

// 谓词从常量推导，白名单只此一份——手抄第二份的那天就是静默漂移的那天
const ALLOWED_EXACT = new Set<string>(
  PACKAGE_ALLOWLIST.filter((entry) => !entry.endsWith("/**"))
);
const ALLOWED_PREFIXES = PACKAGE_ALLOWLIST.filter((entry) =>
  entry.endsWith("/**")
).map((entry) => entry.slice(0, -2));

export const PACKAGE_BUDGET = {
  fileBytes: 512 * 1024,
  // base.json 豁免单文件 512KB，但天花板就是包总预算——写更大的数字
  // 只是一个永远打不到的假上限
  baseFileBytes: 16 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  files: 512,
  depth: 6,
} as const;

const RUNTIME_BUDGET = {
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  files: 20_000,
  depth: 16,
} as const;

export type PackageInspection = {
  files: Array<{ path: string; bytes: number }>;
  ignored: string[];
  totalBytes: number;
};

type ProjectionFile =
  | Readonly<{
      path: string;
      bytes: number;
      kind: "file";
      executable: boolean;
    }>
  | Readonly<{
      path: string;
      bytes: number;
      kind: "symlink";
      linkTarget: string;
    }>;

type ProjectionInspection = Omit<PackageInspection, "files"> & {
  files: ProjectionFile[];
};

export type PackageDigestSet = Readonly<{
  manifestDigest: `sha256:${string}`;
  sourcePackageDigest: `sha256:${string}`;
  contentDigest: `sha256:${string}`;
}>;

export type SealedPackageReceipt = PackageDigestSet &
  Readonly<{
    root: string;
    files: ReadonlyArray<{ path: string; bytes: number }>;
  }>;

export function isSafePackagePath(path: string) {
  const parts = path.split("/");
  const hasControlCharacter = Array.from(path).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  return (
    Boolean(path) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !hasControlCharacter &&
    parts.every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function isAllowedPackagePath(path: string) {
  if (!isSafePackagePath(path)) return false;
  return (
    ALLOWED_EXACT.has(path) ||
    ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export async function inspectPackage(root: string): Promise<PackageInspection> {
  return inspectSourcePackage(root, true);
}

/** Base 来源连 ignored 子树中的链接也拒绝；Web 来源只审查真正入选的包路径。 */
async function inspectSourcePackage(
  root: string,
  rejectIgnoredSymlinks: boolean
): Promise<PackageInspection> {
  const canonicalRoot = await realpath(root);
  const files: PackageInspection["files"] = [];
  const ignored: string[] = [];
  let totalBytes = 0;

  const visit = async (directory: string, depth: number) => {
    if (depth > PACKAGE_BUDGET.depth) throw new Error("App 包目录深度超过 6");
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git") continue;
      const absolute = join(directory, entry.name);
      const packagePath = relative(canonicalRoot, absolute).split(sep).join("/");
      if (!isSafePackagePath(packagePath)) {
        throw new Error(`App 包路径无效：${JSON.stringify(packagePath)}`);
      }
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        if (
          rejectIgnoredSymlinks ||
          isAllowedPackagePath(packagePath) ||
          couldContainAllowedPath(packagePath)
        ) {
          throw new Error(`App 包拒绝符号链接：${packagePath}`);
        }
        ignored.push(packagePath);
        continue;
      }
      if (entry.isDirectory()) {
        if (couldContainAllowedPath(packagePath)) {
          await assertContained(canonicalRoot, absolute);
          await visit(absolute, depth + 1);
        } else {
          ignored.push(`${packagePath}/`);
          if (rejectIgnoredSymlinks) {
            await rejectNestedSymlinks(absolute, depth + 1);
          }
        }
        continue;
      }
      if (!entry.isFile()) throw new Error(`App 包仅允许普通文件：${packagePath}`);
      if (!isAllowedPackagePath(packagePath)) {
        ignored.push(packagePath);
        continue;
      }
      await assertContained(canonicalRoot, absolute);
      const limit =
        packagePath === "data/base.json"
          ? PACKAGE_BUDGET.baseFileBytes
          : PACKAGE_BUDGET.fileBytes;
      if (metadata.size > limit) throw new Error(`App 包文件超限：${packagePath}`);
      totalBytes += metadata.size;
      files.push({ path: packagePath, bytes: metadata.size });
      if (
        files.length > PACKAGE_BUDGET.files ||
        totalBytes > PACKAGE_BUDGET.totalBytes
      ) {
        throw new Error("App 包超过 512 文件或 16 MB 总预算");
      }
    }
  };

  await visit(canonicalRoot, 0);
  return { files, ignored, totalBytes };
}

async function rejectNestedSymlinks(
  directory: string,
  depth: number
): Promise<void> {
  if (depth > PACKAGE_BUDGET.depth) throw new Error("App 包目录深度超过 6");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("App 包拒绝符号链接");
    if (entry.isDirectory()) await rejectNestedSymlinks(path, depth + 1);
  }
}

export async function copyPackage(source: string, target: string) {
  const inspection = await inspectPackage(source);
  const canonicalSource = await realpath(source);
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const file of inspection.files) {
    const from = join(canonicalSource, file.path);
    const to = join(target, file.path);
    await assertContained(canonicalSource, from);
    const expected = await lstat(from);
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    const input = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
    const output = await open(
      to,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o400
    );
    try {
      const actual = await input.stat();
      if (
        !actual.isFile() ||
        actual.dev !== expected.dev ||
        actual.ino !== expected.ino
      ) {
        throw new Error(`App 包复制期间文件身份变化：${file.path}`);
      }
      const content = await input.readFile();
      if (content.byteLength !== file.bytes) {
        throw new Error(`App 包复制期间文件变化：${file.path}`);
      }
      await output.writeFile(content);
      await output.sync();
    } finally {
      await Promise.allSettled([input.close(), output.close()]);
    }
    await chmod(to, 0o400);
  }
  return inspection;
}

/**
 * 包内容指纹：路径 + 内容按序哈希，同一份包在任何入口都得到同一个值。
 * 远端预检、分享预览与预设 staging 各写一遍算法，就是三个会各自漂移的「同一个」摘要。
 */
export async function packageDigest(
  root: string,
  files: ReadonlyArray<{ path: string }>
) {
  return (await framedTreeDigest("ai-chat.app-source", 2, root, files)).slice(
    "sha256:".length
  );
}

/**
 * generation v2 的三个身份彼此独立：manifest 证明声明，source 证明完整来源，
 * runtime 则排除只灌注一次的 seed Base。长度帧让路径/内容边界不可伪造；排序按
 * UTF-8 bytes，而不是依赖 locale 的 `localeCompare`。
 */
export async function inspectPackageDigests(
  root: string,
  manifest: AppManifest,
  inspected?: PackageInspection
): Promise<PackageDigestSet> {
  const projections = await inspectProjections(root, manifest, inspected);
  const diskManifest = JSON.parse(await readFile(join(root, "app.json"), "utf8"));
  if (canonicalJson(diskManifest) !== canonicalJson(manifest)) {
    throw new Error("App manifest 与待 seal 的 app.json 不一致");
  }
  return {
    manifestDigest: framedValueDigest("ai-chat.app-manifest", 2, diskManifest),
    sourcePackageDigest: await framedTreeDigest(
      "ai-chat.app-source",
      2,
      root,
      projections.source
    ),
    contentDigest: await framedTreeDigest(
      "ai-chat.app-runtime",
      2,
      root,
      projections.runtime.files
    ),
  };
}

/**
 * 复制、复验、fsync、只读化、原子 rename 后才签发 receipt。调用者只能把
 * receipt 封进 generation，不能拿 workspace 路径冒充 active bytes。
 */
export async function sealPackageArtifact(input: {
  source: string;
  finalRoot: string;
  manifest: AppManifest;
  expected?: PackageDigestSet;
}): Promise<SealedPackageReceipt> {
  const projections = await inspectProjections(input.source, input.manifest);
  const expected =
    input.expected ??
    (await inspectPackageDigests(input.source, input.manifest));
  const files = projections.runtime.files;
  await mkdir(dirname(input.finalRoot), { recursive: true, mode: 0o700 });

  if (await isDirectory(input.finalRoot)) {
    const actual = await inspectSealedDigests(input.finalRoot, input.manifest);
    assertDigests(actual, expected);
    return { ...actual, root: join(input.finalRoot, "runtime"), files };
  }

  const temporary = join(
    dirname(input.finalRoot),
    `.${basename(input.finalRoot)}.tmp-${randomUUID()}`
  );
  try {
    await mkdir(temporary, { recursive: false, mode: 0o700 });
    await copyProjection(input.source, join(temporary, "source"), projections.source);
    await copyProjection(input.source, join(temporary, "runtime"), files);
    const actual = await inspectSealedDigests(temporary, input.manifest);
    assertDigests(actual, expected);
    await makeTreeReadOnly(temporary);
    await syncDirectory(temporary);
    await rename(temporary, input.finalRoot);
    await syncDirectory(dirname(input.finalRoot));
    return {
      ...actual,
      root: join(input.finalRoot, "runtime"),
      files: files.map(({ path, bytes }) => ({ path, bytes })),
    };
  } catch (cause) {
    await removePackageArtifact(temporary).catch(() => {});
    throw cause;
  }
}

export async function verifyPackageArtifact(input: {
  root: string;
  manifest: AppManifest;
  expected: PackageDigestSet;
}) {
  const actual = await inspectSealedDigests(input.root, input.manifest);
  assertDigests(actual, input.expected);
  return actual;
}

/** 只读化不能把 GC 变成永久失败；先恢复私有目录写位，再删除已 rename 的 trash。 */
export async function removePackageArtifact(root: string) {
  await makeTreeWritable(root).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
  });
  await rm(root, { recursive: true, force: true });
}

async function inspectSealedDigests(root: string, manifest: AppManifest) {
  const sourceRoot = join(root, "source");
  const runtimeRoot = join(root, "runtime");
  const [source, runtimeInspection] = await Promise.all([
    inspectProjections(sourceRoot, manifest),
    inspectRuntime(runtimeRoot, manifest),
  ]);
  const diskManifest = JSON.parse(
    await readFile(join(runtimeRoot, "app.json"), "utf8")
  );
  if (canonicalJson(diskManifest) !== canonicalJson(manifest)) {
    throw new Error("sealed runtime manifest 与 generation 不一致");
  }
  return {
    manifestDigest: framedValueDigest("ai-chat.app-manifest", 2, diskManifest),
    sourcePackageDigest: await framedTreeDigest(
      "ai-chat.app-source",
      2,
      sourceRoot,
      source.source
    ),
    contentDigest: await framedTreeDigest(
      "ai-chat.app-runtime",
      2,
      runtimeRoot,
      runtimeInspection.files
    ),
  };
}

async function inspectProjections(
  root: string,
  manifest: AppManifest,
  inspected?: PackageInspection
) {
  const packageInspection =
    inspected ??
    (await inspectSourcePackage(root, manifest.kind === "base"));
  const packageFiles = await projectRegularFiles(root, packageInspection.files);
  const runtime = await inspectRuntime(root, manifest, packageFiles);
  return {
    source: sourceProjection(packageFiles, runtime.files),
    runtime,
  };
}

async function inspectRuntime(
  root: string,
  manifest: AppManifest,
  packageFiles?: readonly ProjectionFile[]
): Promise<ProjectionInspection> {
  if (manifest.kind === "base") {
    const inspection = packageFiles
      ? null
      : await inspectPackage(root);
    const projected =
      packageFiles ?? (await projectRegularFiles(root, inspection!.files));
    const files = projected.filter(
      (file) => file.path !== "data/base.json"
    );
    return {
      files,
      ignored: inspection?.ignored ?? [],
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    };
  }

  const canonicalRoot = await realpath(root);
  const files: ProjectionFile[] = [];
  const ignored: string[] = [];
  let totalBytes = 0;
  const declaredStaticRoot =
    manifest.kind === "static" ? manifest.staticDir.replace(/\/$/, "") : null;
  const staticRoot = declaredStaticRoot === "." ? "" : declaredStaticRoot;
  const staticPrefix = staticRoot ? `${staticRoot}/` : "";

  const include = (path: string) =>
    path === "app.json" ||
    (manifest.kind === "static"
      ? staticRoot === "" || path.startsWith(staticPrefix)
      : !path.startsWith(".git/") &&
        path !== ".git" &&
        !path.startsWith("data/") &&
        path !== "data");
  const couldInclude = (path: string) =>
    manifest.kind === "server"
      ? include(path)
      : staticRoot === "" ||
        path === staticRoot ||
        path.startsWith(staticPrefix) ||
        staticPrefix.startsWith(`${path}/`);

  const visit = async (directory: string, depth: number) => {
    if (depth > RUNTIME_BUDGET.depth) {
      throw new Error("App runtime 目录深度超过 16");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      Buffer.compare(Buffer.from(left.name), Buffer.from(right.name))
    )) {
      const absolute = join(directory, entry.name);
      const path = relative(canonicalRoot, absolute).split(sep).join("/");
      if (!isSafePackagePath(path)) throw new Error(`App runtime 路径无效：${path}`);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        if (include(path) || couldInclude(path)) {
          const linkTarget = await readlink(absolute);
          const canonicalTarget = await assertSafeRuntimeLink(
            canonicalRoot,
            absolute,
            linkTarget
          );
          const targetPath = relative(canonicalRoot, canonicalTarget)
            .split(sep)
            .join("/");
          if (!include(targetPath)) {
            throw new Error(`App runtime 链接目标未纳入投影：${path}`);
          }
          const bytes = Buffer.byteLength(linkTarget, "utf8");
          totalBytes += bytes;
          files.push({ path, bytes, kind: "symlink", linkTarget });
          assertRuntimeBudget(files.length, totalBytes);
        } else {
          ignored.push(path);
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (couldInclude(path)) {
          await assertContained(canonicalRoot, absolute);
          await visit(absolute, depth + 1);
        } else {
          ignored.push(`${path}/`);
        }
        continue;
      }
      if (!entry.isFile()) throw new Error(`App runtime 仅允许普通文件：${path}`);
      if (!include(path)) {
        ignored.push(path);
        continue;
      }
      await assertContained(canonicalRoot, absolute);
      if (metadata.size > RUNTIME_BUDGET.fileBytes) {
        throw new Error(`App runtime 文件超限：${path}`);
      }
      totalBytes += metadata.size;
      files.push({
        path,
        bytes: metadata.size,
        kind: "file",
        executable: (metadata.mode & 0o111) !== 0,
      });
      assertRuntimeBudget(files.length, totalBytes);
    }
  };

  await visit(canonicalRoot, 0);
  if (!files.some((file) => file.path === "app.json")) {
    throw new Error("App runtime 缺少 app.json");
  }
  return { files, ignored, totalBytes };
}

async function projectRegularFiles(
  root: string,
  files: ReadonlyArray<{ path: string; bytes: number }>
): Promise<ProjectionFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const metadata = await lstat(join(root, file.path));
      if (!metadata.isFile()) {
        throw new Error(`App 包仅允许普通文件：${file.path}`);
      }
      return {
        ...file,
        kind: "file" as const,
        executable: (metadata.mode & 0o111) !== 0,
      };
    })
  );
}

function assertRuntimeBudget(files: number, totalBytes: number) {
  if (files > RUNTIME_BUDGET.files || totalBytes > RUNTIME_BUDGET.totalBytes) {
    throw new Error("App runtime 超过 20000 文件或 512 MB 总预算");
  }
}

function sourceProjection<T extends { path: string }>(
  packageFiles: readonly T[],
  runtimeFiles: readonly T[]
) {
  const byPath = new Map<string, T>();
  for (const file of [...packageFiles, ...runtimeFiles]) byPath.set(file.path, file);
  return [...byPath.values()];
}

function framedValueDigest(domain: string, version: number, value: unknown) {
  const hash = createHash("sha256");
  frame(hash, Buffer.from(domain, "utf8"));
  frame(hash, Buffer.from(String(version), "ascii"));
  frame(hash, Buffer.from(canonicalJson(value), "utf8"));
  return `sha256:${hash.digest("hex")}` as const;
}

async function framedTreeDigest(
  domain: string,
  version: number,
  root: string,
  files: ReadonlyArray<{
    path: string;
    kind?: "file" | "symlink";
    executable?: boolean;
    linkTarget?: string;
  }>
) {
  const hash = createHash("sha256");
  frame(hash, Buffer.from(domain, "utf8"));
  frame(hash, Buffer.from(String(version), "ascii"));
  const ordered = [...files].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"))
  );
  for (const file of ordered) {
    frame(hash, Buffer.from(file.path, "utf8"));
    frame(hash, Buffer.from(file.kind ?? "file", "ascii"));
    if (file.kind === "symlink") {
      frame(hash, Buffer.from(file.linkTarget ?? "", "utf8"));
    } else {
      frame(hash, Buffer.from(file.executable ? "x" : "-", "ascii"));
      frame(hash, await readFile(join(root, file.path)));
    }
  }
  return `sha256:${hash.digest("hex")}` as const;
}

function frame(hash: ReturnType<typeof createHash>, bytes: Buffer) {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    entries.sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function copyProjection(
  source: string,
  target: string,
  files: readonly ProjectionFile[]
) {
  const canonicalSource = await realpath(source);
  for (const file of files) {
    const from = join(canonicalSource, file.path);
    const to = join(target, file.path);
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    if (file.kind === "symlink") {
      const metadata = await lstat(from);
      const linkTarget = await readlink(from);
      if (!metadata.isSymbolicLink() || linkTarget !== file.linkTarget) {
        throw new Error(`App runtime seal 期间链接变化：${file.path}`);
      }
      await assertSafeRuntimeLink(canonicalSource, from, linkTarget);
      await symlink(linkTarget, to);
      continue;
    }
    const expected = await lstat(from);
    const input = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
    const output = await open(
      to,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      file.executable ? 0o500 : 0o400
    );
    try {
      const actual = await input.stat();
      if (
        !actual.isFile() ||
        actual.dev !== expected.dev ||
        actual.ino !== expected.ino ||
        actual.size !== file.bytes
      ) {
        throw new Error(`App runtime seal 期间文件变化：${file.path}`);
      }
      await output.writeFile(await input.readFile());
      await output.sync();
    } finally {
      await Promise.allSettled([input.close(), output.close()]);
    }
    await chmod(to, file.executable ? 0o500 : 0o400);
  }
}

async function makeTreeReadOnly(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(root, entry.name);
    await makeTreeReadOnly(child);
    await chmod(child, 0o500);
  }
  await chmod(root, 0o500);
}

async function makeTreeWritable(root: string): Promise<void> {
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await makeTreeWritable(join(root, entry.name));
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
  try {
    return (await stat(path)).isDirectory();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

function assertDigests(actual: PackageDigestSet, expected: PackageDigestSet) {
  if (
    actual.manifestDigest !== expected.manifestDigest ||
    actual.sourcePackageDigest !== expected.sourcePackageDigest ||
    actual.contentDigest !== expected.contentDigest
  ) {
    throw new Error("App generation artifact digest 不匹配");
  }
}

/** 目录是否可能容纳白名单条目：同样从 PACKAGE_ALLOWLIST 推导，不第三次手抄。 */
function couldContainAllowedPath(path: string) {
  const dir = `${path}/`;
  return PACKAGE_ALLOWLIST.some((entry) => {
    const prefix = entry.endsWith("/**") ? entry.slice(0, -2) : entry;
    return (
      prefix.startsWith(dir) ||
      (entry.endsWith("/**") && dir.startsWith(prefix))
    );
  });
}

async function assertContained(root: string, path: string) {
  const canonical = await realpath(path);
  if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) {
    throw new Error("App 包路径逃逸");
  }
}

async function assertSafeRuntimeLink(
  root: string,
  path: string,
  linkTarget: string
) {
  if (isAbsolute(linkTarget)) {
    throw new Error(`App runtime 链接必须使用相对目标：${relative(root, path)}`);
  }
  const lexicalTarget = resolve(dirname(path), linkTarget);
  if (lexicalTarget !== root && !lexicalTarget.startsWith(`${root}${sep}`)) {
    throw new Error(`App runtime 链接逃逸：${relative(root, path)}`);
  }
  const canonicalTarget = await realpath(path);
  if (
    canonicalTarget !== root &&
    !canonicalTarget.startsWith(`${root}${sep}`)
  ) {
    throw new Error(`App runtime 链接逃逸：${relative(root, path)}`);
  }
  return canonicalTarget;
}
