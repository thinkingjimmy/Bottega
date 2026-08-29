/**
 * [INPUT]: Depends on DurableJson, DesignStorageOperations, and narrow watcher/registry/history/custody lifecycle ports
 * [OUTPUT]: Provides CustodyDeletionJournal with durable intent, phased idempotent recovery, permanent owner fencing, and replacement-custody receipts
 * [POS]: Design storage's destructive saga; it makes explicit deletion recoverable without letting capture race owner termination or garbage collection
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";
import type { DesignCustodyEntry } from "./custody-ledger";
import type { DesignStorageOperations } from "./operations";

const phaseSchema = z.enum([
  "intent",
  "watcher-fenced",
  "registry-terminated",
  "history-terminated",
  "files-deleted",
  "custody-tombstoned",
  "replacement-pending",
  "replacement-activated",
  "complete",
]);
const entrySchema = z.object({
  operationId: z.string().uuid(),
  appId: z.string().regex(/^[a-z0-9]{10}$/),
  dataCustodyId: z.string().uuid(),
  custodySlotId: z.string().min(1).max(160),
  presetId: z.string().min(1).max(64),
  stableWorkspaceOwnerId: z.string().min(1).max(256),
  phase: phaseSchema,
  replacementDataCustodyId: z.string().uuid().nullable(),
  error: z.string().max(3_500).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  entries: z.array(entrySchema),
}).strict();

export type CustodyDeletionPhase = z.infer<typeof phaseSchema>;
export type CustodyDeletionEntry = z.infer<typeof entrySchema>;
type CustodyDeletionFile = z.infer<typeof fileSchema>;

export type CustodyDeletionPorts = Readonly<{
  custodyPath(dataCustodyId: string): string;
  fenceWatcher(workspace: string): Promise<void>;
  terminateRegistry(stableWorkspaceOwnerId: string): Promise<number>;
  terminateHistory(stableWorkspaceOwnerId: string): Promise<number>;
  deleteFiles(workspace: string): Promise<void>;
  tombstoneCustody(dataCustodyId: string): Promise<unknown>;
  shouldActivateReplacement(input: {
    appId: string;
    presetId: string;
  }): boolean;
  activateReplacement(input: {
    appId: string;
    custodySlotId: string;
    presetId: string;
    dataCustodyId: string;
  }): Promise<{ dataCustodyId: string }>;
}>;

type CheckpointHook = (
  phase: CustodyDeletionPhase,
  entry: CustodyDeletionEntry
) => void | Promise<void>;

export class CustodyDeletionJournal {
  private readonly file: DurableJson<CustodyDeletionFile>;
  private readonly active = new Map<string, Promise<CustodyDeletionEntry>>();

  constructor(
    userData: string,
    private readonly operations: DesignStorageOperations,
    private readonly ports: CustodyDeletionPorts,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
    private readonly afterCheckpoint: CheckpointHook = () => undefined
  ) {
    this.file = new DurableJson(
      join(userData, "design", "custody-deletions.json"),
      fileSchema,
      () => ({ schemaVersion: 1, revision: 0, entries: [] })
    );
  }

  async initialize() {
    await this.file.initialize();
    for (const entry of this.file.snapshot().entries) {
      if (entry.phase === "complete") continue;
      // 单个 saga 的确定性失败（如 rm 撞上 EPERM/EBUSY）绝不能 gate 整个 Apps
      // 子系统启动：吞掉并告警，续跑仍是幂等的，durable fence（isOwnerFenced）
      // 依旧是安全属性。这里仍 await 以保持“启动后相位已推进”的恢复语义。
      await this.resumeOnce(entry.operationId).catch((cause) =>
        console.warn("[design] custody deletion resume failed at startup", cause)
      );
    }
  }

  list() {
    return this.file.snapshot().entries;
  }

  isOwnerFenced(stableWorkspaceOwnerId: string) {
    return this.file.snapshot().entries.some(
      (entry) => entry.stableWorkspaceOwnerId === stableWorkspaceOwnerId
    );
  }

  async delete(entry: DesignCustodyEntry) {
    const operation = await this.operations.run(() =>
      this.file.mutate((state) => {
        const existing = state.entries.find(
          (candidate) => candidate.dataCustodyId === entry.dataCustodyId
        );
        if (existing) return existing;
        const timestamp = this.now();
        const created: CustodyDeletionEntry = {
          operationId: this.createId(),
          appId: requireAppId(entry.appId),
          dataCustodyId: entry.dataCustodyId,
          custodySlotId: entry.custodySlotId,
          presetId: entry.presetId,
          stableWorkspaceOwnerId: `data:${entry.dataCustodyId}`,
          phase: "intent",
          replacementDataCustodyId: null,
          error: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        state.entries.push(created);
        state.revision += 1;
        return created;
      })
    );
    await this.afterCheckpoint("intent", operation);
    return this.resumeOnce(operation.operationId);
  }

  async drain() {
    await Promise.allSettled([...this.active.values()]);
  }

  async closeAndFlush() {
    await this.drain();
    return this.file.closeAndFlush();
  }

  private resumeOnce(operationId: string) {
    const current = this.active.get(operationId);
    if (current) return current;
    const running = this.resume(operationId).finally(() => {
      this.active.delete(operationId);
    });
    this.active.set(operationId, running);
    return running;
  }

  private async resume(operationId: string) {
    let entry = this.requireEntry(operationId);
    try {
      if (entry.phase === "intent") {
        await this.ports.fenceWatcher(
          this.ports.custodyPath(entry.dataCustodyId)
        );
        entry = await this.checkpoint(operationId, "watcher-fenced");
      }
      if (entry.phase === "watcher-fenced") {
        entry = await this.step(operationId, "registry-terminated", () =>
          this.ports.terminateRegistry(entry.stableWorkspaceOwnerId)
        );
      }
      if (entry.phase === "registry-terminated") {
        entry = await this.step(operationId, "history-terminated", () =>
          this.ports.terminateHistory(entry.stableWorkspaceOwnerId)
        );
      }
      if (entry.phase === "history-terminated") {
        entry = await this.step(operationId, "files-deleted", () =>
          this.ports.deleteFiles(this.ports.custodyPath(entry.dataCustodyId))
        );
      }
      if (entry.phase === "files-deleted") {
        entry = await this.step(operationId, "custody-tombstoned", () =>
          this.ports.tombstoneCustody(entry.dataCustodyId)
        );
      }
      if (entry.phase === "custody-tombstoned") {
        if (this.ports.shouldActivateReplacement(entry)) {
          entry = await this.checkpoint(
            operationId,
            "replacement-pending",
            this.createId()
          );
        } else {
          entry = await this.checkpoint(operationId, "replacement-activated", null);
        }
      }
      if (entry.phase === "replacement-pending") {
        const dataCustodyId = entry.replacementDataCustodyId;
        if (!dataCustodyId) throw new Error("Design replacement custody receipt 缺失");
        await this.operations.run(() =>
          this.ports.activateReplacement({
            appId: entry.appId,
            custodySlotId: entry.custodySlotId,
            presetId: entry.presetId,
            dataCustodyId,
          })
        );
        entry = await this.checkpoint(
          operationId,
          "replacement-activated",
          dataCustodyId
        );
      }
      if (entry.phase === "replacement-activated") {
        entry = await this.checkpoint(operationId, "complete");
      }
      return entry;
    } catch (cause) {
      await this.recordError(operationId, cause).catch(() => undefined);
      throw cause;
    }
  }

  private step(
    operationId: string,
    phase: CustodyDeletionPhase,
    effect: () => Promise<unknown>
  ) {
    return this.operations.run(async () => {
      await effect();
      return this.checkpointDirect(operationId, phase);
    }).then(async (entry) => {
      await this.afterCheckpoint(phase, entry);
      return entry;
    });
  }

  private checkpoint(
    operationId: string,
    phase: CustodyDeletionPhase,
    replacementDataCustodyId?: string | null
  ) {
    return this.operations.run(() =>
      this.checkpointDirect(operationId, phase, replacementDataCustodyId)
    ).then(async (entry) => {
      await this.afterCheckpoint(phase, entry);
      return entry;
    });
  }

  private checkpointDirect(
    operationId: string,
    phase: CustodyDeletionPhase,
    replacementDataCustodyId?: string | null
  ) {
    return this.file.mutate((state) => {
      const entry = requireOperation(state, operationId);
      entry.phase = phase;
      if (replacementDataCustodyId !== undefined) {
        entry.replacementDataCustodyId = replacementDataCustodyId;
      }
      entry.error = null;
      entry.updatedAt = this.now();
      state.revision += 1;
      return entry;
    });
  }

  private recordError(operationId: string, cause: unknown) {
    return this.operations.run(() =>
      this.file.mutate((state) => {
        const entry = requireOperation(state, operationId);
        entry.error = message(cause);
        entry.updatedAt = this.now();
        state.revision += 1;
      })
    );
  }

  private requireEntry(operationId: string) {
    const entry = this.file.snapshot().entries.find(
      (candidate) => candidate.operationId === operationId
    );
    if (!entry) throw new Error("Design custody deletion 不存在");
    return entry;
  }
}

function requireOperation(state: CustodyDeletionFile, operationId: string) {
  const entry = state.entries.find(
    (candidate) => candidate.operationId === operationId
  );
  if (!entry) throw new Error("Design custody deletion 不存在");
  return entry;
}

function requireAppId(appId: string | null) {
  if (!appId) throw new Error("Design custody deletion 仅接受 active App custody");
  return appId;
}

const message = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, 3_500);
