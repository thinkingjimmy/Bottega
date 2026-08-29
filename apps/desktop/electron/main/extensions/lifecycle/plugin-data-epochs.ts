/**
 * [INPUT]: Depends on Node fs/path, strict Extension digest identity validation, and canonical ProductResourceScope
 * [OUTPUT]: Provides contained install-owned owner receipts, completion-marked atomic epoch snapshots, writer gates, exact-scope enumeration, and explicit purge
 * [POS]: Retained Extension data authority; owner.json survives Registry package removal and never contains secrets
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertExtensionDigestIdentity } from "../../../../shared/extensions-ipc";
import {
  sameProductResourceScope,
  type ProductResourceScope,
} from "../../../../shared/product-resource-scope";

export type RetainedExtensionDataOwner = Readonly<{
  installIdentity: string;
  scope: ProductResourceScope;
  sourceIdentity: string;
  /** Sanitized non-authority metadata; exact digests remain the only owner proof. */
  displayLabel?: string;
  sourceLabel?: string;
}>;

export type PluginDataEpochFaults = Readonly<{
  afterSnapshotEntry?: (entryCount: number, target: string) => void | Promise<void>;
  afterOwnerRename?: (ownerPath: string) => void | Promise<void>;
  afterOwnerParentSync?: (ownerPath: string) => void | Promise<void>;
  afterFreshEpochMarker?: (epochRoot: string) => void | Promise<void>;
  afterFreshEpochParentSync?: (epochRoot: string) => void | Promise<void>;
}>;

const COMPLETE_MARKER = ".snapshot-complete";
const EPOCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/* ============================================================
 * `PLUGIN_DATA` 是 install-owned 的逻辑数据，不是允许多代共写的一个目录。
 *
 * 路径形态由 `{installIdentity, pluginDataEpochId}` 确定性派生，父级
 * `.../<installIdentity>` 与 `.../epochs` 只是容器：它们永不作为能力签发，
 * 因此 realpath containment 拒绝 sibling epoch 是天然成立的，而不是靠检查。
 * ============================================================ */
export class PluginDataEpochStore {
  private readonly paused = new Set<string>();
  private readonly writers = new Map<string, string>();

  constructor(
    private readonly dataRoot: string,
    private readonly faults: PluginDataEpochFaults = {}
  ) {}

  /** 唯一 canonical 写根；调用方不得自己拼路径。 */
  epochRoot(installIdentity: string, pluginDataEpochId: string) {
    assertEpochId(pluginDataEpochId);
    return containedPath(
      this.dataRoot,
      assertExtensionDigestIdentity(installIdentity, "installIdentity"),
      "epochs",
      pluginDataEpochId
    );
  }

  ownerPath(installIdentity: string) {
    return containedPath(
      this.dataRoot,
      assertExtensionDigestIdentity(installIdentity, "installIdentity"),
      "owner.json"
    );
  }

  async ensureOwner(owner: RetainedExtensionDataOwner) {
    const normalizedOwner = normalizeOwnerMetadata(owner);
    assertOwnerIdentities(normalizedOwner);
    const root = containedPath(this.dataRoot, normalizedOwner.installIdentity);
    await ensureDirectoryDurable(this.dataRoot, 0o700);
    await ensureDirectoryDurable(root, 0o700);
    await this.assertInstallRoot(normalizedOwner.installIdentity);
    const existing = await this.owner(normalizedOwner.installIdentity);
    if (existing) {
      if (
        existing.sourceIdentity !== normalizedOwner.sourceIdentity ||
        !sameProductResourceScope(existing.scope, normalizedOwner.scope)
      ) {
        throw new Error("Retained Extension data owner receipt 冲突");
      }
      await fsyncRegularFileNoFollow(this.ownerPath(owner.installIdentity));
      await fsyncPath(root);
      return existing;
    }
    const ownerPath = this.ownerPath(normalizedOwner.installIdentity);
    const temporary = `${ownerPath}.${randomUUID()}.tmp`;
    const output = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await output.writeFile(`${JSON.stringify(normalizedOwner, null, 2)}\n`);
      await output.sync();
    } finally {
      await output.close();
    }
    await rename(temporary, ownerPath);
    await this.faults.afterOwnerRename?.(ownerPath);
    await fsyncPath(root);
    await this.faults.afterOwnerParentSync?.(ownerPath);
    return structuredClone(normalizedOwner);
  }

  async owner(installIdentity: string): Promise<RetainedExtensionDataOwner | null> {
    const identity = assertExtensionDigestIdentity(
      installIdentity,
      "installIdentity"
    );
    try {
      await this.assertInstallRoot(identity);
      const handle = await open(
        this.ownerPath(identity),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        const owner = parseOwner(JSON.parse(await handle.readFile("utf8")));
        if (owner.installIdentity !== identity) {
          throw new Error("Retained owner receipt 与目录 identity 不一致");
        }
        return owner;
      } finally {
        await handle.close();
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  async listOwners(scope?: ProductResourceScope) {
    const owners: RetainedExtensionDataOwner[] = [];
    try {
      const directory = await opendir(this.dataRoot);
      for await (const entry of directory) {
        if (!entry.isDirectory()) continue;
        assertExtensionDigestIdentity(entry.name, "retained data directory");
        const owner = await this.owner(entry.name);
        if (owner && (!scope || sameProductResourceScope(owner.scope, scope))) {
          owners.push(owner);
        }
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    return owners.sort((left, right) =>
      left.installIdentity.localeCompare(right.installIdentity)
    );
  }

  /** 幂等：崩溃重放按同一个预分配 epoch id 再来一次，不会产生第二个写根。 */
  async ensureEpoch(installIdentity: string, pluginDataEpochId: string) {
    const root = this.epochRoot(installIdentity, pluginDataEpochId);
    const owner = await this.owner(installIdentity);
    if (!owner) throw new Error("Fresh plugin data epoch 缺少 durable owner receipt");
    const epochsRoot = dirname(root);
    await ensureDirectoryDurable(epochsRoot, 0o700);
    await ensureDirectoryDurable(root, 0o700);
    await this.writeCompletionMarker(root);
    await this.faults.afterFreshEpochMarker?.(root);
    await fsyncPath(epochsRoot);
    await this.faults.afterFreshEpochParentSync?.(root);
    return root;
  }

  async hasEpoch(installIdentity: string, pluginDataEpochId: string) {
    const root = this.epochRoot(installIdentity, pluginDataEpochId);
    const [directory, marker] = await Promise.all([
      lstat(root).catch(() => null),
      lstat(join(root, COMPLETE_MARKER)).catch(() => null),
    ]);
    return Boolean(
      directory?.isDirectory() &&
        !directory.isSymbolicLink() &&
        marker?.isFile() &&
        !marker.isSymbolicLink()
    );
  }

  /** 盘上真实存在的 epoch，而不是 registry 记得的那些——数据比代码活得久。 */
  async listEpochs(installIdentity: string) {
    const entries: string[] = [];
    try {
      const directory = await opendir(
        containedPath(
          this.dataRoot,
          assertExtensionDigestIdentity(installIdentity, "installIdentity"),
          "epochs"
        )
      );
      for await (const entry of directory) {
        if (
          entry.isDirectory() &&
          EPOCH_ID_PATTERN.test(entry.name) &&
          await this.hasEpoch(installIdentity, entry.name)
        ) {
          entries.push(entry.name);
        }
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    return entries.sort();
  }

  /**
   * 最终数据删除。**只有独立、显式的卸载动作才调用它**：package 代码回收从不
   * 经过这里——那会让「换个版本」和「丢掉全部历史」共用一个动作。
   */
  async purgeInstallData(expectedOwner: RetainedExtensionDataOwner) {
    assertOwnerIdentities(expectedOwner);
    const owner = await this.owner(expectedOwner.installIdentity);
    if (
      !owner ||
      owner.sourceIdentity !== expectedOwner.sourceIdentity ||
      !sameProductResourceScope(owner.scope, expectedOwner.scope)
    ) {
      throw Object.assign(new Error("Retained Extension data 不属于目标 owner"), {
        status: 409,
      });
    }
    const { installIdentity } = owner;
    const outstanding = [...this.writers.values()].filter((value) =>
      value.startsWith(`${installIdentity}\0`)
    );
    if (outstanding.length) {
      throw Object.assign(
        new Error(`install data 仍有 ${outstanding.length} 个未归还的 writer lease`),
        { status: 409 }
      );
    }
    const installRoot = await this.assertInstallRoot(installIdentity);
    await rm(installRoot, {
      recursive: true,
      force: true,
    });
    await fsyncPath(this.dataRoot);
  }

  /* ── package-data gate：先关新 writer，再 drain 已签发的 lease ──────────── */

  pauseWriters(installIdentity: string, pluginDataEpochId: string) {
    this.paused.add(key(installIdentity, pluginDataEpochId));
  }

  resumeWriters(installIdentity: string, pluginDataEpochId: string) {
    this.paused.delete(key(installIdentity, pluginDataEpochId));
  }

  /** 已签发且未归还的 writer lease；snapshot 前必须为 0。 */
  activeWriters(installIdentity: string, pluginDataEpochId: string) {
    const target = key(installIdentity, pluginDataEpochId);
    return [...this.writers.entries()]
      .filter(([, value]) => value === target)
      .map(([leaseId]) => leaseId);
  }

  acquireWriter(installIdentity: string, pluginDataEpochId: string) {
    const target = key(installIdentity, pluginDataEpochId);
    if (this.paused.has(target)) {
      throw Object.assign(new Error("package data gate 已暂停新 writer"), {
        status: 409,
      });
    }
    const leaseId = randomUUID();
    this.writers.set(leaseId, target);
    return leaseId;
  }

  /** custody 重启对账专用：durable lease id 幂等重建，绝不另发一张新票。 */
  restoreWriter(
    leaseId: string,
    installIdentity: string,
    pluginDataEpochId: string
  ) {
    const target = key(installIdentity, pluginDataEpochId);
    const existing = this.writers.get(leaseId);
    if (existing && existing !== target) {
      throw new Error("writer lease identity 与 durable custody 不一致");
    }
    this.writers.set(leaseId, target);
  }

  releaseWriter(leaseId: string) {
    this.writers.delete(leaseId);
  }

  /**
   * 从源 epoch 的 fsync 快照创建新 epoch。必须先 `pauseWriters` 并把 lease
   * drain 到 0——否则复制出来的是一个谁也说不清的中间态。
   *
   * 复制期间遇到任何拒绝形态（symlink 逃逸以外的特殊文件）一律抛错：调用方
   * 据此把这一代 block 在 staged，而不是退回 `dataBinding=none` 先发布。
   */
  async snapshotEpoch(input: {
    installIdentity: string;
    fromEpochId: string;
    toEpochId: string;
  }) {
    const source = this.epochRoot(input.installIdentity, input.fromEpochId);
    const target = this.epochRoot(input.installIdentity, input.toEpochId);
    if (!this.paused.has(key(input.installIdentity, input.fromEpochId))) {
      throw new Error("源 epoch 未暂停 writer，不能做一致快照");
    }
    const pending = this.activeWriters(input.installIdentity, input.fromEpochId);
    if (pending.length) {
      throw new Error(`源 epoch 仍有 ${pending.length} 个未归还的 writer lease`);
    }
    if (!(await this.hasEpoch(input.installIdentity, input.fromEpochId))) {
      throw new Error("源 epoch 缺少 durable completion receipt");
    }
    if (await this.hasEpoch(input.installIdentity, input.toEpochId)) return target;
    const partial = `${target}.partial`;
    await rm(partial, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
    await ensureDirectoryDurable(dirname(target), 0o700);
    await mkdir(partial, { recursive: false, mode: 0o700 });
    await fsyncPath(dirname(partial));
    let entryCount = 0;
    await copyTree(source, partial, async () => {
      entryCount += 1;
      await this.faults.afterSnapshotEntry?.(entryCount, partial);
    });
    await this.writeCompletionMarker(partial);
    await rename(partial, target);
    await fsyncPath(dirname(target));
    return target;
  }

  private async writeCompletionMarker(root: string) {
    const marker = join(root, COMPLETE_MARKER);
    const output = await open(
      marker,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await output.writeFile("complete\n");
      await output.sync();
    } finally {
      await output.close();
    }
    await fsyncPath(root);
  }

  private async assertInstallRoot(installIdentity: string) {
    const identity = assertExtensionDigestIdentity(
      installIdentity,
      "installIdentity"
    );
    const expected = containedPath(this.dataRoot, identity);
    const [canonicalDataRoot, stat] = await Promise.all([
      realpath(this.dataRoot),
      lstat(expected),
    ]);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Retained install root 必须是普通目录");
    }
    const canonicalInstallRoot = await realpath(expected);
    const child = relative(canonicalDataRoot, canonicalInstallRoot);
    if (
      child !== identity ||
      basename(canonicalInstallRoot) !== identity ||
      isAbsolute(child) ||
      child.startsWith("..")
    ) {
      throw new Error("Retained install root 越过 dataRoot containment");
    }
    return canonicalInstallRoot;
  }
}

function parseOwner(value: unknown): RetainedExtensionDataOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Retained Extension data owner receipt 无效");
  }
  const owner = value as Partial<RetainedExtensionDataOwner>;
  const scope = owner.scope;
  const validScope =
    scope?.kind === "global" ||
    (scope?.kind === "project" &&
      typeof scope.projectId === "string" &&
      /^[A-Za-z0-9_-]{10,64}$/.test(scope.projectId));
  if (
    typeof owner.installIdentity !== "string" ||
    typeof owner.sourceIdentity !== "string" ||
    !validScope ||
    (owner.displayLabel !== undefined &&
      (typeof owner.displayLabel !== "string" ||
        sanitizeLabel(owner.displayLabel, 120) !== owner.displayLabel)) ||
    (owner.sourceLabel !== undefined &&
      (typeof owner.sourceLabel !== "string" ||
        sanitizeLabel(owner.sourceLabel, 300) !== owner.sourceLabel))
  ) {
    throw new Error("Retained Extension data owner receipt 无效");
  }
  assertOwnerIdentities(owner as RetainedExtensionDataOwner);
  return structuredClone(owner as RetainedExtensionDataOwner);
}

function key(installIdentity: string, pluginDataEpochId: string) {
  assertExtensionDigestIdentity(installIdentity, "installIdentity");
  assertEpochId(pluginDataEpochId);
  return `${installIdentity}\0${pluginDataEpochId}`;
}

/* 逐条 fsync 而不是 fs.cp：快照的意义就是「崩了也还在」，缓存里的副本不算数。
   Epoch 后续会成为 writer root，因此树内 symlink 一律拒绝，不能把越界能力复制进新代。 */
async function copyTree(
  source: string,
  target: string,
  afterEntry: () => Promise<void>
) {
  const directory = await opendir(source);
  for await (const entry of directory) {
    if (entry.name === COMPLETE_MARKER) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true, mode: 0o700 });
      await copyTree(from, to, afterEntry);
      await afterEntry();
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`plugin data snapshot 拒绝 symlink：${entry.name}`);
    }
    if (!entry.isFile()) {
      throw new Error(`plugin data 含无法快照的特殊文件：${entry.name}`);
    }
    await copyFileDurable(from, to);
    await afterEntry();
  }
  await fsyncPath(target);
}

function containedPath(root: string, ...segments: string[]) {
  const target = resolve(root, ...segments);
  const child = relative(resolve(root), target);
  if (!child || isAbsolute(child) || child.startsWith("..")) {
    throw new Error("Extension data path 越过 dataRoot containment");
  }
  return target;
}

function assertOwnerIdentities(owner: RetainedExtensionDataOwner) {
  assertExtensionDigestIdentity(owner.installIdentity, "installIdentity");
  assertExtensionDigestIdentity(owner.sourceIdentity, "sourceIdentity");
}

function normalizeOwnerMetadata(
  owner: RetainedExtensionDataOwner
): RetainedExtensionDataOwner {
  return {
    installIdentity: owner.installIdentity,
    scope: structuredClone(owner.scope),
    sourceIdentity: owner.sourceIdentity,
    ...(owner.displayLabel
      ? { displayLabel: sanitizeLabel(owner.displayLabel, 120) }
      : {}),
    ...(owner.sourceLabel
      ? { sourceLabel: sanitizeLabel(owner.sourceLabel, 300) }
      : {}),
  };
}

function sanitizeLabel(value: string, limit: number) {
  const normalized = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
  if (!normalized) throw new Error("Retained owner display metadata 为空");
  return normalized;
}

function assertEpochId(value: string) {
  if (!EPOCH_ID_PATTERN.test(value)) {
    throw new Error("pluginDataEpochId 路径 identity 无效");
  }
}

async function copyFileDurable(from: string, to: string) {
  let input;
  try {
    input = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error("plugin data snapshot source 变成 symlink，拒绝复制");
    }
    throw cause;
  }
  let bytes: Buffer;
  try {
    const stat = await input.stat();
    if (!stat.isFile()) throw new Error("plugin data snapshot source 不再是普通文件");
    bytes = await input.readFile();
  } finally {
    await input.close();
  }
  const output = await open(to, "wx", 0o600);
  try {
    await output.writeFile(bytes);
    await output.sync();
  } finally {
    await output.close();
  }
}

async function fsyncPath(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncRegularFileNoFollow(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Durable receipt 必须是普通文件");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Publish every newly-created directory entry before a later ledger may refer to it. */
async function ensureDirectoryDurable(path: string, mode: number): Promise<void> {
  const existing = await lstat(path).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`Durable directory path 非普通目录：${path}`);
    }
    return;
  }
  const parent = dirname(path);
  if (parent === path) throw new Error(`无法建立 durable directory：${path}`);
  await ensureDirectoryDurable(parent, mode);
  await mkdir(path, { recursive: false, mode }).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
  });
  const created = await lstat(path);
  if (!created.isDirectory() || created.isSymbolicLink()) {
    throw new Error(`Durable directory path 非普通目录：${path}`);
  }
  await fsyncPath(parent);
}
