/**
 * [INPUT]: Depends on AppStore v15 record/persistence ports, static-v2/compiled-v3 sealed artifact verifiers, the build ledger, and the single registered artifact-root provider
 * [OUTPUT]: Provides startup state normalization, concurrent live-artifact re-verification with fail-closed quarantine, serialized intent-driven artifact GC, and retiredAt-ordered quota collection that preserves every reachable artifact root
 * [POS]: AppStore startup recovery owner; live CRUD remains in app-store.ts and generation construction remains in ../generation/app-generation-builder.ts
 */

import { lstat, open, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppRecord } from "../../../../shared/apps-ipc";
import { servesWebRuntime } from "../../../../shared/apps-ipc";
import { errorMessage } from "../../errors";
import { durableReplaceFile } from "../../persistence/durable-json";
import type { AppGenerationBuildLedger } from "../generation/app-generation-build-ledger";
import { generationDigests } from "../generation/app-generation-plan";
import { removePackageArtifact, verifyPackageArtifact } from "../share/package/package-contract";
import { verifyCompiledV3Artifact } from "../gui-build/pipeline/seal";

const APP_ARTIFACT_LIMIT = 128 * 1024 * 1024;
const GLOBAL_ARTIFACT_LIMIT = 2 * 1024 * 1024 * 1024;
const artifactGcSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.string().min(1),
  trash: z.string().min(1),
}).strict();

type AppStoreRecoveryHost = Readonly<{
  records: Map<string, AppRecord>;
  artifactsRoot: string;
  buildLedger(): AppGenerationBuildLedger | null;
  artifactRoot(appId: string, generationId: string): string;
  persist(): Promise<void>;
  commitRecord(record: AppRecord, appId: string, previous?: AppRecord): Promise<AppRecord>;
  artifactRoots(): readonly Readonly<{ appId: string; generationId: string }>[];
}>;

export class AppStoreRecovery {
  private sweepTail = Promise.resolve();
  constructor(private readonly host: AppStoreRecoveryHost) {}
  private get records() { return this.host.records; }
  private get artifactsRoot() { return this.host.artifactsRoot; }
  private get buildLedger() { return this.host.buildLedger(); }
  private artifactRoot(appId: string, generationId: string) { return this.host.artifactRoot(appId, generationId); }
  private persist() { return this.host.persist(); }
  private commitRecord(record: AppRecord, appId: string, previous?: AppRecord) { return this.host.commitRecord(record, appId, previous); }

  /**
   * 启动期归一化两类「本不该存在」的状态，一次遍历、一次落盘：
   *
   * 1. 上次进程死在 installing/updating 中途 → 定格为对应失败终态，让用户看得见。
   * 2. 幻影 start 失败：只有 static/server 才有 web runtime，因而只有它们能在
   *    `start` 阶段失败。Base App 上的 `phase:"start"` 是调用方越界（曾经由
   *    manifest 缺席时的反向 kind 判据造成）留下的伤疤，不是 App 的健康事实。
   *    字节与代绑定从未变动，故这里原样恢复 ready——不是复活，是抹掉一条不可能
   *    成立的记录，否则 App 会因状态非 ready 而永久失去 surface/授权/Design 资格。
   */
  async normalizeStartupStates() {
    let recovered = false;
    for (const [appId, record] of this.records) {
      if (record.state === "installing" || record.state === "updating") {
        const installing = record.state === "installing";
        this.records.set(appId, {
          ...record,
          state: installing ? "install-failed" : "update-failed",
          lastError: {
            phase: installing ? "install" : "update",
            message: "上次操作被中断",
          },
        });
        recovered = true;
        continue;
      }
      if (
        record.state !== "update-failed" ||
        record.lastError?.phase !== "start" ||
        servesWebRuntime(record.manifest) ||
        !record.generationBinding.active
      ) {
        continue;
      }
      this.records.set(appId, { ...record, state: "ready", lastError: null });
      recovered = true;
    }
    if (recovered) await this.persist();
  }

  /**
   * Zod 只验记录 shape；active/pending 的真实磁盘字节在启动期异步复验。
   *
   * 每条记录各自验各自的字节，彼此没有顺序依赖——串行只是把 N 次磁盘往返排成一
   * 条队，启动就白等这么久。并发跑、各自兜住自己的失败，最后一次落盘。
   */
  async reconcileArtifacts() {
    const quarantined = await Promise.all(
      [...this.records].map(([appId, record]) => this.verifyLiveArtifacts(appId, record))
    );
    if (quarantined.some(Boolean)) await this.persist();
    await this.queueArtifactSweep();
  }

  /** 复验一条记录的 live generation 字节；失败即隔离，返回是否改动了内存真相。 */
  private async verifyLiveArtifacts(appId: string, record: AppRecord) {
    const liveIds = new Set(
      [
        record.generationBinding.active?.generationId,
        record.generationBinding.pending?.generationId,
      ].filter((value): value is string => Boolean(value))
    );
    try {
      for (const generation of record.generations) {
        if (!liveIds.has(generation.generationId)) continue;
        const root = this.artifactRoot(appId, generation.generationId);
        if (generation.contentLayoutVersion === 3) {
          if (!generation.buildReceiptDigest) throw new Error("compiled-v3 build receipt digest 缺失");
          await verifyCompiledV3Artifact(root, {
            ...generationDigests(generation),
            buildReceiptDigest: generation.buildReceiptDigest,
          });
        } else {
          await verifyPackageArtifact({
            root,
            manifest: generation.manifest,
            expected: generationDigests(generation),
          });
        }
      }
      return false;
    } catch (cause) {
      this.records.set(appId, {
        ...record,
        state: "quarantined",
        lifecycleRevision: record.lifecycleRevision + 1,
        manifest: null,
        lastError: {
          phase: "manifest",
          message: `generation artifact 复验失败：${errorMessage(cause)}`,
        },
        generationBinding: {
          ...record.generationBinding,
          bindingRevision: record.generationBinding.bindingRevision + 1,
          active: null,
          pending: undefined,
        },
      });
      return true;
    }
  }

  collectArtifacts() {
    return this.queueArtifactSweep();
  }

  private queueArtifactSweep() {
    const result = this.sweepTail.then(() => this.sweepArtifactsOnce());
    this.sweepTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async sweepArtifactsOnce() {
    await this.resumeArtifactGc();
    const reachable = new Set<string>();
    const recent = new Map<string, number>();
    for (const record of this.records.values()) {
      const liveGenerationIds = [
        record.generationBinding.active?.generationId,
        record.generationBinding.pending?.generationId,
        ...record.generationBinding.drainingGenerationIds,
      ].filter((value): value is string => Boolean(value));
      liveGenerationIds.forEach((generationId) =>
        reachable.add(`${record.id}/${generationId}`)
      );
      if (record.state === "quarantined") {
        record.generations.forEach((generation) =>
          reachable.add(`${record.id}/${generation.generationId}`)
        );
      }
      record.generations
        .filter((generation) => !liveGenerationIds.includes(generation.generationId))
        .sort((left, right) =>
          (right.retiredAt ?? 0) - (left.retiredAt ?? 0) ||
          compareUtf8(right.generationId, left.generationId)
        )
        .slice(0, 2)
        .forEach((generation) => recent.set(
          `${record.id}/${generation.generationId}`,
          generation.retiredAt ?? 0
        ));
    }
    for (const operation of this.buildLedger?.listNonTerminal() ?? []) {
      reachable.add(`${operation.appId}/${operation.appGenerationId}`);
    }
    /* durable cutover / export 的未完成根由各自的 provider 注册进 artifactRoots()，
       这里只消费一个口径——再手抄一遍那些账本就是第二份真相。 */
    for (const root of this.host.artifactRoots()) {
      reachable.add(`${root.appId}/${root.generationId}`);
    }
    const artifacts: Array<{
      appId: string;
      generationId: string;
      key: string;
      path: string;
      bytes: number;
      required: boolean;
      retiredAt: number;
    }> = [];
    for (const appId of await readdir(this.artifactsRoot).catch(() => [])) {
      if (appId.startsWith(".")) continue;
      const appRoot = join(this.artifactsRoot, appId);
      for (const generationId of await readdir(appRoot).catch(() => [])) {
        const path = join(appRoot, generationId);
        if (generationId.startsWith(".")) {
          await this.removeArtifact(appId, generationId);
          continue;
        }
        const key = `${appId}/${generationId}`;
        artifacts.push({
          appId,
          generationId,
          key,
          path,
          /* bytes 只在配额账里被读到，而配额只算「必留」与「近期可留」这两类；
             其余目录本来就要删，为它递归量一次尺寸是纯浪费的启动 I/O。 */
          bytes: reachable.has(key) || recent.has(key) ? await directoryBytes(path) : 0,
          required: reachable.has(key),
          retiredAt: recent.get(key) ?? 0,
        });
      }
    }
    const retained = new Set(
      artifacts.filter((artifact) => artifact.required).map((artifact) => artifact.key)
    );
    const appBytes = new Map<string, number>();
    let globalBytes = 0;
    for (const artifact of artifacts.filter((candidate) => candidate.required)) {
      appBytes.set(artifact.appId, (appBytes.get(artifact.appId) ?? 0) + artifact.bytes);
      globalBytes += artifact.bytes;
    }
    for (const artifact of artifacts
      .filter((candidate) => candidate.retiredAt > 0)
      .sort((left, right) =>
        right.retiredAt - left.retiredAt || compareUtf8(right.generationId, left.generationId)
      )) {
      const nextAppBytes = (appBytes.get(artifact.appId) ?? 0) + artifact.bytes;
      if (nextAppBytes > APP_ARTIFACT_LIMIT || globalBytes + artifact.bytes > GLOBAL_ARTIFACT_LIMIT) continue;
      retained.add(artifact.key);
      appBytes.set(artifact.appId, nextAppBytes);
      globalBytes += artifact.bytes;
    }
    for (const artifact of artifacts) {
      if (!retained.has(artifact.key)) {
        await this.removeArtifact(artifact.appId, artifact.generationId);
      }
    }
  }

  private async resumeArtifactGc() {
    const intentPath = join(this.artifactsRoot, ".artifact-gc.json");
    let serialized: string;
    try {
      serialized = await readFile(intentPath, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    const raw = artifactGcSchema.parse(JSON.parse(serialized));
    const source = safeArtifactRelative(raw.source);
    const trash = safeArtifactRelative(raw.trash);
    await rename(join(this.artifactsRoot, source), join(this.artifactsRoot, trash)).catch(
      (cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT") throw cause; }
    );
    /* App artifact 目录可能已随上一轮清扫消失，只剩一张陈旧的 intent。目录不在
       就没有什么可 fsync、可枚举的——把「不存在」当故障会让启动死在一张废纸上。 */
    const appRoot = join(this.artifactsRoot, dirname(trash));
    await syncDirectory(appRoot);
    await removePackageArtifact(join(this.artifactsRoot, trash));
    await syncDirectory(appRoot);
    await rm(intentPath, { force: true });
    await syncDirectory(this.artifactsRoot);
    if ((await readdir(appRoot).catch(() => [])).length === 0) {
      await rmdir(appRoot).catch(() => undefined);
      await syncDirectory(this.artifactsRoot);
    }
  }

  private async removeArtifact(appId: string, generationId: string) {
    const source = `${appId}/${generationId}`;
    const trash = `${appId}/.trash-${randomUUID()}`;
    safeArtifactRelative(source);
    safeArtifactRelative(trash);
    const intentPath = join(this.artifactsRoot, ".artifact-gc.json");
    await durableReplaceFile(intentPath, `${JSON.stringify({
      schemaVersion: 1,
      source,
      trash,
    })}\n`);
    await this.resumeArtifactGc();
  }

}

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

async function directoryBytes(root: string): Promise<number> {
  const info = await lstat(root);
  if (!info.isDirectory()) return info.size;
  let bytes = 0;
  for (const entry of await readdir(root)) bytes += await directoryBytes(join(root, entry));
  return bytes;
}

function safeArtifactRelative(path: string) {
  const parts = path.split("/");
  if (parts.length !== 2 || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("artifact GC intent path is invalid");
  }
  return path;
}

/** 目录已经不在就没有什么可 fsync 的：缺席本身就是已持久化的事实。 */
async function syncDirectory(path: string) {
  const handle = await open(path, "r").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (!handle) return;
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
