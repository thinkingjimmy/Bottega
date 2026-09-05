/**
 * [INPUT]: Depends on persistence/durable-json durableReplaceFile for fsync-backed publication, node:fs/promises for reads and the v1 backup, node:crypto identity/digest, persistence/serial-queue, and intent-types current/legacy schemas, claims, and hashes
 * [OUTPUT]: Provides LifecycleIntentStore with safe v1-to-v2 terminal-install migration, CRUD/recovery/compaction operations, and LifecycleJournalCorruptError
 * [POS]: Owns userData/lifecycle/intents.json; completed legacy install intents migrate to tombstones while pending legacy authority and damaged or post-history-missing journals stay fail-closed
 */

import { createHash, randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { durableReplaceFile } from "../persistence/durable-json";
import { SerialQueue } from "../persistence/serial-queue";
import {
  INTENT_PHASES,
  INTENT_INPUT_SCHEMAS,
  PROPOSED_PHASE,
  assertFileInvariants,
  claimsOf,
  intentTombstoneSchema,
  legacyLifecycleIntentSchema,
  lifecycleIntentSchema,
  stableInputHash,
  type IntentTombstone,
  type LegacyLifecycleIntent,
  type LifecycleIntent,
  type LifecycleKind,
} from "./intent-types";

const FILE_SCHEMA = z
  .object({
    schemaVersion: z.literal(2),
    intents: z.array(lifecycleIntentSchema),
    tombstones: z.array(intentTombstoneSchema),
  })
  .strict();
type FileState = z.infer<typeof FILE_SCHEMA>;

const LEGACY_FILE_SCHEMA = z
  .object({
    schemaVersion: z.literal(1),
    intents: z.array(legacyLifecycleIntentSchema),
    tombstones: z.array(intentTombstoneSchema),
  })
  .strict();
type LegacyFileState = z.infer<typeof LEGACY_FILE_SCHEMA>;

/** 终态完整条目保留窗口,过后压缩为墓碑(墓碑永久保留,幂等查询恒可答)。 */
export const TERMINAL_RETENTION_MS = 72 * 60 * 60 * 1000;

/** journal 不可读/失踪/内部失稳:一切 lifecycle 操作被锁存阻断,不自动隔离清空(fail-closed)。 */
export class LifecycleJournalCorruptError extends Error {
  constructor(readonly filePath: string, cause: unknown) {
    super(
      `lifecycle 事务日志损坏或不可读(${filePath});为避免误判外部副作用(远端仓库/Base 迁移/删除进行中),生命周期操作已阻断,需人工处置`
    );
    this.cause = cause;
  }
}

export class IntentConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type IntentLookup =
  | { state: "absent" }
  | { state: "pending"; intent: LifecycleIntent }
  | {
      state: "settled";
      status: "done" | "rolled-back";
      receipt?: Record<string, unknown>;
      error?: { code: string; message: string };
      intentId: string;
    };

export class LifecycleIntentStore {
  private readonly queue = new SerialQueue();
  private readonly filePath: string;
  /** 历史标记与 journal 分离存放(R8:同目录会被整体删除而伪装首装)。 */
  private readonly seedPath: string;
  private state: FileState | null = null;
  private corrupt: LifecycleJournalCorruptError | null = null;

  constructor(
    userData: string,
    private readonly now: () => number = () => Date.now()
  ) {
    this.filePath = join(userData, "lifecycle", "intents.json");
    this.seedPath = join(userData, "lifecycle.seed");
  }

  async initialize(): Promise<void> {
    await this.queue.enqueue(async () => {
      try {
        const raw = await readFile(this.filePath, "utf8");
        const decoded = decodeFileState(JSON.parse(raw));
        assertFileInvariants(decoded.state.intents, decoded.state.tombstones);
        this.state = decoded.state;
        if (decoded.migrated) {
          await this.backupV1(raw);
          await this.persist();
        }
      } catch (cause) {
        if (isEnoent(cause)) {
          /* R7/P0-6a + R8:首装判据 = journal 目录之外的 seed 标记——
           * journal(乃至整个 lifecycle/ 目录)失踪而 seed 仍在,即历史
           * 证据被删,fail-closed;seed 也不存在才允许播种空 journal。 */
          const seeded = await access(this.seedPath).then(
            () => true,
            () => false
          );
          if (!seeded) {
            this.state = { schemaVersion: 2, intents: [], tombstones: [] };
            await this.persist();
            await writeFile(this.seedPath, `${this.now()}\n`, { mode: 0o600 });
            return;
          }
        }
        this.lockCorrupt(cause);
      }
    });
  }

  /** journal 阻断态查询:admission/conversation/reconciliation 的 fail-closed 对外面。 */
  isBlocked(): LifecycleJournalCorruptError | null {
    return this.corrupt;
  }

  /**
   * (kind, requestId) 幂等入口:absent 才允许新建;pending 返回既有 intent 续跑;
   * settled(含墓碑)原样返回终态与结构化 error。inputHash 失配抛冲突(键复用)。
   */
  async findByRequest(
    kind: LifecycleKind,
    requestId: string,
    inputHash: string
  ): Promise<IntentLookup> {
    return this.queue.enqueue(async () =>
      this.lookupLocked(kind, requestId, inputHash)
    );
  }

  /**
   * 原子创建顶层 intent:create 是 (kind, requestId) 的唯一线性化点;
   * `allocate` 在唯一性确认之后、构造之前于队列内执行——恰好调用一次
   * (R7/P1-8),其产物进入不可变 claims 与 recoveryState 初值。
   * phase 恒从 "proposed" 起步,准入推进由 AdmissionGate 在仲裁后执行(R7/P0-1)。
   */
  async create(input: {
    kind: LifecycleKind;
    requestId: string;
    input: Record<string, unknown>;
    allocate?: () => Record<string, unknown>;
  }): Promise<{ created: boolean; intent: LifecycleIntent }> {
    return this.queue.enqueue(async () => {
      const state = this.require();
      const hash = stableInputHash(input.input);
      const looked = this.lookupLocked(input.kind, input.requestId, hash);
      if (looked.state === "pending") {
        return { created: false, intent: looked.intent };
      }
      if (looked.state === "settled") {
        throw new IntentConflictError(
          `(${input.kind}, ${input.requestId}) 已终结;重试须换新 requestId`
        );
      }
      const allocated = input.allocate?.() ?? {};
      const intent = this.buildIntent(
        input.kind,
        input.requestId,
        input.input,
        hash,
        allocated,
        undefined
      );
      await this.commit((s0) => {
        s0.intents.push(intent);
      });
      void state;
      return { created: true, intent: structuredClone(intent) };
    });
  }

  /**
   * 父在 gate 持有期间原子创建子 intent(契约 R5/P0-2 三合一):同一次落盘完成
   * 「父 recoveryState 链接 + 子条目 + 子 parentIntentId」。链接值失配视为
   * linkKey 被挪用(冲突),引用悬空视为 journal 失稳(锁存阻断,R7/P0-6b);
   * 子同样受 (kind, requestId) 全局唯一约束(R7/P1-9)。
   */
  async createChild(input: {
    parentIntentId: string;
    linkKey: string;
    kind: LifecycleKind;
    requestId: string;
    input: Record<string, unknown>;
  }): Promise<LifecycleIntent> {
    return this.queue.enqueue(async () => {
      const state = this.require();
      const parent = state.intents.find(
        (i) => i.intentId === input.parentIntentId && !i.terminal
      );
      if (!parent) {
        throw new IntentConflictError(
          `父 intent ${input.parentIntentId} 不存在或已终结`
        );
      }
      const linked = parent.recoveryState[input.linkKey];
      const incomingHash = stableInputHash(input.input);
      if (typeof linked === "string") {
        const child = state.intents.find((i) => i.intentId === linked);
        if (
          child &&
          child.parentIntentId === parent.intentId &&
          child.kind === input.kind &&
          child.requestId === input.requestId
        ) {
          assertSameHash(child.inputHash, incomingHash, child.kind, child.requestId);
          return structuredClone(child);
        }
        if (child) {
          throw new IntentConflictError(
            `父 ${parent.intentId} 的 ${input.linkKey} 已链接到不同子事务`
          );
        }
        const corrupt = this.lockCorrupt(
          new Error(`父 ${parent.intentId} 引用的子 ${linked} 不存在`)
        );
        throw corrupt;
      }
      const dup = this.lookupLocked(input.kind, input.requestId, incomingHash);
      if (dup.state !== "absent") {
        throw new IntentConflictError(
          `(${input.kind}, ${input.requestId}) 已存在,child 不得复用请求键`
        );
      }
      const child = this.buildIntent(
        input.kind,
        input.requestId,
        input.input,
        incomingHash,
        {},
        parent.intentId
      );
      /* R8 闭包完整性:子的资源占用必须 ⊆ 父闭包,否则子在父锁外操作未持资源。 */
      const parentClaims = new Set(parent.claims);
      const escaped = child.claims.find((c) => !parentClaims.has(c));
      if (escaped) {
        throw new IntentConflictError(
          `child claim ${escaped} 溢出父闭包(${parent.claims.join("+")})——父创建时必须冻结完整闭包`
        );
      }
      await this.commit((s0) => {
        const p0 = s0.intents.find((i) => i.intentId === parent.intentId)!;
        p0.recoveryState = {
          ...p0.recoveryState,
          [input.linkKey]: child.intentId,
        };
        p0.updatedAt = this.now();
        s0.intents.push(child);
      });
      return structuredClone(child);
    });
  }

  /** phase 单调推进 + recoveryState 合并,同一次原子写;claims/input 不可触碰。 */
  async advance(
    intentId: string,
    phase: string,
    recoveryPatch?: Record<string, unknown>
  ): Promise<LifecycleIntent> {
    return this.queue.enqueue(async () => {
      const state = this.require();
      const intent = state.intents.find((i) => i.intentId === intentId);
      if (!intent || intent.terminal) {
        throw new IntentConflictError(`intent ${intentId} 不存在或已终结`);
      }
      const phases: readonly string[] = INTENT_PHASES[intent.kind];
      const from = phases.indexOf(intent.phase);
      const to = phases.indexOf(phase);
      if (to < 0 || to < from) {
        throw new IntentConflictError(
          `kind ${intent.kind} 不允许 phase ${intent.phase} → ${phase}`
        );
      }
      await this.commit((s0) => {
        const i0 = s0.intents.find((i) => i.intentId === intentId)!;
        i0.phase = phase;
        if (recoveryPatch) {
          i0.recoveryState = { ...i0.recoveryState, ...recoveryPatch };
        }
        i0.updatedAt = this.now();
      });
      return structuredClone(this.require().intents.find((i) => i.intentId === intentId)!);
    });
  }

  async settle(
    intentId: string,
    terminal:
      | { status: "done"; receipt?: Record<string, unknown> }
      | {
          status: "rolled-back";
          error: { code: string; message: string };
          receipt?: Record<string, unknown>;
        }
  ): Promise<LifecycleIntent> {
    return this.queue.enqueue(async () => {
      const state = this.require();
      const intent = state.intents.find((i) => i.intentId === intentId);
      if (!intent) throw new IntentConflictError(`intent ${intentId} 不存在`);
      if (intent.terminal) return structuredClone(intent);
      const livingChild = state.intents.find(
        (i) => i.parentIntentId === intentId && !i.terminal
      );
      if (livingChild) {
        throw new IntentConflictError(
          `intent ${intentId} 仍有进行中的子事务 ${livingChild.intentId},父必须后于子终结(R8)`
        );
      }
      await this.commit((s0) => {
        const i0 = s0.intents.find((i) => i.intentId === intentId)!;
        i0.terminal = { ...terminal, settledAt: this.now() };
        i0.updatedAt = this.now();
      });
      return structuredClone(this.require().intents.find((i) => i.intentId === intentId)!);
    });
  }

  /** admission 互斥查询:claims 有交集的 pending 顶层 intent(子 intent 不参与)。 */
  async pendingByClaims(claims: readonly string[]): Promise<LifecycleIntent[]> {
    return this.queue.enqueue(async () => {
      const state = this.require();
      const wanted = new Set(claims);
      return state.intents
        .filter(
          (i) =>
            !i.terminal &&
            i.parentIntentId === undefined &&
            i.claims.some((c) => wanted.has(c))
        )
        .map((value) => structuredClone(value));
    });
  }

  async getById(intentId: string): Promise<LifecycleIntent | null> {
    return this.queue.enqueue(async () => {
      const found = this.require().intents.find((i) => i.intentId === intentId);
      return found ? structuredClone(found) : null;
    });
  }

  async listPending(): Promise<LifecycleIntent[]> {
    return this.queue.enqueue(async () => {
      const state = this.require();
      return state.intents.filter((i) => !i.terminal).map((value) => structuredClone(value));
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  /**
   * TTL 压缩:超窗终态压缩为墓碑;**被 pending 父引用的 child 不压缩**
   * (R7/P1-9:父的恢复要按链接找到子的终态);全部变更在一次 commit 内,
   * persist 失败无重复墓碑(R7/P1-10)。
   */
  async compactTerminals(): Promise<number> {
    return this.queue.enqueue(async () => {
      const state = this.require();
      const cutoff = this.now() - TERMINAL_RETENTION_MS;
      const referenced = new Set<string>();
      for (const intent of state.intents) {
        if (intent.terminal) continue;
        for (const value of Object.values(intent.recoveryState)) {
          if (typeof value === "string") referenced.add(value);
        }
      }
      const doomed = state.intents.filter(
        (i) =>
          i.terminal &&
          i.terminal.settledAt <= cutoff &&
          !referenced.has(i.intentId)
      );
      if (doomed.length === 0) return 0;
      const doomedIds = new Set(doomed.map((i) => i.intentId));
      await this.commit((s0) => {
        for (const intent of s0.intents) {
          if (!doomedIds.has(intent.intentId)) continue;
          s0.tombstones.push(tombstoneOf(intent));
        }
        s0.intents = s0.intents.filter((i) => !doomedIds.has(i.intentId));
      });
      return doomed.length;
    });
  }

  /* ── 内部 ── */

  private lookupLocked(
    kind: LifecycleKind,
    requestId: string,
    inputHash: string
  ): IntentLookup {
    const state = this.require();
    const live = state.intents.find(
      (intent) => intent.kind === kind && intent.requestId === requestId
    );
    if (live) {
      assertSameHash(live.inputHash, inputHash, kind, requestId);
      if (live.terminal) {
        return {
          state: "settled",
          status: live.terminal.status,
          receipt: live.terminal.receipt,
          error: live.terminal.error,
          intentId: live.intentId,
        };
      }
      return { state: "pending", intent: structuredClone(live) };
    }
    const tomb = state.tombstones.find(
      (t) => t.kind === kind && t.requestId === requestId
    );
    if (tomb) {
      assertSameHash(tomb.inputHash, inputHash, kind, requestId);
      return {
        state: "settled",
        status: tomb.status,
        receipt: tomb.receipt,
        error: tomb.error,
        intentId: tomb.intentId,
      };
    }
    return { state: "absent" };
  }

  private buildIntent(
    kind: LifecycleKind,
    requestId: string,
    input: Record<string, unknown>,
    hash: string,
    allocated: Record<string, unknown>,
    parentIntentId: string | undefined
  ): LifecycleIntent {
    const at = this.now();
    const intent: LifecycleIntent = {
      intentId: randomUUID(),
      ...(parentIntentId ? { parentIntentId } : {}),
      requestId,
      kind,
      input,
      inputHash: hash,
      claims: claimsOf(kind, input, allocated),
      allocated,
      recoveryState: {},
      phase: PROPOSED_PHASE,
      createdAt: at,
      updatedAt: at,
    };
    return lifecycleIntentSchema.parse(intent);
  }

  private lockCorrupt(cause: unknown): LifecycleJournalCorruptError {
    const error =
      cause instanceof LifecycleJournalCorruptError
        ? cause
        : new LifecycleJournalCorruptError(this.filePath, cause);
    this.corrupt = error;
    return error;
  }

  private require(): FileState {
    if (this.corrupt) throw this.corrupt;
    if (!this.state) throw new Error("LifecycleIntentStore 未初始化");
    return this.state;
  }

  /** mutation 统一提交点:persist 失败回滚内存快照,杜绝半开态。 */
  private async commit(mutate: (state: FileState) => void): Promise<void> {
    const state = this.require();
    const snapshot = structuredClone(state);
    try {
      mutate(state);
      await this.persist();
    } catch (cause) {
      this.state = snapshot;
      throw cause;
    }
  }

  /** 掉电语义由 durableReplaceFile 承担:临时文件与父目录都 fsync 后才算提交。 */
  private async persist(): Promise<void> {
    const state = this.require();
    await durableReplaceFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  private async backupV1(raw: string): Promise<void> {
    const digest = createHash("sha256").update(raw).digest("hex").slice(0, 12);
    const backup = `${this.filePath}.schema-v1-${digest}.bak`;
    try {
      await writeFile(backup, raw, { flag: "wx", mode: 0o600 });
    } catch (cause) {
      if (!hasCode(cause, "EEXIST")) throw cause;
    }
  }
}

function isEnoent(cause: unknown): boolean {
  return hasCode(cause, "ENOENT");
}

function hasCode(cause: unknown, code: string): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === code
  );
}

function decodeFileState(input: unknown): {
  state: FileState;
  migrated: boolean;
} {
  const header = z
    .object({ schemaVersion: z.number().int() })
    .passthrough()
    .parse(input);
  if (header.schemaVersion === 2) {
    return { state: FILE_SCHEMA.parse(input), migrated: false };
  }
  if (header.schemaVersion !== 1) {
    throw new Error(`lifecycle journal schemaVersion ${header.schemaVersion} 不受支持`);
  }
  return { state: migrateV1(LEGACY_FILE_SCHEMA.parse(input)), migrated: true };
}

function migrateV1(legacy: LegacyFileState): FileState {
  const referenced = pendingReferences(legacy.intents);
  const intents: LifecycleIntent[] = [];
  const tombstones = [...legacy.tombstones];
  for (const intent of legacy.intents) {
    const current = lifecycleIntentSchema.safeParse(intent);
    if (current.success) {
      intents.push(current.data);
      continue;
    }
    if (!canCompactLegacyInstall(intent, referenced)) {
      throw new Error(
        `lifecycle v1 intent ${intent.intentId} 不能在不推测授权的前提下安全迁移`
      );
    }
    tombstones.push(tombstoneOf(intent));
  }
  return FILE_SCHEMA.parse({ schemaVersion: 2, intents, tombstones });
}

function pendingReferences(
  intents: readonly LegacyLifecycleIntent[]
): Set<string> {
  return new Set(
    intents
      .filter((intent) => !intent.terminal)
      .flatMap((intent) => Object.values(intent.recoveryState))
      .filter((value): value is string => typeof value === "string")
  );
}

function canCompactLegacyInstall(
  intent: LegacyLifecycleIntent,
  referenced: ReadonlySet<string>
): boolean {
  if (!intent.terminal || referenced.has(intent.intentId)) return false;
  if (intent.kind !== "base-import" && intent.kind !== "preset-install") {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(intent.input, "authorization")) {
    return false;
  }
  const candidate = { ...intent.input };
  if (Object.prototype.hasOwnProperty.call(candidate, "consentIntent")) {
    if (typeof candidate.consentIntent !== "boolean") return false;
    delete candidate.consentIntent;
  }
  candidate.authorization = {
    scope: "studio-only",
    decision: "approve-requested",
  };
  return INTENT_INPUT_SCHEMAS[intent.kind].safeParse(candidate).success;
}

function tombstoneOf(intent: LegacyLifecycleIntent): IntentTombstone {
  if (!intent.terminal) throw new Error(`intent ${intent.intentId} 未终结`);
  return intentTombstoneSchema.parse({
    kind: intent.kind,
    requestId: intent.requestId,
    intentId: intent.intentId,
    inputHash: intent.inputHash,
    status: intent.terminal.status,
    ...(intent.terminal.receipt ? { receipt: intent.terminal.receipt } : {}),
    ...(intent.terminal.error ? { error: intent.terminal.error } : {}),
  });
}

function assertSameHash(
  stored: string,
  incoming: string,
  kind: string,
  requestId: string
): void {
  if (stored !== incoming) {
    throw new IntentConflictError(
      `(${kind}, ${requestId}) 已绑定不同入参;requestId 不可复用于不同意图`
    );
  }
}
