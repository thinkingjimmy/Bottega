/**
 * [INPUT]: Depends on AppStore record/persistence ports, v11 schemas, generation artifacts, build/grant ledgers, and server cutover
 * [OUTPUT]: Provides startup state normalization, v11 restage checkpoints, artifact verification, quarantine, and orphan sweeping
 * [POS]: AppStore startup recovery owner; live CRUD remains in app-store.ts and generation construction remains in app-generation-builder.ts
 */

import { readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
}>;

export class AppStoreRecovery {
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
   * v11 只证明 manifest，不能继续当 active。checkpoint 必须先于 v12 失效提交；
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
        ?.generations.some((generation) => generation.contentLayoutVersion === 2);
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
    await this.sweepArtifacts();
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
          if (
            generation.contentLayoutVersion !== 2 ||
            !generation.manifestDigest ||
            !generation.sourcePackageDigest
          ) {
            throw new Error("active generation 不是 v2 sealed artifact");
          }
          await verifyPackageArtifact({
            root: this.artifactRoot(appId, generation.generationId),
            manifest: generation.manifest,
            expected: generationDigests(generation),
          });
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
    await this.sweepArtifacts();
  }

  private async sweepArtifacts() {
    const reachable = new Set<string>();
    for (const record of this.records.values()) {
      for (const generation of record.generations) {
        reachable.add(`${record.id}/${generation.generationId}`);
      }
    }
    for (const operation of this.buildLedger?.listNonTerminal() ?? []) {
      reachable.add(`${operation.appId}/${operation.appGenerationId}`);
    }
    for (const appId of await readdir(this.artifactsRoot).catch(() => [])) {
      const appRoot = join(this.artifactsRoot, appId);
      for (const generationId of await readdir(appRoot).catch(() => [])) {
        const path = join(appRoot, generationId);
        if (generationId.startsWith(".")) {
          await removePackageArtifact(path);
          continue;
        }
        if (reachable.has(`${appId}/${generationId}`)) continue;
        const target = join(appRoot, `.trash-${randomUUID()}`);
        const moved = await rename(path, target).then(
          () => true,
          () => false
        );
        if (moved) await removePackageArtifact(target);
      }
    }
  }

}
