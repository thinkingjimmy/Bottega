/**
 * [INPUT]: Depends on DurableJson, DesignStorageOperations, and CanvasRegistry/VersionHistory idempotent owner-migration primitives
 * [OUTPUT]: Provides OwnerMigrationJournal with idempotent, crash-resumable two-ledger migration, per-project concurrency guard, post-registry-only source-owner retirement, a terminal failed phase for deterministic conflicts, and startup-resilient resume, all derived only from a main Project rebind receipt
 * [POS]: Design storage's coordination ledger; it binds one Project rebind operation to exact source/target capability owners and prevents old turns from recreating migrated Registry/History truth
 */

import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";
import type { CanvasRegistry } from "./canvas-registry";
import type { DesignStorageOperations } from "./operations";
import type { VersionHistory } from "./version-history";

const ownerIdSchema = z.string().min(1).max(256);
const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const capabilityIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/);
const entrySchema = z
  .object({
    operationId: z.string().min(1).max(256),
    projectId: projectIdSchema,
    sourceCapabilityId: capabilityIdSchema,
    targetCapabilityId: capabilityIdSchema,
    fromStableWorkspaceOwnerId: ownerIdSchema,
    toStableWorkspaceOwnerId: ownerIdSchema,
    phase: z.enum([
      "registry-pending",
      "history-pending",
      "complete",
      "failed",
    ]),
    error: z.string().max(3_500).nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const fileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    entries: z.array(entrySchema),
  })
  .strict();

type OwnerMigrationFile = z.infer<typeof fileSchema>;
export type OwnerMigrationEntry = z.infer<typeof entrySchema>;

export class OwnerMigrationJournal {
  private readonly file: DurableJson<OwnerMigrationFile>;

  constructor(
    userData: string,
    private readonly registry: CanvasRegistry,
    private readonly history: VersionHistory,
    private readonly operations: DesignStorageOperations,
    private readonly now: () => number = Date.now
  ) {
    this.file = new DurableJson(
      join(userData, "design", "owner-migrations.json"),
      fileSchema,
      () => ({ schemaVersion: 1, revision: 0, entries: [] })
    );
  }

  async initialize() {
    await this.file.initialize();
    for (const entry of this.file.snapshot().entries) {
      if (!isPending(entry)) continue;
      // 单个卡死 saga 的确定性失败绝不能 gate 整个 Apps 子系统启动：吞掉并告警，
      // 条目保留 pending 相位，下次启动或交互仍可续跑（durable fence 仍是安全属性）。
      await this.operations
        .run(() => this.resume(entry.operationId))
        .catch((cause) =>
          console.warn("[design] owner migration resume failed at startup", cause)
        );
    }
  }

  list() {
    return this.file.snapshot().entries;
  }

  isOwnerRetired(stableWorkspaceOwnerId: string) {
    // 只有 Registry 迁移已完成（相位≥history-pending）的 source owner 才算退役：
    // 停在 registry-pending 或落到终态 failed 的条目其数据从未搬走，若在此退役
    // 会永久封死一份完好的数据且无恢复路径。
    return this.file.snapshot().entries.some(
      (entry) =>
        entry.fromStableWorkspaceOwnerId === stableWorkspaceOwnerId &&
        hasRegistryMoved(entry)
    );
  }

  migrateProjectBinding(input: {
    operationId: string;
    projectId: string;
    sourceCapabilityId: string;
    targetCapabilityId: string;
  }) {
    return this.operations.run(async () => {
      const operationId = z.string().min(1).max(256).parse(input.operationId);
      const projectId = projectIdSchema.parse(input.projectId);
      const sourceCapabilityId = capabilityIdSchema.parse(input.sourceCapabilityId);
      const targetCapabilityId = capabilityIdSchema.parse(input.targetCapabilityId);
      const from = ownerIdSchema.parse(ownerId(projectId, sourceCapabilityId));
      const to = ownerIdSchema.parse(ownerId(projectId, targetCapabilityId));
      if (from === to) throw new Error("Design owner migration 目标未变化");
      const operation = await this.file.mutate((state) => {
        const replay = state.entries.find(
          (entry) => entry.operationId === operationId
        );
        if (replay) {
          if (
            replay.projectId !== projectId ||
            replay.sourceCapabilityId !== sourceCapabilityId ||
            replay.targetCapabilityId !== targetCapabilityId
          ) {
            throw Object.assign(new Error("Project rebind receipt 与既有 Design migration 不匹配"), {
              status: 409,
            });
          }
          return replay;
        }
        // 阻塞守卫按 projectId 收窄：一个 Project 卡死的迁移绝不能 409 掉另一个
        // Project 的 rebind。落到终态 failed 的条目不再是 pending，不参与阻塞。
        const pending = state.entries.find(
          (entry) => isPending(entry) && entry.projectId === projectId
        );
        if (pending) {
          throw Object.assign(new Error("Design owner migration 已在进行"), {
            status: 409,
          });
        }
        const timestamp = this.now();
        const entry: OwnerMigrationEntry = {
          operationId,
          projectId,
          sourceCapabilityId,
          targetCapabilityId,
          fromStableWorkspaceOwnerId: from,
          toStableWorkspaceOwnerId: to,
          phase: "registry-pending",
          error: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        state.entries.push(entry);
        state.revision += 1;
        return entry;
      });
      return isPending(operation)
        ? this.resume(operation.operationId)
        : operation;
    });
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  private async resume(operationId: string) {
    let entry = this.requireEntry(operationId);
    if (entry.phase === "registry-pending") {
      try {
        await this.registry.migrateOwner(
          entry.fromStableWorkspaceOwnerId,
          entry.toStableWorkspaceOwnerId
        );
      } catch (cause) {
        await this.settleFailure(operationId, "registry-pending", cause);
        throw cause;
      }
      entry = await this.update(operationId, "history-pending", null);
    }
    if (entry.phase === "history-pending") {
      try {
        await this.history.migrateOwner(
          entry.fromStableWorkspaceOwnerId,
          entry.toStableWorkspaceOwnerId
        );
      } catch (cause) {
        await this.settleFailure(operationId, "history-pending", cause);
        throw cause;
      }
      entry = await this.update(operationId, "complete", null);
    }
    return entry;
  }

  private settleFailure(
    operationId: string,
    pendingPhase: Extract<OwnerMigrationEntry["phase"], "registry-pending" | "history-pending">,
    cause: unknown
  ) {
    // 确定性冲突（migrateOwner 409）无法靠重试解决 —— 落到终态 failed，从此不再
    // 阻塞该 Project 的后续 rebind；瞬时 I/O 失败保留 pending 相位，等待重启自愈。
    const terminal = isDeterministicConflict(cause) ? "failed" : pendingPhase;
    return this.update(operationId, terminal, message(cause));
  }

  private requireEntry(operationId: string) {
    const entry = this.file
      .snapshot()
      .entries.find((candidate) => candidate.operationId === operationId);
    if (!entry) throw new Error("Design owner migration 不存在");
    return entry;
  }

  private update(
    operationId: string,
    phase: OwnerMigrationEntry["phase"],
    error: string | null
  ) {
    return this.file.mutate((state) => {
      const entry = state.entries.find(
        (candidate) => candidate.operationId === operationId
      );
      if (!entry) throw new Error("Design owner migration 不存在");
      entry.phase = phase;
      entry.error = error;
      entry.updatedAt = this.now();
      state.revision += 1;
      return entry;
    });
  }
}

const isPending = (entry: OwnerMigrationEntry) =>
  entry.phase === "registry-pending" || entry.phase === "history-pending";

// Registry 迁移是否已真正落地：history-pending 与 complete 都意味着 migrateOwner
// 已把 source 的 Registry 条目搬到 target，此时 source owner 才可被判退役。
const hasRegistryMoved = (entry: OwnerMigrationEntry) =>
  entry.phase === "history-pending" || entry.phase === "complete";

const isDeterministicConflict = (cause: unknown) =>
  !!cause &&
  typeof cause === "object" &&
  (cause as { status?: unknown }).status === 409;

const message = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, 3_500);

const ownerId = (projectId: string, capabilityId: string) =>
  `project-binding:${projectId}:${capabilityId}`;
