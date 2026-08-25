/**
 * [INPUT]: Depends on DurableJson, package digest/copy, Node fs/path/crypto and the exact agent/action/digest field
 * [OUTPUT]: Provides exact authority, final stage digest, proof, backup, explicit drift recovery, and so on
 * [POS]: The side effects of skills-management HOME files durable single writer; Byte, rename, fact, binding Submit three boundaries, and close them separately
 */

import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type {
  ManagedSkillAction,
  ManagedSkillAgent,
} from "../../../shared/unified-skills-ipc";
import { DurableJson } from "../persistence/durable-json";
import {
  copySkillDirectory,
  digestSkillFolder,
  observeSkillFolderDigest,
  type SkillFolderDigestObservation,
} from "./package";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const agentSchema = z.enum(["codex", "claude", "kimi", "opencode"]);
const actionSchema = z.enum(["project", "takeover", "remove", "recover"]);
const authoritySchema = z.object({
  authorityToken: z.string().min(1),
  previewId: z.string().min(1),
  agent: agentSchema,
  component: z.string().min(1),
  target: z.string().min(1),
  digest: digestSchema,
  action: actionSchema,
  expiresAt: z.number().int().nonnegative(),
  consumedAt: z.number().int().nonnegative().nullable(),
}).strict();
const bindingSchema = z.object({
  bindingId: z.string().min(1),
  libraryId: z.string().min(1),
  agent: agentSchema,
  targetPath: z.string().min(1),
  digest: digestSchema,
  mode: z.enum(["projection", "takeover"]),
  backupPath: z.string().min(1).nullable(),
  state: z.enum(["active", "foreign", "revoked"]),
  operationId: z.string().min(1),
}).strict();
const operationSchema = z.object({
  operationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  action: actionSchema,
  libraryId: z.string().min(1),
  agent: agentSchema,
  component: z.string().min(1),
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
  digest: digestSchema,
  mode: z.enum(["projection", "takeover"]),
  stagePath: z.string().min(1),
  backupPath: z.string().min(1),
  trashPath: z.string().min(1),
  phase: z.enum(["intent", "staged", "source-backed-up", "renamed", "managed-removed", "restored", "committed", "failed"]),
  bindingId: z.string().min(1).nullable(),
  error: z.string().nullable(),
}).strict();
const storeSchema = z.object({
  schemaVersion: z.literal(1),
  authorities: z.array(authoritySchema),
  bindings: z.array(bindingSchema),
  operations: z.array(operationSchema),
}).strict();

type Store = z.infer<typeof storeSchema>;
export type ManagedSkillProjectionBinding = z.infer<typeof bindingSchema>;
export type ManagedSkillProjectionOperation = z.infer<typeof operationSchema>;

export type ProjectionAuthorityFields = Readonly<{
  previewId: string;
  agent: ManagedSkillAgent;
  component: string;
  target: string;
  digest: `sha256:${string}`;
  action: ManagedSkillAction;
}>;

export type ProjectionOperationInput = ProjectionAuthorityFields & Readonly<{
  authorityToken: string;
  idempotencyKey: string;
  libraryId: string;
  sourcePath: string;
  mode: "projection" | "takeover";
}>;

export type ManagedSkillProjectionFaults = Readonly<{
  afterStageCopied?: (operationId: string, stagePath: string) => void | Promise<void>;
  afterStaged?: (operationId: string) => void | Promise<void>;
  afterTakeoverBackupRename?: (operationId: string, backupPath: string) => void | Promise<void>;
  afterFirstRename?: (operationId: string) => void | Promise<void>;
  afterRenamed?: (operationId: string) => void | Promise<void>;
  afterRestoreRename?: (operationId: string) => void | Promise<void>;
}>;

const AUTHORITY_TTL_MS = 5 * 60_000;

export class ManagedSkillProjectionStore {
  private readonly file: DurableJson<Store>;

  constructor(
    userData: string,
    private readonly faults: ManagedSkillProjectionFaults = {}
  ) {
    this.file = new DurableJson(join(userData, "unified-skills", "projections.json"), storeSchema, () => ({
      schemaVersion: 1,
      authorities: [],
      bindings: [],
      operations: [],
    }));
  }

  async initialize() {
    await this.file.initialize();
    await this.reconcile();
  }

  snapshot() {
    return this.file.snapshot();
  }

  activeBinding(libraryId: string, agent: ManagedSkillAgent) {
    return this.file.snapshot().bindings.find((item) =>
      item.libraryId === libraryId && item.agent === agent && item.state === "active"
    ) ?? null;
  }

  trackedBinding(libraryId: string, agent: ManagedSkillAgent) {
    const bindings = this.file.snapshot().bindings.filter((item) =>
      item.libraryId === libraryId && item.agent === agent && item.state !== "revoked"
    );
    return bindings.find((item) => item.state === "active") ?? bindings.at(-1) ?? null;
  }

  markForeign(bindingId: string) {
    return this.file.mutate((state) => {
      const binding = state.bindings.find((item) => item.bindingId === bindingId);
      if (!binding || binding.state !== "active") return false;
      binding.state = "foreign";
      return true;
    });
  }

  authorize(fields: ProjectionAuthorityFields, now = Date.now()) {
    return this.file.mutate((state) => {
      expireAuthorities(state, now);
      const authority = {
        ...fields,
        authorityToken: randomUUID(),
        expiresAt: now + AUTHORITY_TTL_MS,
        consumedAt: null,
      };
      state.authorities.push(authority);
      return { authorityToken: authority.authorityToken, expiresAt: authority.expiresAt };
    });
  }

  async execute(input: ProjectionOperationInput, now = Date.now()) {
    const operation = await this.stageIntent(input, now);
    if (operation.phase !== "committed") await this.resume(operation.operationId);
    return this.requireOperation(operation.operationId);
  }

  async executeBatch(inputs: readonly ProjectionOperationInput[], now = Date.now()) {
    if (!inputs.length || inputs.length > 64) throw new Error("批量投影必须包含 1–64 项");
    const keys = new Set<string>();
    const state = this.file.snapshot();
    for (const input of inputs) {
      if (keys.has(input.target)) throw conflict("批量操作包含重复目标");
      keys.add(input.target);
      this.assertBatchAuthority(state, input, now);
      const bindings = state.bindings.filter((item) =>
        item.libraryId === input.libraryId && item.agent === input.agent && item.state !== "revoked"
      );
      const active = bindings.find((item) => item.state === "active");
      const foreign = bindings.find((item) => item.state === "foreign");
      if (input.action === "remove" && !active) throw conflict("批量 Skill 没有可移除的受管投影");
      if (input.action === "recover" && !foreign) throw conflict("批量 Skill 没有待恢复的漂移 binding");
      if (["project", "takeover"].includes(input.action) && (foreign
        || active && (active.targetPath !== input.target || active.digest !== input.digest))) {
        throw conflict("批量 Skill 存在未解决的 binding");
      }
      if (["project", "takeover"].includes(input.action) && await digestSkillFolder(input.sourcePath) !== input.digest) {
        throw conflict(`批量来源已变化：${basename(input.sourcePath)}`);
      }
      if (["project", "takeover"].includes(input.action) && await exists(input.target)) {
        const binding = this.activeBinding(input.libraryId, input.agent);
        const sameManaged = binding?.targetPath === input.target && binding.digest === input.digest;
        const validTakeover = input.action === "takeover" && await digestSkillFolder(input.target) === input.digest;
        if (!sameManaged && !validTakeover) throw conflict(`投影目标已被占用：${basename(input.target)}`);
      }
    }
    const results = [];
    for (const input of inputs) results.push(await this.execute(input, now));
    return results;
  }

  async reconcile() {
    for (const operation of this.file.snapshot().operations) {
      if (!["committed", "failed"].includes(operation.phase)) {
        /* resume 是唯一失败分类点；reconcile 只驱动，不得把可恢复中间态二次终结。 */
        await this.resume(operation.operationId).catch(() => undefined);
      }
    }
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  private stageIntent(input: ProjectionOperationInput, now: number) {
    return this.file.mutate((state) => {
      const replay = state.operations.find((item) => item.idempotencyKey === input.idempotencyKey);
      if (replay) {
        assertReplayMatches(replay, input);
        return replay;
      }
      expireAuthorities(state, now);
      const authority = state.authorities.find((item) => item.authorityToken === input.authorityToken);
      if (!authority || authority.consumedAt !== null || authority.expiresAt <= now) {
        throw conflict("Skill authority 已失效，请重新确认");
      }
      for (const key of ["previewId", "agent", "component", "target", "digest", "action"] as const) {
        if (authority[key] !== input[key]) throw conflict(`Skill authority 与 ${key} 不匹配`);
      }
      const bindings = state.bindings.filter((item) =>
        item.libraryId === input.libraryId && item.agent === input.agent && item.state !== "revoked"
      );
      const active = bindings.find((item) => item.state === "active");
      const foreign = bindings.filter((item) => item.state === "foreign").at(-1);
      const existing = input.action === "remove" ? active : input.action === "recover" ? foreign : null;
      if (input.action === "remove" && !active) throw conflict("Skill 没有可移除的受管投影");
      if (input.action === "recover" && !foreign) throw conflict("Skill 没有待恢复的漂移 binding");
      if (["project", "takeover"].includes(input.action) && (active || foreign)) {
        if (active?.targetPath === input.target && active.digest === input.digest) {
          authority.consumedAt = now;
          const committed = committedReplay(input, active);
          state.operations.push(committed);
          return committed;
        }
        throw conflict(foreign ? "该 Agent 有待恢复的漂移 binding" : "该 Agent 已有另一条受管投影");
      }
      authority.consumedAt = now;
      const operationId = randomUUID();
      const sibling = dirname(input.target);
      const privateRoot = join(sibling, ".ai-chat-skills-state");
      const operation: ManagedSkillProjectionOperation = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        action: input.action,
        libraryId: input.libraryId,
        agent: input.agent,
        component: input.component,
        sourcePath: input.sourcePath,
        targetPath: input.target,
        digest: input.digest,
        mode: input.mode,
        stagePath: join(privateRoot, `${operationId}.stage`),
        backupPath: existing?.backupPath ?? join(privateRoot, `${operationId}.backup`),
        trashPath: join(privateRoot, `${operationId}.trash`),
        phase: "intent",
        bindingId: existing?.bindingId ?? null,
        error: null,
      };
      state.operations.push(operation);
      return operation;
    });
  }

  private async resume(operationId: string) {
    let operation = this.requireOperation(operationId);
    try {
      if (operation.action === "remove") {
        await this.resumeRemoval(operation);
        return;
      }
      if (operation.action === "recover") {
        await this.resumeRecovery(operation);
        return;
      }
      await mkdir(dirname(operation.targetPath), { recursive: true, mode: 0o700 });
      await mkdir(dirname(operation.stagePath), { recursive: true, mode: 0o700 });
      if (operation.phase === "intent") {
        if (await exists(operation.stagePath)) await rm(operation.stagePath, { recursive: true, force: true });
        await copySkillDirectory(
          operation.sourcePath,
          operation.stagePath,
          operation.digest as `sha256:${string}`
        );
        await this.faults.afterStageCopied?.(operationId, operation.stagePath);
        if (await digestSkillFolder(operation.stagePath) !== operation.digest) {
          throw conflict("投影暂存字节与 authority digest 不一致");
        }
        operation = await this.advance(operationId, "staged");
        await this.faults.afterStaged?.(operationId);
      }
      if (operation.phase === "staged" && operation.action === "takeover") {
        if (await exists(operation.backupPath)) {
          await this.verifyBackupOrRollback(operation);
          operation = await this.advance(operationId, "source-backed-up");
        } else {
          const digest = await digestSkillFolder(operation.targetPath);
          if (digest !== operation.digest) throw conflict("接管目标在授权后已变化");
          await rename(operation.targetPath, operation.backupPath);
          await this.faults.afterTakeoverBackupRename?.(operationId, operation.backupPath);
          await this.verifyBackupOrRollback(operation);
          operation = await this.advance(operationId, "source-backed-up");
          await this.faults.afterFirstRename?.(operationId);
        }
      }
      if (operation.phase === "staged" || operation.phase === "source-backed-up") {
        if (await exists(operation.targetPath)) {
          if (await exists(operation.stagePath)) {
            throw conflict("投影目标在 stage 后被占用，产品不会仅凭相同 digest 取得所有权");
          }
          const digest = await digestSkillFolder(operation.targetPath);
          if (digest !== operation.digest) throw conflict("投影目标已被占用");
          operation = await this.advance(operationId, "renamed");
        } else {
          await rename(operation.stagePath, operation.targetPath);
          operation = await this.advance(operationId, "renamed");
          await this.faults.afterRenamed?.(operationId);
        }
      }
      if (operation.phase === "renamed") await this.commitProjection(operation);
    } catch (cause) {
      const failed = this.requireOperation(operationId);
      const backup = await observeSkillFolderDigest(failed.backupPath);
      const backupInFlight = failed.action === "takeover" && backup.kind !== "missing";
      const restoredInFlight = failed.action === "recover"
        && failed.mode === "takeover"
        && backup.kind === "missing"
        && matches(await observeSkillFolderDigest(failed.targetPath), failed.digest);
      if (["intent", "staged"].includes(failed.phase) && !backupInFlight) {
        await rm(failed.stagePath, { recursive: true, force: true }).catch(() => undefined);
      }
      if (backupInFlight || restoredInFlight) await this.recordRecoverableError(operationId, cause);
      else await this.fail(operationId, cause);
      throw cause;
    }
  }

  private async verifyBackupOrRollback(operation: ManagedSkillProjectionOperation) {
    const observed = await observeSkillFolderDigest(operation.backupPath);
    if (matches(observed, operation.digest)) return;
    if (observed.kind === "unavailable") {
      throw conflict("接管备份暂时无法校验，等待重试");
    }
    if (await exists(operation.targetPath)) {
      throw conflict("接管目标在 rename 时变化，备份等待安全回滚");
    }
    if (observed.kind === "missing") throw conflict("接管备份缺失，拒绝继续");
    await rename(operation.backupPath, operation.targetPath);
    throw conflict("接管目标在 rename 时变化，原件已恢复");
  }

  private async resumeRemoval(initial: ManagedSkillProjectionOperation) {
    let operation = initial;
    const binding = this.file.snapshot().bindings.find((item) => item.bindingId === operation.bindingId);
    if (!binding || binding.state !== "active") {
      await this.advance(operation.operationId, "committed");
      return;
    }
    if (operation.phase === "intent") {
      if (binding.mode === "takeover") await this.assertRestorableBackup(binding);
      const target = await observeSkillFolderDigest(binding.targetPath);
      if (target.kind === "unavailable") throw conflict("受管投影暂时无法校验，未修改任何字节");
      if (!matchesOrMissing(target, binding.digest)) {
        await this.markRemovalForeign(operation, binding.bindingId);
        throw conflict("受管投影已漂移，产品不会删除它");
      }
      if (target.kind === "present") {
        await rename(binding.targetPath, operation.trashPath);
      }
      operation = await this.advance(operation.operationId, "managed-removed");
      await this.faults.afterFirstRename?.(operation.operationId);
    }
    if (operation.phase === "managed-removed" && binding.mode === "takeover") {
      if (!binding.backupPath) throw new Error("接管备份路径缺失，拒绝冒充已恢复");
      const backup = await observeSkillFolderDigest(binding.backupPath);
      if (backup.kind === "unavailable") throw conflict("接管备份暂时无法校验，等待重试");
      if (backup.kind === "missing") {
        const restored = await observeSkillFolderDigest(binding.targetPath);
        const trash = await observeSkillFolderDigest(operation.trashPath);
        if (!matches(restored, binding.digest) || !matches(trash, binding.digest)) {
          throw new Error("接管备份缺失，拒绝冒充已恢复");
        }
        operation = await this.advance(operation.operationId, "restored");
      } else {
        if (!matches(backup, binding.digest)) throw conflict("接管备份内容已变化，拒绝恢复");
        const target = await observeSkillFolderDigest(binding.targetPath);
        if (target.kind === "unavailable") throw conflict("恢复目标暂时无法校验，等待重试");
        if (target.kind !== "missing") throw conflict("恢复原件时目标被重新占用");
        await rename(binding.backupPath, binding.targetPath);
        await this.faults.afterRestoreRename?.(operation.operationId);
        if (!matches(await observeSkillFolderDigest(binding.targetPath), binding.digest)) {
          throw conflict("恢复后的原件字节与备份账本不一致");
        }
        operation = await this.advance(operation.operationId, "restored");
        await this.faults.afterRenamed?.(operation.operationId);
      }
    }
    if (operation.phase === "restored" && binding.mode === "takeover") {
      if (!matches(await observeSkillFolderDigest(binding.targetPath), binding.digest)) {
        throw conflict("已恢复原件无法通过 digest 复核，拒绝提交");
      }
    }
    if (operation.phase === "managed-removed" || operation.phase === "restored") {
      await this.commitRevocation(operation, binding.bindingId);
      await rm(operation.trashPath, { recursive: true, force: true });
    }
  }

  private async resumeRecovery(initial: ManagedSkillProjectionOperation) {
    let operation = initial;
    const binding = this.file.snapshot().bindings.find((item) => item.bindingId === operation.bindingId);
    if (!binding || binding.state === "revoked") {
      await this.advance(operation.operationId, "committed");
      return;
    }
    if (binding.state !== "foreign") throw conflict("只有 foreign binding 可以进入恢复流程");
    if (binding.mode === "projection") {
      await this.commitRevocation(operation, binding.bindingId);
      return;
    }
    if (!binding.backupPath) throw new Error("接管备份路径缺失，拒绝恢复");
    if (operation.phase === "intent") {
      const backup = await observeSkillFolderDigest(binding.backupPath);
      if (backup.kind === "unavailable") throw conflict("接管备份暂时无法校验，等待重试");
      if (backup.kind === "missing") {
        if (!matches(await observeSkillFolderDigest(binding.targetPath), binding.digest)) {
          throw conflict("接管备份缺失且原件尚未恢复");
        }
      } else {
        if (!matches(backup, binding.digest)) throw conflict("接管备份内容已变化，拒绝恢复");
        const target = await observeSkillFolderDigest(binding.targetPath);
        if (target.kind === "unavailable") throw conflict("恢复目标暂时无法校验，等待重试");
        if (target.kind !== "missing") throw conflict("请先移走外部修改的 Skill，再恢复原件");
        await rename(binding.backupPath, binding.targetPath);
        await this.faults.afterRestoreRename?.(operation.operationId);
      }
      if (!matches(await observeSkillFolderDigest(binding.targetPath), binding.digest)) {
        throw conflict("恢复后的原件字节与备份账本不一致");
      }
      operation = await this.advance(operation.operationId, "restored");
    }
    if (operation.phase === "restored") {
      if (!matches(await observeSkillFolderDigest(binding.targetPath), binding.digest)) {
        throw conflict("已恢复原件无法通过 digest 复核，拒绝提交");
      }
      await this.commitRevocation(operation, binding.bindingId);
    }
  }

  private assertRestorableBackup(binding: ManagedSkillProjectionBinding) {
    if (!binding.backupPath) throw new Error("接管备份路径缺失，拒绝恢复");
    return observeSkillFolderDigest(binding.backupPath).then((observed) => {
      if (observed.kind === "unavailable") throw conflict("接管备份暂时无法校验，未修改受管投影");
      if (!matches(observed, binding.digest)) throw conflict("接管备份内容已变化，未修改受管投影");
    });
  }

  private markRemovalForeign(operation: ManagedSkillProjectionOperation, bindingId: string) {
    return this.file.mutate((state) => {
      state.bindings.find((item) => item.bindingId === bindingId)!.state = "foreign";
      const op = requireOperation(state, operation.operationId);
      op.phase = "failed";
      op.error = "受管投影已被外部修改，已转为 foreign；产品未删除任何字节";
    });
  }

  private commitRevocation(operation: ManagedSkillProjectionOperation, bindingId: string) {
    return this.file.mutate((state) => {
      const current = state.bindings.find((item) => item.bindingId === bindingId)!;
      current.state = "revoked";
      current.operationId = operation.operationId;
      requireOperation(state, operation.operationId).phase = "committed";
    });
  }

  private commitProjection(operation: ManagedSkillProjectionOperation) {
    return this.file.mutate((state) => {
      const op = requireOperation(state, operation.operationId);
      if (op.phase === "committed") return;
      const binding: ManagedSkillProjectionBinding = {
        bindingId: op.bindingId ?? randomUUID(),
        libraryId: op.libraryId,
        agent: op.agent,
        targetPath: op.targetPath,
        digest: op.digest,
        mode: op.mode,
        backupPath: op.mode === "takeover" ? op.backupPath : null,
        state: "active",
        operationId: op.operationId,
      };
      state.bindings.push(binding);
      op.bindingId = binding.bindingId;
      op.phase = "committed";
    });
  }

  private advance(operationId: string, phase: ManagedSkillProjectionOperation["phase"]) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state, operationId);
      operation.phase = phase;
      operation.error = null;
      return operation;
    });
  }

  private fail(operationId: string, cause: unknown) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state, operationId);
      /* 可恢复的 rename 中间态不能被抹成终态；启动 reconcile 还要沿事实续跑。 */
      if (["source-backed-up", "renamed", "managed-removed", "restored"].includes(operation.phase)) {
        operation.error = messageOf(cause);
        return;
      }
      operation.phase = "failed";
      operation.error = messageOf(cause);
    });
  }

  private recordRecoverableError(operationId: string, cause: unknown) {
    return this.file.mutate((state) => {
      requireOperation(state, operationId).error = messageOf(cause);
    });
  }

  private requireOperation(operationId: string) {
    const operation = this.file.snapshot().operations.find((item) => item.operationId === operationId);
    if (!operation) throw new Error("Skill projection operation 不存在");
    return operation;
  }

  private assertBatchAuthority(state: Store, input: ProjectionOperationInput, now: number) {
    const replay = state.operations.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (replay) {
      assertReplayMatches(replay, input);
      return;
    }
    const authority = state.authorities.find((item) => item.authorityToken === input.authorityToken);
    if (!authority || authority.consumedAt !== null || authority.expiresAt <= now) {
      throw conflict("批量 Skill authority 已失效，请重新确认");
    }
    for (const key of ["previewId", "agent", "component", "target", "digest", "action"] as const) {
      if (authority[key] !== input[key]) throw conflict(`批量 Skill authority 与 ${key} 不匹配`);
    }
  }
}

function committedReplay(input: ProjectionOperationInput, binding: ManagedSkillProjectionBinding) {
  const operationId = randomUUID();
  const privateRoot = join(dirname(input.target), ".ai-chat-skills-state");
  return {
    operationId,
    idempotencyKey: input.idempotencyKey,
    action: input.action,
    libraryId: input.libraryId,
    agent: input.agent,
    component: input.component,
    sourcePath: input.sourcePath,
    targetPath: input.target,
    digest: input.digest,
    mode: input.mode,
    stagePath: join(privateRoot, `${operationId}.stage`),
    backupPath: binding.backupPath ?? join(privateRoot, `${operationId}.backup`),
    trashPath: join(privateRoot, `${operationId}.trash`),
    phase: "committed" as const,
    bindingId: binding.bindingId,
    error: null,
  };
}

function requireOperation(state: Store, operationId: string) {
  const operation = state.operations.find((item) => item.operationId === operationId);
  if (!operation) throw new Error("Skill projection operation 不存在");
  return operation;
}

function assertReplayMatches(
  operation: ManagedSkillProjectionOperation,
  input: ProjectionOperationInput
) {
  for (const key of ["action", "libraryId", "agent", "component", "digest", "sourcePath"] as const) {
    if (operation[key] !== input[key]) throw conflict(`幂等键与 ${key} 不匹配`);
  }
  if (operation.targetPath !== input.target || operation.mode !== input.mode) {
    throw conflict("幂等键与 target/mode 不匹配");
  }
}

function expireAuthorities(state: Store, now: number) {
  state.authorities = state.authorities.filter((item) => item.consumedAt !== null || item.expiresAt > now);
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function matches(observed: SkillFolderDigestObservation, digest: string) {
  return observed.kind === "present" && observed.digest === digest;
}

function matchesOrMissing(observed: SkillFolderDigestObservation, digest: string) {
  return observed.kind === "missing" || matches(observed, digest);
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}
