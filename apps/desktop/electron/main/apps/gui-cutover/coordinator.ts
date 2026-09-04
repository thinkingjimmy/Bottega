/**
 * [INPUT]: Depends on AppStore pending/active generation truth, exact Base GUI decisions/Studio grants, the two-state cutover journal, sealed-generation preflight, live surface enumeration keyed by logical lease, request/effect barriers, preference adoption, and projection synchronization
 * [OUTPUT]: Provides production nullable App-global compiled-v3 cutover for zero-to-many frozen surface cohorts, independent App-CAS and previous-GUI identities, barrier-time drain deadlines restamped per wait, always-resolved transition outcomes, unconditional transition publication, finally-safe reopening, and per-intent isolated crash recovery reported as findings instead of thrown startup failures
 * [POS]: gui-cutover orchestration authority; explicit preflight plus surface quorum gate promotion, and the AppStore active CAS stays the single commit point the journal only writes ahead of
 */

import type {
  AppGeneration,
  AppRecord,
} from "../../../../shared/apps-ipc";
import type {
  AppGuiGenerationAuthorityRef,
  AppGuiGenerationIntent,
  AppGuiPreferenceAdoptionSnapshot,
} from "../../../../shared/app-gui/cutover";
import type { AppGuiInfoInput, AppSurfaceMode } from "../../../../shared/apps-ipc";
import type { BaseGuiGrantStore } from "../base-gui/grant-store";
import type { AppStore } from "../store/app-store";
import { asError } from "../../errors";
import { AppGuiSurfaceCohort } from "./cohort";
import { AppGuiCutoverJournal } from "./journal";
import { deriveParticipantPlan } from "./participants";

/* liveSurfaces 报的是逻辑租约，不是运行期派生租约：一次 cutover 之后投影会
   用派生 id 重新注册这张面，而 renderer 永远只发稳定的逻辑 id。用派生 id
   当键，第二次 cutover 就永远等不到它认识的成员。 */
type LiveSurface = Readonly<{
  input: AppGuiInfoInput;
  logicalLeaseId: string;
}>;

type Ports = Readonly<{
  runExclusive<T>(appId: string, operation: () => Promise<T>): Promise<T>;
  liveSurfaces(appId: string, generationId: string | null): readonly LiveSurface[];
  stageSurface(
    sourceLeaseId: string,
    generationId: string
  ): Promise<Readonly<{ surfaceLeaseId: string; mode: AppSurfaceMode }>>;
  discardSurface(input: AppGuiInfoInput): Promise<void>;
  emitTransition(appId: string): void;
  closeAdmission(appId: string): void;
  drain(appId: string, generationId: string | null, deadlineMs: number): Promise<void>;
  reopenAdmission(appId: string): void;
  syncProjection(appId: string, resetCapability: boolean): Promise<unknown>;
  prepareAppParticipants(intent: AppGuiGenerationIntent): Promise<void>;
  retireGeneration(appId: string, generationId: string): Promise<void>;
  previewPreferences(appId: string, generationId: string): Promise<AppGuiPreferenceAdoptionSnapshot | null>;
  validatePreferences(intent: AppGuiGenerationIntent): Promise<void>;
  adoptPreferences(intent: AppGuiGenerationIntent): Promise<void>;
  legacyCutover<T>(appId: string, operation: () => Promise<T>): Promise<T>;
}>;

/* 恢复结论：discarded/quarantined 已经出账，不会再来一次；retry 表示这条 intent
   仍留在账本里，等下一轮退避重试。三者都不是异常，都是被观察到的事实。 */
type GuiCutoverRecoveryFinding = Readonly<{
  appId: string;
  cutoverId: string;
  outcome: "discarded" | "quarantined" | "retry";
  reason: string;
}>;

type TransitionOutcome = "committed" | "aborted";
type Transition = {
  intent: AppGuiGenerationIntent;
  cohort: AppGuiSurfaceCohort;
  initial: Map<string, Readonly<{ previousRuntimeSurfaceId: string; previousLeaseId: string }>>;
  /* 逻辑面 → 它当前持有的 staging 运行期身份；键已经是逻辑 id，值再存一份
     只会多出一个可以和键对不上的事实。 */
  staged: Map<string, AppGuiInfoInput>;
  collection: Promise<void>;
  resolveCollection(): void;
  frozen: Promise<void>;
  resolveFrozen(): void;
  readiness: Promise<void>;
  resolveReadiness(): void;
  outcome: Promise<TransitionOutcome>;
  resolveOutcome(value: TransitionOutcome): void;
};

const COLLECTION_TIMEOUT_MS = 5_000;
const READY_TIMEOUT_MS = 15_000;
const DRAIN_TIMEOUT_MS = 30_000;

export class AppGuiCutoverCoordinator {
  readonly journal: AppGuiCutoverJournal;
  private readonly transitions = new Map<string, Transition>();
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryDelayMs = 250;

  constructor(
    userData: string,
    private readonly store: AppStore,
    private readonly grants: BaseGuiGrantStore,
    private readonly ports: Ports
  ) {
    this.journal = new AppGuiCutoverJournal(userData);
  }

  initialize() {
    return this.journal.initialize();
  }

  closeAndFlush() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    return this.journal.closeAndFlush();
  }

  artifactRoots() {
    return this.journal.unfinished().flatMap((intent) => [
      { appId: intent.appId, generationId: intent.nextGenerationId },
      ...(intent.expectedActiveGenerationId
        ? [{ appId: intent.appId, generationId: intent.expectedActiveGenerationId }]
        : []),
    ]);
  }

  isStagingGeneration(appId: string, generationId: string) {
    return this.transitions.get(appId)?.intent.nextGenerationId === generationId;
  }

  async acquire(input: AppGuiInfoInput) {
    const transition = this.transitions.get(input.appId);
    if (!transition) return liveTarget(input);
    const logicalSurfaceId = input.appSurfaceLeaseId;
    const existing = transition.staged.get(logicalSurfaceId);
    if (existing?.surfaceId === input.surfaceId) {
      return {
        input: existing,
        generationId: transition.intent.nextGenerationId,
        cutoverId: transition.intent.cutoverId,
      };
    }
    /* 冻结后到达、或为同一逻辑面申请替换运行期面：两者都是决议之后的迟到者。
       它们不投票，也不领 staging 租约——领了就要在 transitions 还活着的时候
       用掉，而那扇窗恰恰在 finally 里关。等到 App 全局结论，然后走活的投影。 */
    if (existing || transition.cohort.snapshot().admission !== "collecting") {
      return this.lateJoinTarget(transition, input);
    }
    const stagedLease = await this.ports.stageSurface(
      input.appSurfaceLeaseId,
      transition.intent.nextGenerationId
    );
    const stagedInput = { ...input, appSurfaceLeaseId: stagedLease.surfaceLeaseId };
    /* stageSurface 的 await 期间 cohort 可能刚好冻结：这张面不在 frozen
       revision 里，与冻结后到达的迟到者同命。 */
    if (transition.cohort.snapshot().admission !== "collecting") {
      await this.ports.discardSurface(stagedInput).catch(() => undefined);
      return this.lateJoinTarget(transition, input);
    }
    const previous = transition.initial.get(logicalSurfaceId);
    transition.cohort.join({
      logicalSurfaceId,
      mode: stagedLease.mode,
      previousRuntimeSurfaceId: previous?.previousRuntimeSurfaceId ?? null,
      previousLeaseId: previous?.previousLeaseId ?? null,
      stagedRuntimeSurfaceId: input.surfaceId,
      stagingLeaseId: stagedLease.surfaceLeaseId,
    });
    transition.staged.set(logicalSurfaceId, stagedInput);
    if (initialMembersObserved(transition)) transition.resolveCollection();
    return {
      input: stagedInput,
      generationId: transition.intent.nextGenerationId,
      cutoverId: transition.intent.cutoverId,
    };
  }

  async ready(input: AppGuiInfoInput & { cutoverId: string }) {
    const transition = this.transitions.get(input.appId);
    if (!transition || transition.intent.cutoverId !== input.cutoverId) {
      throw new Error("GUI_CUTOVER_READY_NOT_FOUND");
    }
    const member = transition.cohort.snapshot().members.find(
      (item) => item.stagedRuntimeSurfaceId === input.surfaceId
    );
    if (
      !member ||
      member.stagingLeaseId !== input.appSurfaceLeaseId ||
      member.state !== "staging"
    ) {
      throw new Error("GUI_CUTOVER_READY_IDENTITY_MISMATCH");
    }
    if (transition.cohort.snapshot().frozenRevision === null) {
      await transition.frozen;
    }
    transition.cohort.ready(member.logicalSurfaceId);
    if (transition.cohort.hasReadyQuorum()) transition.resolveReadiness();
    return { outcome: await transition.outcome } as const;
  }

  async release(input: AppGuiInfoInput) {
    const transition = this.transitions.get(input.appId);
    if (!transition) return;
    const member = transition.cohort.snapshot().members.find(
      (item) =>
        item.stagedRuntimeSurfaceId === input.surfaceId ||
        item.previousRuntimeSurfaceId === input.surfaceId
    );
    if (!member) {
      for (const [logicalSurfaceId, previous] of transition.initial) {
        if (previous.previousRuntimeSurfaceId === input.surfaceId) {
          transition.initial.delete(logicalSurfaceId);
          break;
        }
      }
      if (initialMembersObserved(transition)) transition.resolveCollection();
      return;
    }
    if (member.state !== "closed" && member.state !== "swapped") {
      transition.cohort.close(member.logicalSurfaceId);
    }
    if (input.surfaceId === member.stagedRuntimeSurfaceId) {
      transition.staged.delete(member.logicalSurfaceId);
    }
    if (initialMembersObserved(transition)) transition.resolveCollection();
    if (transition.cohort.hasReadyQuorum()) transition.resolveReadiness();
  }

  run<T>(appId: string, operation: () => Promise<T>) {
    const candidate = pendingCompiledGeneration(this.store.get(appId));
    if (!candidate) return this.ports.legacyCutover(appId, operation);
    return this.ports.runExclusive(appId, () =>
      this.cutover(appId, candidate.generationId, operation)
    );
  }

  /* 恢复跑在启动路径上（AppsService.initialize → main index.ts）：一条坏 intent
     既不能炸掉整个产品的启动，也不能挡住后面 App 的恢复。所以每条 intent 各自
     隔离，失败只归类不外抛，结论由调用方一次性上报。 */
  async recover(): Promise<readonly GuiCutoverRecoveryFinding[]> {
    let pending: readonly AppGuiGenerationIntent[];
    try {
      pending = this.journal.unfinished();
    } catch (cause) {
      /* 账本自身已 poisoned：读不出任何 intent，重试也救不回来（DurableJson
         poisoned 后必须新建实例），报告一次即止。 */
      return [ledgerFinding(asError(cause).message)];
    }
    const findings: GuiCutoverRecoveryFinding[] = [];
    for (const intent of pending) {
      const finding = await this.converge(intent).catch((cause) =>
        recoveryFinding(intent, "retry", asError(cause).message)
      );
      if (finding) findings.push(finding);
    }
    return findings;
  }

  /* 三个分支对应账本真正记得的三件事：Store 已经落在 next 上（只能前滚）、
     intent 还没越过 active（中止安全）、以及两者互相矛盾（隔离）。 */
  private async converge(
    intent: AppGuiGenerationIntent
  ): Promise<GuiCutoverRecoveryFinding | null> {
    /* 本进程正在推进它：恢复不能从活着的 cutover 手里把 intent 抢过去中止。 */
    if (this.transitions.has(intent.appId)) return null;
    const record = this.store.get(intent.appId);
    if (!record) {
      /* apps.json 被隔离后空态重建、账本却活了下来：这条 intent 指向一个不存在
         的 App，没有任何权威能让它收敛，只能出账。 */
      await this.journal.discard(intent.cutoverId);
      return recoveryFinding(intent, "discarded", "GUI_CUTOVER_RECOVERY_APP_MISSING");
    }
    const activeId = record.generationBinding.active?.generationId ?? null;
    try {
      if (activeId === intent.nextGenerationId) {
        /* CAS 已提交：只能向前收敛。任何前置校验都不该在这里把已提交的一代拦回去，
           那只会让这个 App 永远卡在 admission 关闭、preference 未采纳的半途。 */
        await retryRecovery(() => this.ports.adoptPreferences(intent));
        await retryRecovery(() => this.ports.syncProjection(intent.appId, false));
        const previousGenerationId = intent.expectedActiveGenerationId;
        if (previousGenerationId) {
          await retryRecovery(() => this.ports.retireGeneration(
            intent.appId,
            previousGenerationId
          ));
        }
      } else if (intent.phase === "active") {
        /* 越过 active 却不落在 next 上：账本与 Store 互相矛盾，既不能提交也不能
           中止。隔离这一条并告警，其余 App 照常恢复。 */
        await this.journal.discard(intent.cutoverId);
        return recoveryFinding(intent, "quarantined", "GUI_CUTOVER_RECOVERY_AUTHORITY_MISMATCH");
      }
      /* active 之前：Store CAS 从未提交，中止就是安全的收敛方向。generation 已被
         回收、previous GUI 丢失、participant plan 漂移都不改变这个结论——它们只是
         中止的理由，不是崩溃的理由。 */
      await this.journal.discard(intent.cutoverId);
      return null;
    } finally {
      this.ports.reopenAdmission(intent.appId);
    }
  }

  private async cutover<T>(
    appId: string,
    expectedNextGenerationId: string,
    operation: () => Promise<T>
  ) {
    const record = requireRecord(this.store, appId);
    const generation = pendingCompiledGeneration(record);
    if (!generation || generation.generationId !== expectedNextGenerationId) {
      throw new Error("GUI_CUTOVER_PENDING_CHANGED");
    }
    const expectedActiveGenerationId = record.generationBinding.active?.generationId ?? null;
    const expectedActiveGeneration = generationById(record, expectedActiveGenerationId);
    const previousGuiGeneration = expectedActiveGeneration?.compatibilityRef
      ? expectedActiveGeneration
      : null;
    const preferenceAdoption = await this.ports.previewPreferences(appId, generation.generationId);
    let intent = await this.journal.begin({
      appId,
      expectedActiveGenerationId,
      previous: previousGuiGeneration
        ? authorityRef(record, previousGuiGeneration, this.grants)
        : null,
      next: authorityRef(record, generation, this.grants),
      participantPlan: deriveParticipantPlan(
        record,
        previousGuiGeneration,
        generation,
        this.grants
      ),
      preferenceAdoption,
    });
    const transition = createTransition(
      intent,
      this.ports.liveSurfaces(appId, expectedActiveGenerationId)
    );
    this.transitions.set(appId, transition);
    let admissionClosed = false;
    try {
      await this.ports.prepareAppParticipants(intent);
      if (transition.initial.size === 0) transition.resolveCollection();
      this.ports.emitTransition(appId);
      await bounded(
        transition.collection,
        Date.now() + COLLECTION_TIMEOUT_MS,
        "GUI_CUTOVER_COHORT_COLLECTION_TIMEOUT"
      );
      transition.cohort.freeze();
      transition.resolveFrozen();
      if (transition.cohort.hasReadyQuorum()) transition.resolveReadiness();
      /* 每一次等待都在开始的那一刻盖章自己的 deadline：继承上一段已经花掉的
         预算，等于让 barrier 提前把额度用光。 */
      await bounded(
        transition.readiness,
        Date.now() + READY_TIMEOUT_MS,
        "GUI_CUTOVER_READY_TIMEOUT"
      );
      admissionClosed = true;
      this.ports.closeAdmission(appId);
      await this.ports.drain(
        appId,
        expectedActiveGenerationId,
        Date.now() + DRAIN_TIMEOUT_MS
      );
      await this.ports.validatePreferences(intent);
      const result = await operation();
      const activeId = this.store.get(appId)?.generationBinding.active?.generationId ?? null;
      if (activeId !== expectedNextGenerationId) {
        throw new Error("GUI_CUTOVER_ACTIVE_CAS_MISMATCH");
      }
      intent = await this.journal.markActive(intent.cutoverId);
      transition.intent = intent;
      await retryRecovery(() => this.ports.adoptPreferences(intent));
      transition.cohort.swap();
      transition.resolveOutcome("committed");
      await this.ports.syncProjection(appId, false);
      await this.drainPreviousSurfaces(
        appId,
        expectedActiveGenerationId,
        Date.now() + DRAIN_TIMEOUT_MS
      );
      if (expectedActiveGenerationId) {
        await this.ports.retireGeneration(appId, expectedActiveGenerationId);
      }
      await this.journal.discard(intent.cutoverId);
      return result;
    } catch (cause) {
      const activeId = this.store.get(appId)?.generationBinding.active?.generationId ?? null;
      if (activeId === expectedNextGenerationId) {
        /* CAS 已提交：结论必须先落地。swap() 在没有 ready quorum 时会抛，
           而这个抛会一路走到 finally，把一次已经提交的切换重新写成 aborted。 */
        transition.resolveOutcome("committed");
        if (transition.cohort.hasReadyQuorum()) transition.cohort.swap();
        await this.ports.syncProjection(appId, false).catch(() => undefined);
        this.scheduleRecovery();
      } else if (intent.phase !== "active") {
        transition.resolveOutcome("aborted");
        await this.discardStaged(transition);
        await this.journal.discard(intent.cutoverId).catch(() => undefined);
      } else {
        /* 第三态：intent 已越过 active，Store 却既不是 next 也不是预期的旧代
           （记录被删、被别的权威改写）。本地没有安全结论可下，交给 recover()
           统一隔离。 */
        this.scheduleRecovery();
      }
      throw cause;
    } finally {
      /* outcome 是 acquire/ready 唯一的唤醒源。任何没归类的失败也必须给出结论，
         否则每一个在等的 IPC 都会永远挂着；aborted 是安全侧——调用方回退到
         当前 active。deferred 只认第一次，成功路径不受影响。 */
      transition.resolveOutcome("aborted");
      try {
        if (admissionClosed) this.ports.reopenAdmission(appId);
      } finally {
        this.transitions.delete(appId);
        /* 无条件发布：renderer 侧的候选帧只有靠这条事件才会重新取值。
           只在中止分支发，就等于让「第三态」的失败永远停在旧候选帧上。 */
        this.ports.emitTransition(appId);
      }
    }
  }

  /* 只有 retry 结论才值得再来一轮：出账的 intent 重试一万次也还是出账。 */
  private scheduleRecovery() {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.recover().then((findings) => {
        if (!findings.some((finding) => finding.outcome === "retry")) {
          this.recoveryDelayMs = 250;
          return;
        }
        this.recoveryDelayMs = Math.min(this.recoveryDelayMs * 2, 5_000);
        this.scheduleRecovery();
      });
    }, this.recoveryDelayMs);
    this.recoveryTimer.unref();
  }

  private async lateJoinTarget(transition: Transition, input: AppGuiInfoInput) {
    const outcome = await transition.outcome;
    if (outcome === "aborted" && !transition.intent.previous) {
      throw new Error("GUI_CUTOVER_FIRST_ACTIVATION_ABORTED");
    }
    return liveTarget(input);
  }

  private async discardStaged(transition: Transition) {
    await Promise.allSettled(
      [...transition.staged.values()].map((surface) =>
        this.ports.discardSurface(surface)
      )
    );
  }

  private async drainPreviousSurfaces(
    appId: string,
    previousGenerationId: string | null,
    deadlineMs: number
  ) {
    if (!previousGenerationId) return;
    while (true) {
      const previous = this.ports.liveSurfaces(appId, previousGenerationId);
      if (previous.length === 0) return;
      if (Date.now() >= deadlineMs) {
        await Promise.allSettled(
          previous.map(({ input }) => this.ports.discardSurface(input))
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/** 没有在途 cutover 可等：调用方回到活的投影，由 AppStore 的 active 说了算。 */
function liveTarget(input: AppGuiInfoInput) {
  return { input, generationId: null, cutoverId: null } as const;
}

function createTransition(
  intent: AppGuiGenerationIntent,
  surfaces: readonly LiveSurface[]
): Transition {
  const collection = deferred<void>();
  const frozen = deferred<void>();
  const readiness = deferred<void>();
  const outcome = deferred<TransitionOutcome>();
  const initial = new Map<string, Readonly<{
    previousRuntimeSurfaceId: string;
    previousLeaseId: string;
  }>>();
  for (const { input, logicalLeaseId } of surfaces) {
    initial.set(logicalLeaseId, {
      previousRuntimeSurfaceId: input.surfaceId,
      previousLeaseId: input.appSurfaceLeaseId,
    });
  }
  return {
    intent,
    cohort: new AppGuiSurfaceCohort(intent.cutoverId),
    initial,
    staged: new Map(),
    collection: collection.promise,
    resolveCollection: () => collection.resolve(undefined),
    frozen: frozen.promise,
    resolveFrozen: () => frozen.resolve(undefined),
    readiness: readiness.promise,
    resolveReadiness: () => readiness.resolve(undefined),
    outcome: outcome.promise,
    resolveOutcome: outcome.resolve,
  };
}

function initialMembersObserved(transition: Transition) {
  return [...transition.initial.keys()].every((logicalSurfaceId) =>
    transition.staged.has(logicalSurfaceId) ||
    transition.cohort.snapshot().members.some(
      (member) =>
        member.logicalSurfaceId === logicalSurfaceId && member.state === "closed"
    )
  );
}

function deferred<T>() {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
  };
}

async function bounded<T>(promise: Promise<T>, deadlineMs: number, code: string) {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new Error(code);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pendingCompiledGeneration(record: AppRecord | undefined) {
  const generationId = record?.generationBinding.pending?.generationId;
  const generation = generationById(record, generationId ?? null);
  return generation?.contentLayoutVersion === 3 && generation.manifest.kind === "base"
    ? generation
    : null;
}

function generationById(record: AppRecord | undefined, generationId: string | null) {
  return generationId
    ? record?.generations.find((item) => item.generationId === generationId) ?? null
    : null;
}

function authorityRef(
  record: AppRecord,
  generation: AppGeneration,
  grants: BaseGuiGrantStore
): AppGuiGenerationAuthorityRef {
  if (!generation.compatibilityRefDigest) {
    throw new Error("GUI_CUTOVER_COMPATIBILITY_REF_MISSING");
  }
  const decision = grants.projection(record.id, generation.generationId).decision;
  const studioGrant = record.studioGrant?.generationId === generation.generationId
    ? record.studioGrant
    : null;
  return {
    generationId: generation.generationId,
    contentDigest: generation.contentDigest,
    compatibilityRefDigest: generation.compatibilityRefDigest,
    decisionId: decision?.decisionId ?? null,
    grantId: studioGrant
      ? `studio:${record.id}:${record.studioGrantRevision ?? 0}`
      : null,
  };
}

async function retryRecovery(operation: () => Promise<unknown>) {
  let cause: unknown;
  for (const delayMs of [0, 25, 100]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await operation();
    } catch (error) {
      cause = error;
    }
  }
  throw cause;
}

function requireRecord(store: AppStore, appId: string) {
  const record = store.get(appId);
  if (!record) throw new Error("App 不存在");
  return record;
}

function recoveryFinding(
  intent: AppGuiGenerationIntent,
  outcome: GuiCutoverRecoveryFinding["outcome"],
  reason: string
): GuiCutoverRecoveryFinding {
  return { appId: intent.appId, cutoverId: intent.cutoverId, outcome, reason };
}

function ledgerFinding(reason: string): GuiCutoverRecoveryFinding {
  return {
    appId: "*",
    cutoverId: "*",
    outcome: "quarantined",
    reason: `GUI_CUTOVER_JOURNAL_UNREADABLE: ${reason}`,
  };
}
