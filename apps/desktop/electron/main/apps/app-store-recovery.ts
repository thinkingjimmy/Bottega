/**
 * [INPUT]: Depends on AppStore v14 record/persistence ports, legacy restage schemas, static-v2 compatibility/grant migration, compiled-v3 artifact verifiers, build/grant ledgers, live root providers, and durable cutover/export journals
 * [OUTPUT]: Provides startup normalization, crash-safe compatibility/restage recovery, sealed compiled recovery, quarantine, serialized intent-driven GC, and retiredAt-ordered quota collection that preserves every live or durable artifact root
 * [POS]: AppStore startup recovery owner; live CRUD remains in app-store.ts and generation construction remains in app-generation-builder.ts
 */

import { lstat, open, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppRecord } from "../../../shared/apps-ipc";
import { servesWebRuntime } from "../../../shared/apps-ipc";
import { errorMessage } from "../errors";
import { durableReplaceFile } from "../persistence/durable-json";
import type { AppGenerationBuildLedger } from "./app-generation-build-ledger";
import type { BaseGuiGrantStore } from "./base-gui/grant-store";
import { appManifestSchema } from "./install/manifest-schema";
import { generationDigests } from "./app-generation-plan";
import {
  legacyMigrationCheckpointSchema,
  type LegacyMigrationCheckpoint,
} from "./app-store-schema";
import { removePackageArtifact, verifyPackageArtifact } from "./share/package-contract";
import { verifyCompiledV3Artifact } from "./gui-build/pipeline/seal";
import {
  canonicalDigest,
  LEGACY_BASE_GUI_SDK_DIGEST,
} from "./gui-build/metadata";

const compatibilityMigrationSchema = z.object({
  schemaVersion: z.literal(1),
  migrationRevision: z.string().uuid(),
  entries: z.array(z.object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    generationId: z.string().min(1),
    phase: z.enum(["generation", "grant", "consent"]),
  }).strict()),
}).strict();
type CompatibilityMigration = z.infer<typeof compatibilityMigrationSchema>;

const APP_ARTIFACT_LIMIT = 128 * 1024 * 1024;
const GLOBAL_ARTIFACT_LIMIT = 2 * 1024 * 1024 * 1024;
const artifactGcSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.string().min(1),
  trash: z.string().min(1),
}).strict();

export type AppStoreRecoveryHost = Readonly<{
  records: Map<string, AppRecord>;
  artifactsRoot: string;
  filePath: string;
  legacyMigrationPath: string;
  buildLedger(): AppGenerationBuildLedger | null;
  baseGuiGrants(): BaseGuiGrantStore | null;
  get(appId: string): AppRecord | undefined;
  artifactRoot(appId: string, generationId: string): string;
  assertDerivedPaths(records: AppRecord[]): void;
  persist(): Promise<void>;
  commitRecord(record: AppRecord, appId: string, previous?: AppRecord): Promise<AppRecord>;
  withServerCutover(appId: string, compute: () => AppRecord): Promise<AppRecord>;
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  artifactRoots(): readonly Readonly<{ appId: string; generationId: string }>[];
}>;

export class AppStoreRecovery {
  private sweepTail = Promise.resolve();
  constructor(private readonly host: AppStoreRecoveryHost) {}
  private get records() { return this.host.records; }
  private get artifactsRoot() { return this.host.artifactsRoot; }
  private get filePath() { return this.host.filePath; }
  private get legacyMigrationPath() { return this.host.legacyMigrationPath; }
  private get buildLedger() { return this.host.buildLedger(); }
  private get baseGuiGrants() { return this.host.baseGuiGrants(); }
  private get(appId: string) { return this.host.get(appId); }
  private artifactRoot(appId: string, generationId: string) { return this.host.artifactRoot(appId, generationId); }
  private assertDerivedPaths(records: AppRecord[]) { return this.host.assertDerivedPaths(records); }
  private persist() { return this.host.persist(); }
  private commitRecord(record: AppRecord, appId: string, previous?: AppRecord) { return this.host.commitRecord(record, appId, previous); }
  private withServerCutover(appId: string, compute: () => AppRecord) { return this.host.withServerCutover(appId, compute); }
  private enqueue<T>(operation: () => Promise<T>) { return this.host.enqueue(operation); }

  async migrateStaticV2Compatibility() {
    const path = join(dirname(this.filePath), "app-gui-compatibility-migration.json");
    let checkpoint = await this.readCompatibilityMigration(path);
    if (!checkpoint) {
      const entries = [...this.records.values()].flatMap((record) =>
        record.generations
          .filter((generation) =>
            generation.contentLayoutVersion === 2 &&
            generation.manifest.kind === "base" &&
            Boolean(generation.manifest.gui) &&
            !generation.compatibilityRef
          )
          .map((generation) => ({
            appId: record.id,
            generationId: generation.generationId,
            phase: "generation" as const,
          }))
      );
      if (!entries.length) return;
      checkpoint = {
        schemaVersion: 1,
        migrationRevision: randomUUID(),
        entries,
      };
      await this.writeCompatibilityMigration(path, checkpoint);
    }

    for (const entry of [...checkpoint.entries]) {
      try {
        checkpoint = await this.migrateCompatibilityEntry(path, checkpoint, entry);
      } catch (cause) {
        await this.quarantineCompatibilityEntry(entry, cause);
        checkpoint = await this.finishCompatibilityEntry(path, checkpoint, entry);
      }
    }
    if (!checkpoint.entries.length) await rm(path, { force: true });
  }

  private async migrateCompatibilityEntry(
    path: string,
    checkpoint: CompatibilityMigration,
    entry: CompatibilityMigration["entries"][number]
  ) {
    const record = this.get(entry.appId);
    const generation = record?.generations.find(
      (candidate) => candidate.generationId === entry.generationId
    );
    if (!record || !generation) {
      return this.finishCompatibilityEntry(path, checkpoint, entry);
    }
    if (generation.contentLayoutVersion !== 2 || generation.manifest.kind !== "base" || !generation.manifest.gui) {
      throw new Error("static-v2 compatibility 无法从非 Base GUI generation 派生");
    }
    const compatibilityRef = {
      kind: "static-v2" as const,
      legacySdkDigest: LEGACY_BASE_GUI_SDK_DIGEST,
      legacyBaseApiVersion: "base-gui-legacy-v1" as const,
      grantContractVersion: "studio-grant-v1" as const,
      requiredHostActions: [
        "open-data" as const,
        "open-data-view" as const,
        ...(generation.manifest.gui.hostActions?.includes("compose-text")
          ? ["compose-text" as const]
          : []),
      ],
    };
    const compatibilityRefDigest = canonicalDigest(compatibilityRef);
    if (entry.phase === "generation") {
      if (!generation.compatibilityRef) {
        await this.commitRecord({
          ...record,
          generations: record.generations.map((candidate) =>
            candidate.generationId === entry.generationId
              ? {
                  ...candidate,
                  compatibilityRef,
                  compatibilityRefDigest,
                  compatibilityMigrationRevision: checkpoint.migrationRevision,
                }
              : candidate
          ),
        }, record.id, record);
      } else if (generation.compatibilityRefDigest !== compatibilityRefDigest) {
        throw new Error("static-v2 compatibility ref 与冻结 legacy 合同冲突");
      }
      checkpoint = await this.advanceCompatibilityEntry(path, checkpoint, entry, "grant");
    }
    if (entry.phase === "grant" || checkpoint.entries.find((item) => item.appId === entry.appId && item.generationId === entry.generationId)?.phase === "grant") {
      const requiresGrantLedger =
        record.studioGrant?.generationId === entry.generationId ||
        (record.generationBinding.pending?.generationId === entry.generationId &&
          Boolean(record.generationBinding.pending.baseGuiDecision));
      if (requiresGrantLedger && !this.baseGuiGrants) {
        throw new Error("Base GUI grant ledger 在 compatibility 迁移期间不可用");
      }
      await this.baseGuiGrants?.bindCompatibility({
        appId: entry.appId,
        generationId: entry.generationId,
        compatibilityRefDigest,
        compatibilityMigrationRevision: checkpoint.migrationRevision,
      });
      checkpoint = await this.advanceCompatibilityEntry(path, checkpoint, entry, "consent");
    }
    const current = this.get(entry.appId);
    if (!current) return this.finishCompatibilityEntry(path, checkpoint, entry);
    const projection = this.baseGuiGrants?.projection(entry.appId, entry.generationId);
    const pending = current.generationBinding.pending;
    await this.commitRecord({
      ...current,
      ...(current.studioGrant?.generationId === entry.generationId
        ? {
            studioGrant: {
              ...current.studioGrant,
              compatibilityRefDigest,
              compatibilityMigrationRevision: checkpoint.migrationRevision,
              baseGuiDecisionId: projection?.decision?.decisionId ?? null,
              baseGuiDecisionRevision: projection?.revision ?? 0,
            },
          }
        : {}),
      generationBinding: pending?.generationId === entry.generationId && pending.baseGuiDecision
        ? {
            ...current.generationBinding,
            pending: {
              ...pending,
              baseGuiDecision: {
                ...pending.baseGuiDecision,
                expectedRevision: projection?.revision ?? pending.baseGuiDecision.expectedRevision,
                compatibilityRefDigest,
                compatibilityMigrationRevision: checkpoint.migrationRevision,
              },
            },
          }
        : current.generationBinding,
    }, current.id, current);
    return this.finishCompatibilityEntry(path, checkpoint, entry);
  }

  private async quarantineCompatibilityEntry(
    entry: CompatibilityMigration["entries"][number],
    cause: unknown
  ) {
    const record = this.get(entry.appId);
    if (!record) return;
    await this.commitRecord({
      ...record,
      state: "quarantined",
      lifecycleRevision: record.lifecycleRevision + 1,
      manifest: null,
      lastError: {
        phase: "manifest",
        message: `static-v2 compatibility 迁移失败：${errorMessage(cause)}`,
      },
      generationBinding: {
        ...record.generationBinding,
        bindingRevision: record.generationBinding.bindingRevision + 1,
        active: null,
        pending: undefined,
      },
    }, record.id, record);
  }

  private async readCompatibilityMigration(path: string) {
    try {
      return compatibilityMigrationSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`App GUI compatibility migration journal 无效：${errorMessage(cause)}`);
    }
  }

  private advanceCompatibilityEntry(
    path: string,
    checkpoint: CompatibilityMigration,
    entry: CompatibilityMigration["entries"][number],
    phase: CompatibilityMigration["entries"][number]["phase"]
  ) {
    return this.writeCompatibilityMigration(path, {
      ...checkpoint,
      entries: checkpoint.entries.map((candidate) =>
        candidate.appId === entry.appId && candidate.generationId === entry.generationId
          ? { ...candidate, phase }
          : candidate
      ),
    });
  }

  private finishCompatibilityEntry(
    path: string,
    checkpoint: CompatibilityMigration,
    entry: CompatibilityMigration["entries"][number]
  ) {
    return this.writeCompatibilityMigration(path, {
      ...checkpoint,
      entries: checkpoint.entries.filter((candidate) =>
        candidate.appId !== entry.appId || candidate.generationId !== entry.generationId
      ),
    });
  }

  private async writeCompatibilityMigration(path: string, value: CompatibilityMigration) {
    await durableReplaceFile(path, `${JSON.stringify(value, null, 2)}\n`);
    return value;
  }

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
   * v11 只证明 manifest，不能继续当 active。checkpoint 必须先于 v13 失效提交；
   * 此后每个 App 都以「v2 AppRecord 已提交 → 从 pending 移除」为 WAL 顺序。
   * 进程死在任意两步之间，下一次启动都从 `.v11.bak` 找回输入并幂等续跑。
   */
  async migrateLegacyV11(
    legacy: readonly AppRecord[],
    existingCheckpoint?: LegacyMigrationCheckpoint
  ) {
    let checkpoint =
      existingCheckpoint ?? {
        schemaVersion: 1 as const,
        pendingAppIds: legacy.map((record) => record.id),
      };
    if (!existingCheckpoint) {
      await this.writeLegacyMigrationCheckpoint(checkpoint);
      this.records.clear();
      for (const record of legacy) {
        this.records.set(record.id, {
          ...record,
          lifecycleRevision: record.lifecycleRevision + 1,
          generations: [],
          generationBinding: {
            bindingRevision: record.generationBinding.bindingRevision + 1,
            active: null,
            drainingGenerationIds: [],
          },
          manifest: null,
        });
      }
      await this.persist();
    }

    const byId = new Map(legacy.map((record) => [record.id, record]));
    for (const appId of [...checkpoint.pendingAppIds]) {
      const old = byId.get(appId);
      if (!old) {
        checkpoint = await this.completeLegacyMigrationApp(checkpoint, appId);
        continue;
      }
      const alreadyRestaged = this.records
        .get(appId)
        ?.generations.some((generation) => generation.contentLayoutVersion === 2 || generation.contentLayoutVersion === 3);
      if (alreadyRestaged) {
        checkpoint = await this.completeLegacyMigrationApp(checkpoint, appId);
        continue;
      }
      try {
        const manifest = appManifestSchema.parse(
          JSON.parse(await readFile(join(old.dir, "app.json"), "utf8"))
        );
        await this.withServerCutover(old.id, () => ({
          ...this.get(old.id)!,
          manifest,
        }));
      } catch (cause) {
        await this.enqueue(async () => {
          const current = this.records.get(old.id);
          if (!current) return;
          await this.commitRecord(
            {
              ...current,
              state: "quarantined",
              manifest: null,
              lastError: {
                phase: "manifest",
                message: `v11 restage 失败：${errorMessage(cause)}`,
              },
            },
            old.id,
            current
          );
        });
      }
      checkpoint = await this.completeLegacyMigrationApp(checkpoint, appId);
    }
    await rm(this.legacyMigrationPath, { force: true });
    await this.queueArtifactSweep();
  }

  async readLegacyMigrationCheckpoint() {
    try {
      return legacyMigrationCheckpointSchema.parse(
        JSON.parse(await readFile(this.legacyMigrationPath, "utf8"))
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`Apps v11 迁移 checkpoint 无效：${errorMessage(cause)}`, {
        cause,
      });
    }
  }

  private async completeLegacyMigrationApp(
    checkpoint: LegacyMigrationCheckpoint,
    appId: string
  ) {
    const next = {
      ...checkpoint,
      pendingAppIds: checkpoint.pendingAppIds.filter((id) => id !== appId),
    };
    await this.writeLegacyMigrationCheckpoint(next);
    return next;
  }

  private async writeLegacyMigrationCheckpoint(
    checkpoint: LegacyMigrationCheckpoint
  ) {
    await durableReplaceFile(
      this.legacyMigrationPath,
      `${JSON.stringify(checkpoint, null, 2)}\n`
    );
  }

  /** Zod 只验记录 shape；active/pending 的真实磁盘字节在启动期异步复验。 */
  async reconcileArtifacts() {
    let changed = false;
    for (const [appId, record] of this.records) {
      const liveIds = new Set(
        [
          record.generationBinding.active?.generationId,
          record.generationBinding.pending?.generationId,
        ].filter((value): value is string => Boolean(value))
      );
      try {
        for (const generation of record.generations) {
          if (!liveIds.has(generation.generationId)) continue;
          if (!generation.manifestDigest || !generation.sourcePackageDigest) {
            throw new Error("active generation digest 不完整");
          }
          if (generation.contentLayoutVersion === 3) {
            if (!generation.buildReceiptDigest) throw new Error("compiled-v3 build receipt digest 缺失");
            await verifyCompiledV3Artifact(
              this.artifactRoot(appId, generation.generationId),
              {
                ...generationDigests(generation),
                buildReceiptDigest: generation.buildReceiptDigest,
              }
            );
          } else if (generation.contentLayoutVersion === 2) {
            await verifyPackageArtifact({
              root: this.artifactRoot(appId, generation.generationId),
              manifest: generation.manifest,
              expected: generationDigests(generation),
            });
          } else {
            throw new Error("active generation 不是 static-v2 或 compiled-v3 sealed artifact");
          }
        }
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
        changed = true;
      }
    }
    if (changed) await this.persist();
    await this.queueArtifactSweep();
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
    for (const root of [
      ...this.host.artifactRoots(),
      ...(await this.durableArtifactRoots()),
    ]) reachable.add(`${root.appId}/${root.generationId}`);
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
          bytes: await directoryBytes(path),
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
    const appRoot = join(this.artifactsRoot, dirname(trash));
    await syncDirectory(appRoot);
    await removePackageArtifact(join(this.artifactsRoot, trash));
    await syncDirectory(appRoot);
    await rm(intentPath, { force: true });
    await syncDirectory(this.artifactsRoot);
    if ((await readdir(appRoot)).length === 0) {
      await rmdir(appRoot);
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

  private async durableArtifactRoots() {
    const roots: Array<{ appId: string; generationId: string }> = [];
    const files = [
      join(dirname(this.filePath), "apps", "gui-cutovers.json"),
      join(dirname(this.filePath), "apps", "file-export-intents.json"),
    ];
    for (const path of files) {
      let value: unknown;
      try {
        value = JSON.parse(await readFile(path, "utf8"));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new Error(`artifact root journal is unreadable: ${path}`, { cause });
      }
      if (!value || typeof value !== "object") {
        throw new Error(`artifact root journal is invalid: ${path}`);
      }
      const record = value as Record<string, unknown>;
      const entries = Array.isArray(record.intents) ? record.intents : null;
      if (!entries) throw new Error(`artifact root journal is invalid: ${path}`);
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") throw new Error(`artifact root entry is invalid: ${path}`);
        const item = entry as Record<string, unknown>;
        if (item.phase === "retired" || item.phase === "aborted") continue;
        const appId = item.appId;
        if (typeof appId !== "string") throw new Error(`artifact root app identity is invalid: ${path}`);
        for (const generationId of [
          item.generationId,
          item.nextGenerationId,
          item.expectedActiveGenerationId,
          nestedGenerationId(item.previous, path),
          nestedGenerationId(item.next, path),
        ]) {
          if (generationId === null || generationId === undefined) continue;
          if (typeof generationId !== "string") throw new Error(`artifact root generation identity is invalid: ${path}`);
          roots.push({ appId, generationId });
        }
      }
    }
    return roots;
  }

}

function nestedGenerationId(value: unknown, path: string) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).generationId !== "string") {
    throw new Error(`artifact root generation authority is invalid: ${path}`);
  }
  return (value as Record<string, unknown>).generationId as string;
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

async function syncDirectory(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
