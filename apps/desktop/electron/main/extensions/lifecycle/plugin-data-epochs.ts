/**
 * [INPUT]: Depends on Node fs/path and lifecycle ledger
 * [OUTPUT]: Provides PluginDataEpochStore: canonical epoch root, writer gate(suspend/drain), fsync snapshot Replacing with independent explicitly deleted final data
 * [POS]: The following is a list of the most common types of lifecycle extensions: `PLUGIN_DATA` The author is a single writerA generation of writing roots, father containers and sibling epoch never issued, package code recycling never goes through here
 */

import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";

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

  constructor(private readonly dataRoot: string) {}

  /** 唯一 canonical 写根；调用方不得自己拼路径。 */
  epochRoot(installIdentity: string, pluginDataEpochId: string) {
    return join(this.dataRoot, installIdentity, "epochs", pluginDataEpochId);
  }

  /** 幂等：崩溃重放按同一个预分配 epoch id 再来一次，不会产生第二个写根。 */
  async ensureEpoch(installIdentity: string, pluginDataEpochId: string) {
    const root = this.epochRoot(installIdentity, pluginDataEpochId);
    await mkdir(root, { recursive: true, mode: 0o700 });
    return root;
  }

  async hasEpoch(installIdentity: string, pluginDataEpochId: string) {
    return await lstat(this.epochRoot(installIdentity, pluginDataEpochId))
      .then((item) => item.isDirectory())
      .catch(() => false);
  }

  /** 盘上真实存在的 epoch，而不是 registry 记得的那些——数据比代码活得久。 */
  async listEpochs(installIdentity: string) {
    const entries: string[] = [];
    try {
      const directory = await opendir(
        join(this.dataRoot, installIdentity, "epochs")
      );
      for await (const entry of directory) {
        if (entry.isDirectory()) entries.push(entry.name);
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
  async purgeInstallData(installIdentity: string) {
    const outstanding = [...this.writers.values()].filter((value) =>
      value.startsWith(`${installIdentity}\0`)
    );
    if (outstanding.length) {
      throw Object.assign(
        new Error(`install data 仍有 ${outstanding.length} 个未归还的 writer lease`),
        { status: 409 }
      );
    }
    await rm(join(this.dataRoot, installIdentity), {
      recursive: true,
      force: true,
    });
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
    await mkdir(target, { recursive: true, mode: 0o700 });
    await copyTree(source, target);
    return target;
  }
}

function key(installIdentity: string, pluginDataEpochId: string) {
  return `${installIdentity}\0${pluginDataEpochId}`;
}

/* 逐条 fsync 而不是 fs.cp：快照的意义就是「崩了也还在」，缓存里的副本不算数。
   symlink 按 link 原样复制，绝不跟随——跟随会把 epoch 外的字节拷进新代。 */
async function copyTree(source: string, target: string) {
  const directory = await opendir(source);
  for await (const entry of directory) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true, mode: 0o700 });
      await copyTree(from, to);
      continue;
    }
    if (entry.isSymbolicLink()) {
      await symlink(await readlink(from), to);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`plugin data 含无法快照的特殊文件：${entry.name}`);
    }
    await copyFileDurable(from, to);
  }
  await fsyncPath(target);
}

async function copyFileDurable(from: string, to: string) {
  const bytes = await readFile(from);
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
