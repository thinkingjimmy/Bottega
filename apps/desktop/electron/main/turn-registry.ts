/**
 * [INPUT]: Depends on shared turn reducer, Agent/chats agreement with conversation level SubagentRegistry; TurnOrigin in this file defines, agent/ just export
 * [OUTPUT]: Provides TurnRegistry lifecycle ownership, ordered projection, ProductFailure-aware terminals, subagent outcomes, steering fences, input leases, retry claims, event sequencing, tombstones, and drain
 * [POS]: The long lifecycle of the Electron main turns into a single truth source; No Electron dependence, only the IO and the release are responsible for bridge
 */

import { randomUUID } from "node:crypto";
import {
  applyDelta, applyItem, applyItemRemoved,
  createDraft, serializeDraft, type TurnDraft,
} from "../../shared/chat-turn-reducer";
import type {
  AgentBackendId,
  AgentApprovalRequest,
  AgentEvent,
  AgentEventBody,
  AgentTurnItem,
  AgentUserInputRequest,
  FailureKind,
  UsageLimitInfo,
  SessionRef,
  SessionServiceTierEffective,
  TurnSnapshot,
} from "../../shared/agent-ipc";
import type { PersistedSubagent, TurnCommitInput } from "../../shared/chats-ipc";
import { SubagentRegistry } from "../../shared/subagent-registry";
import type { ProductFailure } from "../../shared/product-failure";

/**
 * turn 的发起证据：人工输入或 relay。定义在本层
 * （无 Electron 依赖的 turn 单一真相源）；bridge-types 只再导出，方向恒为
 * agent/ → 本文件。
 *
 */
export type TurnOrigin =
  | {
      kind: "manual";
      queryText: string;
      userText: string;
      userMessageId: string;
    }
  | { kind: "relay" };

export type SourceTerminal = {
  type: "done" | "cancelled" | "error";
  message?: string;
  failureKind?: FailureKind;
  failure?: ProductFailure;
  /** 仅 failureKind==="usage-limit" 时存在，卡片据此渲染窗口与恢复时刻 */
  usageLimit?: UsageLimitInfo;
  facts?: { skillDescriptionsTruncated?: true };
};

export type TurnCleanup = "pending" | "complete" | "failed";
export type TurnPersist =
  | "unprepared"
  | "pending"
  | "stored"
  | "empty"
  | "missing"
  | "retryable"
  | "fatal";

export type RegistryTurn = {
  interrupt(): void;
  markStopped(): void;
  pid?: number;
  readonly steeringSupported?: boolean;
};
type Startup = {
  task: Promise<void>;
  cancelRequested: boolean;
};

type RetryState = {
  attempt: number;
  timer?: NodeJS.Timeout;
  inFlight?: Promise<void>;
};

type RetryClaimState = {
  generation: number;
  settled: Promise<void>;
  resolve(): void;
};

type SteerOperationState = {
  controller: AbortController;
  settled: Promise<void>;
  resolve(): void;
};

export type SubagentOutcomeStatus =
  | "completed"
  | "errored"
  | "interrupted"
  | "timeout";

export type TurnChildTask = {
  abort(): void | Promise<void>;
  settled: Promise<unknown>;
};

export type SteerOperation = {
  epoch: number;
  signal: AbortSignal;
  finish(): void;
};

export type TurnEntry<TTurn extends RegistryTurn = RegistryTurn> = {
  backend: AgentBackendId;
  conversationId: string;
  requestId: string;
  messageId: string;
  assistantSeq: number;
  planRequested: boolean;
  origin?: TurnOrigin;
  recallAttempted: boolean;
  startedAt: number;
  phase: "starting" | "active" | "resume-failed" | "retry-claiming";
  cleanup: TurnCleanup;
  persist: TurnPersist;
  session?: SessionRef;
  serviceTierEffective?: SessionServiceTierEffective;
  resumeRetryToken?: string;
  generation: number;
  draft: TurnDraft;
  approvals: Map<string, AgentApprovalRequest>;
  userInputs: Map<string, AgentUserInputRequest>;
  subagents: SubagentRegistry;
  subagentOutcomes: Map<string, SubagentOutcomeStatus>;
  childController: AbortController;
  children: Set<TurnChildTask>;
  startup?: Startup;
  turn?: TTurn;
  appId?: string;
  resolvedInput?: {
    commit(): void;
    rollback(): void;
    release(): Promise<void>;
  };
  sourceTerminal?: SourceTerminal;
  effectiveTerminal?: SourceTerminal;
  postProcess?: Promise<SourceTerminal>;
  finalizeInFlight?: Promise<void>;
  cleanupInFlight?: Promise<void>;
  prepared?: TurnCommitInput;
  projectionTail: Promise<void>;
  retry: RetryState;
  retryClaim?: RetryClaimState;
  steerOpEpoch: number;
  fenceClosed: boolean;
  steerOperations: Map<number, SteerOperationState>;
  tombstoneExpiresAt?: number;
};

export type RetryClaim<TTurn extends RegistryTurn = RegistryTurn> = {
  entry: TurnEntry<TTurn>;
  generation: number;
  token: string;
};

export type DraftObservation =
  | { type: "delta"; itemId: string }
  | { type: "item"; item: AgentTurnItem }
  | { type: "item-removed"; itemId: string };

export const isTombstone = (entry: TurnEntry) =>
  Boolean(entry.effectiveTerminal) &&
  entry.cleanup === "complete" &&
  ["stored", "empty", "missing"].includes(entry.persist);

export const blocksNewTurn = (entry: TurnEntry | null | undefined) =>
  Boolean(entry && !isTombstone(entry));

/**
 * turn 是否停在用户身上：存在未闭合的审批或追问。
 * 这是「agent 在等你回话」的协议级真相——两张表由 stamp 在
 * approval/user-input 的 requested 与 closed 之间维护，别处无第二个来源。
 */
export const awaitsUserResponse = (entry: TurnEntry | null | undefined) =>
  Boolean(entry && (entry.approvals.size > 0 || entry.userInputs.size > 0));

export class TurnRegistry<TTurn extends RegistryTurn = RegistryTurn> {
  private readonly entries = new Map<string, TurnEntry<TTurn>>();
  private readonly requests = new Map<string, TurnEntry<TTurn>>();
  private readonly seededSubagents = new Map<string, Record<string, PersistedSubagent>>();
  private readonly tombstoneTimers = new Map<string, NodeJS.Timeout>();
  private sequence = 0;
  private draftObserver?: (
    entry: TurnEntry<TTurn>,
    observation: DraftObservation
  ) => void;

  constructor(private readonly tombstoneTtlMs = 5 * 60_000) {}

  setDraftObserver(
    observer?: (
      entry: TurnEntry<TTurn>,
      observation: DraftObservation
    ) => void
  ) {
    this.draftObserver = observer;
  }

  seedSubagents(conversationId: string, subagents: Record<string, PersistedSubagent> = {}) {
    const current = this.entries.get(conversationId);
    if (current && !isTombstone(current)) return;
    this.seededSubagents.set(conversationId, structuredClone(subagents));
  }

  claim(input: {
    backend: AgentBackendId;
    conversationId: string;
    requestId: string;
    messageId?: string;
    assistantSeq?: number;
    planRequested?: boolean;
    origin?: TurnOrigin;
    appId?: string;
    now?: number;
  }) {
    const current = this.entries.get(input.conversationId);
    if (blocksNewTurn(current)) throw new Error("当前聊天已有请求正在执行");
    if (this.requests.has(input.requestId)) throw new Error("requestId 正在执行");
    if (current) {
      this.requests.delete(current.requestId);
      this.clearTombstoneTimer(current.conversationId);
    }
    const startedAt = input.now ?? Date.now();
    const entry: TurnEntry<TTurn> = {
      backend: input.backend,
      conversationId: input.conversationId,
      requestId: input.requestId,
      messageId:
        input.messageId ?? `assistant_${randomUUID().replaceAll("-", "")}`,
      assistantSeq: input.assistantSeq ?? 1,
      planRequested: input.planRequested ?? false,
      origin: input.origin,
      recallAttempted: false,
      appId: input.appId,
      startedAt,
      phase: "starting",
      generation: 1,
      cleanup: "pending",
      persist: "unprepared",
      draft: createDraft(startedAt),
      approvals: new Map(),
      userInputs: new Map(),
      subagents: new SubagentRegistry(this.seededSubagents.get(input.conversationId)),
      subagentOutcomes: new Map(),
      childController: new AbortController(),
      children: new Set(),
      projectionTail: Promise.resolve(),
      retry: { attempt: 0 },
      steerOpEpoch: 0,
      fenceClosed: false,
      steerOperations: new Map(),
    };
    this.entries.set(input.conversationId, entry);
    this.requests.set(input.requestId, entry);
    return entry;
  }

  rollbackClaim(entry: TurnEntry<TTurn>) {
    if (this.entries.get(entry.conversationId) !== entry || entry.phase !== "starting") return;
    entry.resolvedInput?.rollback();
    this.entries.delete(entry.conversationId);
    this.requests.delete(entry.requestId);
  }

  setStartup(entry: TurnEntry<TTurn>, task: Promise<void>) {
    entry.startup = { task, cancelRequested: false };
  }

  requestCancel(entry: TurnEntry<TTurn>) {
    if (entry.startup) entry.startup.cancelRequested = true;
    entry.childController.abort(new Error("父 turn 已取消"));
    for (const child of entry.children) {
      void Promise.resolve(child.abort()).catch(() => {});
    }
    entry.turn?.interrupt();
  }

  registerChild(entry: TurnEntry<TTurn>, child: TurnChildTask) {
    if (entry.fenceClosed || entry.sourceTerminal) {
      throw new Error("父 turn 已进入终态，拒绝注册子任务");
    }
    entry.children.add(child);
    void child.settled.finally(() => entry.children.delete(child)).catch(() => {});
    return () => entry.children.delete(child);
  }

  async drainChildren(entry: TurnEntry<TTurn>, timeoutMs = 15_000) {
    entry.childController.abort(new Error("父 turn 正在终态收敛"));
    const children = [...entry.children];
    for (const child of children) {
      void Promise.resolve(child.abort()).catch(() => {});
    }
    if (!children.length) return;
    let timeout: NodeJS.Timeout | undefined;
    const results = await Promise.race([
      Promise.allSettled(children.map((child) => child.settled)),
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), timeoutMs);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (results === "timeout") {
      throw new Error("Subagent 子任务在强制清理后仍未收敛");
    }
    // child 的业务失败/取消已经由 spawn tool 映射为 errored/interrupted；
    // 屏障只证明所有 owner 已结束，不能把子任务结果反向升级为父 turn fatal。
  }

  registerSteerOp(entry: TurnEntry<TTurn>): SteerOperation {
    if (entry.fenceClosed || entry.sourceTerminal || !entry.turn) {
      throw new Error("目标 turn 已进入终态，不能再注册 steering");
    }
    const epoch = ++entry.steerOpEpoch;
    const controller = new AbortController();
    let resolve!: () => void;
    const settled = new Promise<void>((done) => {
      resolve = done;
    });
    entry.steerOperations.set(epoch, { controller, settled, resolve });
    let finished = false;
    return {
      epoch,
      signal: controller.signal,
      finish: () => {
        if (finished) return;
        finished = true;
        entry.steerOperations.delete(epoch);
        resolve();
      },
    };
  }

  assertSteerEpoch(entry: TurnEntry<TTurn>, epoch: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (
      entry.steerOpEpoch < epoch ||
      !entry.steerOperations.has(epoch)
    ) {
      throw new Error("steering operation 已被终态 fence 拒绝");
    }
  }

  async closeSteerFence(
    entry: TurnEntry<TTurn>,
    timeoutMs = 10_000,
    abortGraceMs = 250
  ) {
    entry.fenceClosed = true;
    const operations = [...entry.steerOperations.values()];
    if (!operations.length) return { timedOutEpochs: [] };
    const drained = await this.waitForSteerOperations(
      operations,
      timeoutMs
    );
    if (drained) return { timedOutEpochs: [] };
    for (const operation of entry.steerOperations.values()) {
      operation.controller.abort(
        new Error("turn finalize steering barrier timed out")
      );
    }
    await this.waitForSteerOperations(
      [...entry.steerOperations.values()],
      abortGraceMs
    );
    const timedOutEpochs = [...entry.steerOperations.keys()];
    for (const epoch of timedOutEpochs) {
      const operation = entry.steerOperations.get(epoch);
      entry.steerOperations.delete(epoch);
      operation?.resolve();
    }
    return { timedOutEpochs };
  }

  private async waitForSteerOperations(
    operations: SteerOperationState[],
    timeoutMs: number
  ) {
    if (!operations.length) return true;
    let timeout: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      Promise.allSettled(operations.map((operation) => operation.settled)),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    return drained !== false;
  }

  bindTurn(
    entry: TurnEntry<TTurn>,
    turn: TTurn,
    resolvedInput?: {
      commit(): void;
      rollback(): void;
      release(): Promise<void>;
    }
  ) {
    entry.turn = turn;
    entry.resolvedInput = resolvedInput;
    if (entry.startup?.cancelRequested) turn.interrupt();
  }

  activate(entry: TurnEntry<TTurn>) {
    if (entry.startup?.cancelRequested || entry.sourceTerminal) return false;
    entry.resolvedInput?.commit();
    entry.phase = "active";
    return true;
  }

  markResumeFailed(entry: TurnEntry<TTurn>, retryToken: string) {
    entry.phase = "resume-failed";
    entry.resumeRetryToken = retryToken;
  }

  claimRetry(entry: TurnEntry<TTurn>, retryToken: string): RetryClaim<TTurn> {
    if (
      entry.phase !== "resume-failed" ||
      !entry.resumeRetryToken ||
      entry.resumeRetryToken !== retryToken ||
      entry.sourceTerminal !== undefined ||
      entry.finalizeInFlight !== undefined
    ) {
      throw new Error("resume retry token 已失效");
    }
    let resolve!: () => void;
    const settled = new Promise<void>((done) => {
      resolve = done;
    });
    entry.phase = "retry-claiming";
    entry.resumeRetryToken = undefined;
    entry.retryClaim = {
      generation: entry.generation,
      settled,
      resolve,
    };
    return { entry, generation: entry.generation, token: retryToken };
  }

  restoreRetry(claim: RetryClaim<TTurn>) {
    const { entry } = claim;
    if (
      entry.phase === "retry-claiming" &&
      entry.generation === claim.generation &&
      entry.resumeRetryToken === undefined &&
      entry.retryClaim?.generation === claim.generation
    ) {
      const retryClaim = entry.retryClaim;
      entry.phase = "resume-failed";
      entry.resumeRetryToken = claim.token;
      entry.retryClaim = undefined;
      retryClaim.resolve();
    }
  }

  beginRetry(claim: RetryClaim<TTurn>) {
    const { entry } = claim;
    if (
      entry.phase !== "retry-claiming" ||
      entry.generation !== claim.generation ||
      entry.resumeRetryToken !== undefined ||
      entry.retryClaim?.generation !== claim.generation
    ) {
      throw new Error("resume retry claim 已失效");
    }
    if (
      entry.sourceTerminal ||
      entry.effectiveTerminal ||
      entry.postProcess ||
      entry.finalizeInFlight ||
      entry.cleanupInFlight
    ) {
      throw new Error("resume retry 与终态处理发生冲突");
    }
    const retryClaim = entry.retryClaim;
    entry.phase = "starting";
    entry.cleanup = "pending";
    entry.persist = "unprepared";
    entry.turn = undefined;
    entry.startup = undefined;
    entry.retryClaim = undefined;
    entry.generation += 1;
    entry.fenceClosed = false;
    entry.childController = new AbortController();
    entry.children.clear();
    entry.subagentOutcomes.clear();
    retryClaim.resolve();
    return entry.generation;
  }

  waitForRetryClaim(entry: TurnEntry<TTurn>) {
    return entry.retryClaim?.settled ?? Promise.resolve();
  }

  lockSourceTerminal(entry: TurnEntry<TTurn>, terminal: SourceTerminal) {
    if (entry.sourceTerminal) return entry.sourceTerminal;
    entry.sourceTerminal = terminal;
    return terminal;
  }

  runPostProcess(
    entry: TurnEntry<TTurn>,
    task: (source: SourceTerminal) => Promise<void>
  ) {
    if (entry.postProcess) return entry.postProcess;
    const source = entry.sourceTerminal ?? {
      type: "error" as const,
      message: "Agent 未返回完成事件",
    };
    entry.postProcess = (async () => {
      try {
        await task(source);
        entry.effectiveTerminal = source;
      } catch (cause) {
        entry.effectiveTerminal = {
          type: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
      return entry.effectiveTerminal;
    })();
    return entry.postProcess;
  }

  runFinalize(entry: TurnEntry<TTurn>, task: () => Promise<void>) {
    if (entry.phase === "retry-claiming") {
      throw new Error("resume retry claim 完成前不能进入终态");
    }
    if (!entry.finalizeInFlight) entry.finalizeInFlight = task();
    return entry.finalizeInFlight;
  }

  runCleanup(entry: TurnEntry<TTurn>, task: () => Promise<void>) {
    if (!entry.cleanupInFlight) {
      entry.cleanupInFlight = Promise.resolve().then(task).then(
        () => {
          entry.cleanup = "complete";
          this.scheduleTombstone(entry);
        },
        (cause) => {
          entry.cleanup = "failed";
          throw cause;
        }
      );
    }
    return entry.cleanupInFlight;
  }

  prepare(entry: TurnEntry<TTurn>, input: TurnCommitInput) {
    entry.prepared ??= structuredClone(input);
    entry.persist = "pending";
    return entry.prepared;
  }

  markPersist(entry: TurnEntry<TTurn>, persist: TurnPersist) {
    entry.persist = persist;
    if (["stored", "empty", "missing"].includes(persist)) {
      if (entry.retry.timer) clearTimeout(entry.retry.timer);
      entry.retry.timer = undefined;
      entry.retry.inFlight = undefined;
      this.seededSubagents.set(entry.conversationId, entry.subagents.persisted());
    }
    this.scheduleTombstone(entry);
  }

  abandonFatalTurn(conversationId: string) {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.persist !== "fatal") throw new Error("没有可放弃的 fatal turn");
    this.seededSubagents.set(entry.conversationId, entry.subagents.persisted());
    entry.persist = "empty";
    this.scheduleTombstone(entry);
    return entry;
  }

  acknowledgeCleanupFailure(conversationId: string) {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.cleanup !== "failed") {
      throw new Error("没有可确认的 cleanup failure");
    }
    entry.cleanup = "complete";
    entry.cleanupInFlight = undefined;
    this.scheduleTombstone(entry);
    return entry;
  }

  release(conversationId: string) {
    const entry = this.entries.get(conversationId);
    if (entry && blocksNewTurn(entry)) {
      throw new Error("活动 turn 尚未 drain，拒绝释放 owner");
    }
    if (entry) this.requests.delete(entry.requestId);
    this.entries.delete(conversationId);
    this.seededSubagents.delete(conversationId);
    this.clearTombstoneTimer(conversationId);
  }

  hasCleanupFailure(backend?: AgentBackendId) {
    return [...this.entries.values()].some(
      (entry) =>
        entry.cleanup === "failed" &&
        (backend === undefined || entry.backend === backend)
    );
  }

  byConversation(conversationId: string) {
    return this.entries.get(conversationId);
  }

  byRequest(requestId: string) {
    return this.requests.get(requestId);
  }

  hasActivity(conversationIds: Iterable<string>) {
    for (const id of conversationIds) if (blocksNewTurn(this.entries.get(id))) return true;
    return false;
  }

  snapshot(conversationId: string): TurnSnapshot | null {
    const entry = this.entries.get(conversationId);
    if (!entry) return null;
    return {
      requestId: entry.requestId,
      assistantSeq: entry.assistantSeq,
      steeringSupported: entry.turn?.steeringSupported === true,
      phase: entry.phase,
      cleanup: entry.cleanup,
      persist: entry.persist,
      blocksNewTurn: blocksNewTurn(entry),
      ...(entry.session ? { session: entry.session } : {}),
      ...(entry.serviceTierEffective ? { serviceTierEffective: entry.serviceTierEffective } : {}),
      ...(entry.resumeRetryToken
        ? { retryToken: entry.resumeRetryToken }
        : {}),
      allowedActions: {
        sameSession: false,
        freshSession: false,
        abandon: false,
      },
      draft: serializeDraft(entry.draft),
      approvals: [...entry.approvals.values()].map((value) => structuredClone(value)),
      userInputs: [...entry.userInputs.values()]
        .sort((left, right) => (right.expiresAt ?? Infinity) - (left.expiresAt ?? Infinity))
        .map((value) => structuredClone(value)),
      liveSubagents: entry.subagents.live(),
      ...(entry.effectiveTerminal
        ? {
            terminal: entry.effectiveTerminal.type,
            ...(entry.effectiveTerminal.failureKind
              ? { failureKind: entry.effectiveTerminal.failureKind }
              : {}),
            ...(entry.effectiveTerminal.failure ? { failure: entry.effectiveTerminal.failure } : {}),
            ...(entry.effectiveTerminal.usageLimit
              ? { usageLimit: entry.effectiveTerminal.usageLimit }
              : {}),
          }
        : {}),
    };
  }

  attachSnapshot(conversationId: string) {
    return {
      lastSeq: this.sequence,
      turn: this.snapshot(conversationId),
    };
  }

  stamp(conversationId: string, body: AgentEventBody): AgentEvent {
    const entry = this.entries.get(conversationId);
    if (entry && entry.requestId === body.requestId) this.applyBody(entry, body);
    return { ...body, conversationId, seq: ++this.sequence } as AgentEvent;
  }

  enqueueProjection(
    entry: TurnEntry<TTurn>,
    generation: number,
    task: () => Promise<void> | void
  ) {
    const projection = entry.projectionTail.then(async () => {
      if (entry.generation !== generation) return;
      await task();
    });
    entry.projectionTail = projection.then(
      () => undefined,
      () => undefined
    );
    return projection;
  }

  drainProjections(entry: TurnEntry<TTurn>) {
    return entry.projectionTail;
  }

  async drain(
    filter: (entry: TurnEntry<TTurn>) => boolean,
    settle: (entry: TurnEntry<TTurn>) => Promise<void>
  ) {
    // tombstone 绝不进入 gate 内 drain/settle，是 gate → conversation
    // 与 coordinator conversation → gate 双向持锁不成环的第二守卫。
    const entries = [...this.entries.values()].filter(filter).filter(blocksNewTurn);
    for (const entry of entries) {
      if (entry.startup) entry.startup.cancelRequested = true;
      this.requestCancel(entry);
    }
    const startup = await Promise.allSettled(
      entries.flatMap((entry) => (entry.startup ? [entry.startup.task] : []))
    );
    const settled = await Promise.allSettled(
      entries.map((entry) => Promise.resolve().then(() => settle(entry)))
    );
    const pending = new Set<Promise<unknown>>();
    for (const entry of entries) {
      if (entry.finalizeInFlight) pending.add(entry.finalizeInFlight);
      if (entry.cleanupInFlight) pending.add(entry.cleanupInFlight);
      if (entry.postProcess) pending.add(entry.postProcess);
      if (entry.retry.inFlight) pending.add(entry.retry.inFlight);
    }
    const results = [
      ...startup,
      ...settled,
      ...(await Promise.allSettled([...pending])),
    ];
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length) throw new AggregateError(failures, "Agent turn drain 失败");
  }

  private scheduleTombstone(entry: TurnEntry<TTurn>) {
    if (!isTombstone(entry)) return;
    entry.draft = createDraft(entry.startedAt);
    entry.approvals.clear();
    entry.userInputs.clear();
    entry.subagents = new SubagentRegistry();
    entry.subagentOutcomes.clear();
    entry.children.clear();
    entry.turn = undefined;
    entry.resolvedInput = undefined;
    entry.prepared = undefined;
    const expiresAt = Date.now() + this.tombstoneTtlMs;
    entry.tombstoneExpiresAt = expiresAt;
    this.clearTombstoneTimer(entry.conversationId);
    const timer = setTimeout(() => {
      const current = this.entries.get(entry.conversationId);
      if (
        current === entry &&
        isTombstone(current) &&
        current.tombstoneExpiresAt === expiresAt
      ) {
        this.release(entry.conversationId);
      }
    }, this.tombstoneTtlMs);
    timer.unref?.();
    this.tombstoneTimers.set(entry.conversationId, timer);
  }

  private clearTombstoneTimer(conversationId: string) {
    const timer = this.tombstoneTimers.get(conversationId);
    if (timer) clearTimeout(timer);
    this.tombstoneTimers.delete(conversationId);
  }

  private applyBody(entry: TurnEntry<TTurn>, body: AgentEventBody) {
    if (body.type === "session") entry.session = body.session;
    if (body.type === "service-tier-effective") entry.serviceTierEffective = body.effective;
    if (body.type === "item-delta") {
      entry.draft = applyDelta(entry.draft, body.itemId, body.text);
      this.draftObserver?.(entry, {
        type: "delta",
        itemId: body.itemId,
      });
    }
    if (body.type === "item") {
      entry.draft = applyItem(entry.draft, body.item);
      this.draftObserver?.(entry, { type: "item", item: body.item });
    }
    if (body.type === "item-removed") {
      entry.draft = applyItemRemoved(entry.draft, body.itemId);
      this.draftObserver?.(entry, { type: "item-removed", itemId: body.itemId });
    }
    if (body.type === "approval-requested") {
      entry.approvals.set(body.approval.approvalId, body.approval);
    }
    if (body.type === "approval-closed") entry.approvals.delete(body.approvalId);
    if (body.type === "user-input-requested") {
      entry.userInputs.set(body.request.userInputId, body.request);
    }
    if (body.type === "user-input-closed") entry.userInputs.delete(body.userInputId);
    // subagent 事件由 SubagentTracker 在发布前写入同一 conversation registry；
    // stamp 只编号，避免 delta 被同一 owner 重放两次。
  }
}
