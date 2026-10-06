/**
 * [INPUT]: Depends on the Provider id (a built-in or an available package Provider), ChildProcess, process-group and the task start fence (woken when the last safety lock of a backend is released)
 * [OUTPUT]: Provides atomic quota exclusion (with its blockers named for the main log, startup recovery among them, and a deferred read woken whenever starts become possible again) that neither a queued background refresh nor a credential-safe probe can starve, credential reservations, chat-priority cancellation, parked quota channels that block nothing but are closed before a turn is admitted, quota-preserving background admission and per-backend admission with a 4-slot semaphore (2 reserved for interactive), bounded FIFO background queueing, safety-lock hold/release, birth-recorded auxiliary-process tracking whose shutdown never signals a reused PID, and coordinated shutdown A Provider turned off in Plugins & Apps is refused at admission (`plugin-disabled`).
 * `agentShutdownProcesses` reports birth-qualified outstanding process identities for quit feedback; shutdown waits for quota/channel settlement before judging cleanup locks.
 * [POS]: The sole owner of Agent child-process admission in Electron main; callers acquire a lease before spawning and report a CleanupResult after teardown
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { trackAuxiliaryProcessGroup } from "./agent/process/agent-process-watchdog";
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../shared/ipc/agent/agent-ipc";
import { isBuiltinAgentId } from "@ai-chat/cloud-protocol/chats/backend-id";
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { asError } from "./ipc/errors";
import {
  cleanOwnedProcessGroup,
  cleanProcessGroup,
  type CleanupResult,
} from "./agent/process/process-group";
import { observeProcessBirth, probeProcessBirth } from "./custody/identity";
import { taskStartFence } from "./presence/lifecycle/start-fence";
import { recoveryBlocked } from "./persistence/recovery-policy";

type AuxiliaryProcess = {
  child: ChildProcessWithoutNullStreams;
  settled: Promise<void>;
  /** Recorded at registration; shutdown signals the group only while the leader still carries it. */
  birthIdentity: string | null;
};

type BackendDomain = {
  auxiliary: Map<symbol, AuxiliaryProcess>;
  admissionOpen: boolean;
  safetyLocks: Map<symbol, string>;
  interactive: number;
  background: number;
  interactiveQueue: QueueEntry[];
  backgroundQueue: QueueEntry[];
  /** Background leases that provably cannot reach credentials; counted, but never quota-blocking. */
  credentialSafe: number;
  credentialUsers: Set<symbol>;
  quota?: { cancel(): void; settled: Promise<void> };
  /** A warm quota channel parked between reads: a live process with no read in flight. */
  channel?: { cancel(): void; settled: Promise<void> };
};

type ProcessClass = "interactive" | "background";

export type AgentProcessAdmissionReason =
  | "queue-full"
  | "queue-timeout"
  | "cancelled"
  | "closed"
  | "safety-lock"
  | "plugin-disabled";

export class AgentProcessAdmissionError extends Error {
  readonly name = "AgentProcessAdmissionError";

  constructor(
    readonly reason: AgentProcessAdmissionReason,
    message: string
  ) {
    super(message);
  }
}

export function isAgentProcessAdmissionError(
  cause: unknown
): cause is AgentProcessAdmissionError {
  return cause instanceof AgentProcessAdmissionError;
}

type QueueEntry = {
  kind: ProcessClass;
  credentialSafe?: boolean;
  resolve: (lease: AgentProcessLease) => void;
  reject: (cause: Error) => void;
  signal?: AbortSignal;
  timeout?: NodeJS.Timeout;
  onAbort?: () => void;
};

export type AgentProcessLease = {
  readonly backend: ProviderId;
  readonly kind: ProcessClass;
  release(): void;
};

export const AGENT_PROCESS_BUDGET = {
  capacity: 4,
  backgroundCapacity: 2,
  backgroundQueueLimit: 8,
  backgroundWaitMs: 120_000,
} as const;

const domains = new Map<ProviderId, BackendDomain>();
const INTERACTIVE_SAFETY_OWNER = Symbol("interactive-safety-owner");

function domain(backend: ProviderId) {
  let value = domains.get(backend);
  if (!value) {
    value = {
      auxiliary: new Map(),
      admissionOpen: true,
      safetyLocks: new Map(),
      interactive: 0,
      background: 0,
      interactiveQueue: [],
      backgroundQueue: [],
      credentialSafe: 0,
      credentialUsers: new Set(),
    };
    domains.set(backend, value);
  }
  return value;
}

function total(state: BackendDomain) {
  return state.interactive + state.background;
}

/* A credential-safe probe runs in a disposable state root that cannot read or rewrite the
   account, so a held quota read is not its concern: it waits for slots, never for credentials. */
function canAcquire(state: BackendDomain, kind: ProcessClass, credentialSafe = false) {
  if ((state.quota && !credentialSafe) || total(state) >= AGENT_PROCESS_BUDGET.capacity) return false;
  /* A parked channel holds credentials but no work, so it is contention for a turn only --
     the same barrier a held quota lease gets, and for the same reason: the turn reaches the
     native CLI after the channel's process group is gone, never beside it. */
  if (state.channel && kind === "interactive") return false;
  return (
    kind === "interactive" ||
    state.background < AGENT_PROCESS_BUDGET.backgroundCapacity
  );
}

function createLease(
  backend: ProviderId,
  state: BackendDomain,
  kind: ProcessClass,
  credentialSafe = false
): AgentProcessLease {
  if (kind === "interactive") state.interactive += 1;
  else state.background += 1;
  if (credentialSafe) state.credentialSafe += 1;
  let released = false;
  return {
    backend,
    kind,
    release() {
      if (released) return;
      released = true;
      if (kind === "interactive") state.interactive -= 1;
      else state.background -= 1;
      if (credentialSafe) state.credentialSafe -= 1;
      drain(backend, state);
      notifyQuotaAdmission(backend);
    },
  };
}

function removeQueued(state: BackendDomain, entry: QueueEntry) {
  const queue =
    entry.kind === "interactive"
      ? state.interactiveQueue
      : state.backgroundQueue;
  const index = queue.indexOf(entry);
  if (index >= 0) queue.splice(index, 1);
  if (entry.timeout) clearTimeout(entry.timeout);
  if (entry.onAbort && entry.signal) {
    entry.signal.removeEventListener("abort", entry.onAbort);
  }
}

function drain(backend: ProviderId, state: BackendDomain) {
  if (!state.admissionOpen || state.safetyLocks.size) return;
  while (canAcquire(state, "interactive") && state.interactiveQueue.length) {
    const entry = state.interactiveQueue.shift()!;
    removeQueued(state, entry);
    entry.resolve(createLease(backend, state, "interactive"));
  }
  /* FIFO among equals, but a credential-safe probe is not queued behind work that is only
     waiting for the quota read to let go -- it can run beside it. */
  for (;;) {
    if (state.interactiveQueue.length) break;
    const entry = state.backgroundQueue.find((candidate) =>
      canAcquire(state, "background", candidate.credentialSafe)
    );
    if (!entry) break;
    removeQueued(state, entry);
    entry.resolve(
      createLease(backend, state, "background", entry.credentialSafe)
    );
  }
}

export function acquireAgentProcessLease(
  backend: ProviderId,
  kind: ProcessClass,
  signal?: AbortSignal,
  options: {
    quota?: "wait" | "preempt";
    credentialSafe?: boolean;
  } = {}
): Promise<AgentProcessLease> {
  assertAgentProcessAdmission(backend);
  if (signal?.aborted) {
    throw new AgentProcessAdmissionError(
      "cancelled",
      `${backend} ${kind} 等待已取消`
    );
  }
  const state = domain(backend);
  /** The flag is a property of background probes only; nothing else can claim it. */
  const credentialSafe = kind === "background" && options.credentialSafe === true;
  // Background refreshes can keep an existing quota read; user work still preempts it.
  if (kind === "interactive" || (!credentialSafe && options.quota !== "wait")) state.quota?.cancel();
  /* An idle but live channel is not an in-flight read (usage PRD §6.5), so only a turn takes
     it away: background work still runs beside it, interactive work waits it out in canAcquire. */
  if (kind === "interactive") state.channel?.cancel();
  if (
    kind === "interactive" &&
    state.interactiveQueue.length === 0 &&
    canAcquire(state, kind)
  ) {
    return Promise.resolve(createLease(backend, state, kind));
  }
  if (
    kind === "background" &&
    state.interactiveQueue.length === 0 &&
    (credentialSafe || state.backgroundQueue.length === 0) &&
    canAcquire(state, kind, credentialSafe)
  ) {
    return Promise.resolve(createLease(backend, state, kind, credentialSafe));
  }
  if (
    kind === "background" &&
    state.backgroundQueue.length >= AGENT_PROCESS_BUDGET.backgroundQueueLimit
  ) {
    throw new AgentProcessAdmissionError(
      "queue-full",
      `${backend} background 队列已满（${AGENT_PROCESS_BUDGET.backgroundQueueLimit}）`
    );
  }
  return new Promise<AgentProcessLease>((resolve, reject) => {
    const entry: QueueEntry = { kind, credentialSafe, resolve, reject, signal };
    const withdraw = (cause: AgentProcessAdmissionError) => {
      removeQueued(state, entry);
      reject(cause);
      drain(backend, state);
      notifyQuotaAdmission(backend);
    };
    entry.onAbort = () => {
      withdraw(
        new AgentProcessAdmissionError(
          "cancelled",
          `${backend} ${kind} 等待已取消`
        )
      );
    };
    signal?.addEventListener("abort", entry.onAbort, { once: true });
    if (kind === "background") {
      entry.timeout = setTimeout(() => {
        withdraw(
          new AgentProcessAdmissionError(
            "queue-timeout",
            `${backend} background 等待超过 ${AGENT_PROCESS_BUDGET.backgroundWaitMs}ms`
          )
        );
      }, AGENT_PROCESS_BUDGET.backgroundWaitMs);
      entry.timeout.unref?.();
    }
    (kind === "interactive"
      ? state.interactiveQueue
      : state.backgroundQueue
    ).push(entry);
  });
}

/* Providers whose plugin the user turned off (Q29): nothing of theirs starts — turns, probes or readers — until it is turned on. */
const disabledBackends = new Set<ProviderId>();
export function setAgentBackendDisabled(backend: ProviderId, disabled: boolean) {
  if (disabled) disabledBackends.add(backend); else disabledBackends.delete(backend);
}

export function assertAgentProcessAdmission(backend: ProviderId) {
  if (disabledBackends.has(backend)) {
    throw new AgentProcessAdmissionError("plugin-disabled", `${backend} is turned off in Plugins & Apps`);
  }
  const state = domain(backend);
  const reason = agentProcessSafetyLock(backend);
  if (reason) {
    throw new AgentProcessAdmissionError(
      "safety-lock",
      `${backend} 已进入安全锁定：${reason}`
    );
  }
  if (!state.admissionOpen) {
    throw new AgentProcessAdmissionError(
      "closed",
      `应用正在退出，不能启动 ${backend} 子进程`
    );
  }
}

export function agentProcessSafetyLock(backend: ProviderId) {
  const reasons = [...new Set(domain(backend).safetyLocks.values())];
  return reasons.length ? reasons.join("；") : undefined;
}

export function reportAgentCleanupFailure(
  backend: ProviderId,
  cause: unknown,
  owner: symbol = INTERACTIVE_SAFETY_OWNER
) {
  domain(backend).safetyLocks.set(owner, asError(cause).message);
}

/* Messages that waited on a lock (the dispatcher refuses to start into one) are woken when the last lock goes. */
function releaseSafetyLock(state: BackendDomain, owner: symbol) {
  if (state.safetyLocks.delete(owner) && state.safetyLocks.size === 0) taskStartFence.wake();
}

export function clearAgentSafetyLockWhenIdle(backend: ProviderId) {
  const state = domain(backend);
  if (state.auxiliary.size > 0) return;
  releaseSafetyLock(state, INTERACTIVE_SAFETY_OWNER);
  drain(backend, state);
}

export type AuxiliaryProcessRegistration = (() => void) & {
  owner: symbol;
};

export function registerAuxiliaryAgentProcess(
  backend: ProviderId,
  child: ChildProcessWithoutNullStreams,
  settled: Promise<void>
) {
  assertAgentProcessAdmission(backend);
  const state = domain(backend);
  const token = Symbol(`${backend}-auxiliary`);
  const birthIdentity = child.pid ? probeProcessBirth(child.pid)?.birthIdentity ?? null : null;
  state.auxiliary.set(token, { child, settled, birthIdentity });
  /* If main dies without cleaning up, the watchdog ends this group (quota readers, probes; never Agent turns). */
  const untrack = trackAuxiliaryProcessGroup(child.pid, birthIdentity);
  const unregister = (() => {
    untrack();
    state.auxiliary.delete(token);
    releaseSafetyLock(state, token);
    drain(backend, state);
  }) as AuxiliaryProcessRegistration;
  unregister.owner = token;
  return unregister;
}

function stopAgentProcessAdmission(backend: ProviderId) {
  const state = domain(backend);
  state.admissionOpen = false;
  state.quota?.cancel();
  state.channel?.cancel();
  for (const entry of [
    ...state.interactiveQueue,
    ...state.backgroundQueue,
  ]) {
    removeQueued(state, entry);
    entry.reject(
      new AgentProcessAdmissionError(
        "closed",
        `应用正在退出，取消 ${backend} 进程等待`
      )
    );
  }
}

export function stopAllAgentProcessAdmission() {
  for (const backend of AGENT_BACKEND_ORDER) stopAgentProcessAdmission(backend);
}

export async function shutdownAgentBackendProcesses(
  backend: ProviderId,
  clean: (pid: number) => Promise<CleanupResult> = cleanProcessGroup
) {
  const state = domain(backend);
  const quotaSettlements = [state.quota?.settled, state.channel?.settled];
  stopAgentProcessAdmission(backend);
  await Promise.allSettled(quotaSettlements);
  const entries = [...state.auxiliary.entries()];
  const cleanup = await Promise.allSettled(
    entries.map(async ([token, { child, birthIdentity }]) => {
      if (child.pid) {
        const result = await cleanOwnedProcessGroup({ pid: child.pid, birthIdentity }, observeProcessBirth, clean);
        if (!result.ok) throw result.error;
      }
      state.auxiliary.delete(token);
      releaseSafetyLock(state, token);
    })
  );
  await Promise.allSettled(entries.map(([, { settled }]) => settled));
  const failures = cleanup.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (state.auxiliary.size > 0) {
    failures.push(new Error(`${backend} auxiliary 子进程未完成注销`));
  }
  const safetyLock = agentProcessSafetyLock(backend);
  if (safetyLock) {
    failures.push(new Error(safetyLock));
  }
  if (failures.length) {
    throw new AggregateError(failures, `${backend} auxiliary 进程清理失败`);
  }
}

export async function shutdownAuxiliaryAgentProcesses() {
  stopAllAgentProcessAdmission();
  const results = await Promise.allSettled(
    AGENT_BACKEND_ORDER.map((backend) =>
      shutdownAgentBackendProcesses(backend)
    )
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (failures.length) {
    throw new AggregateError(failures, "Agent auxiliary 进程清理失败");
  }
}

export function reopenAgentProcessAdmission(backend: ProviderId) {
  const state = domain(backend);
  if (state.safetyLocks.size || state.auxiliary.size > 0) return false;
  state.admissionOpen = true;
  notifyQuotaAdmission(backend);
  return true;
}

export function resetAgentProcessSupervisorForTests() {
  for (const [backend, state] of domains) {
    for (const entry of [
      ...state.interactiveQueue,
      ...state.backgroundQueue,
    ]) {
      removeQueued(state, entry);
      entry.reject(new Error(`${backend} supervisor 测试重置`));
    }
  }
  domains.clear();
}

export function agentProcessBudgetSnapshot(backend: ProviderId) {
  const state = domain(backend);
  return {
    interactive: state.interactive,
    background: state.background,
    interactiveQueued: state.interactiveQueue.length,
    backgroundQueued: state.backgroundQueue.length,
  };
}

/** 只暴露数量，不泄露 child/token；测试与 shutdown 诊断据此证明无残留。 */
export function agentAuxiliaryProcessCount(backend: ProviderId) {
  return domain(backend).auxiliary.size;
}

/** Current custody, not a safety-lock string: a dead or reused PID cannot become a running-process warning. */
export function agentShutdownProcesses(): string[] {
  return [...domains.values()].flatMap(state => [...state.auxiliary.values()].flatMap(({ child, birthIdentity }) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return [];
    const observed = observeProcessBirth(child.pid);
    if (observed.state === "absent" || (observed.state === "present" && observed.birthIdentity !== birthIdentity)) return [];
    return [`${child.pid}:${birthIdentity ?? "unknown"}`];
  }));
}


/* Quota reads are a built-in's: a package Provider's admission changes are nobody's quota notice. */
const quotaListeners = new Set<(backend: AgentBackendId) => void>();
function notifyQuotaAdmission(backend: ProviderId) {
  const builtin = isBuiltinAgentId(backend) ? backend : null;
  if (builtin) for (const listener of quotaListeners) listener(builtin);
}
export function subscribeQuotaAdmission(listener: (backend: AgentBackendId) => void) {
  quotaListeners.add(listener);
  return () => { quotaListeners.delete(listener); };
}
/* Starts become possible again (startup recovery opened, the last safety lock went): a deferred quota read is re-checked too. */
taskStartFence.onReleased(() => { for (const backend of domains.keys()) notifyQuotaAdmission(backend); });
/* backgroundQueue is deliberately absent: queued background work waits for the quota
   lease by contract, and canAcquire keeps it queued for as long as the lease is held,
   so a queued refresh can never overlap a read -- counting it here would only let it
   starve the read it is waiting for. Credential-safe leases are subtracted for the same
   reason from the other side: they run in a disposable state root and can start, run and
   finish beside a quota read without ever reaching the account. */
export function agentQuotaBlocked(backend: ProviderId) {
  return agentQuotaBlockers(backend).length > 0;
}
/** What holds a quota read back, by name only (never an owner or process): the gate above and the main log read the same list. */
export function agentQuotaBlockers(backend: ProviderId) {
  const state = domain(backend);
  const leases = total(state) - state.credentialSafe;
  /* Startup recovery is named too: a read started under it waits out the recovery gate inside its own 30-second cap and fails. */
  return [
    recoveryBlocked() && "startup-recovery",
    !state.admissionOpen && "admission-closed",
    state.safetyLocks.size > 0 && "safety-lock",
    state.credentialUsers.size > 0 && "credential-use",
    leases > 0 && `leases(interactive=${state.interactive},background=${state.background - state.credentialSafe})`,
    state.interactiveQueue.length > 0 && "interactive-queue",
    state.quota && "quota-read",
  ].filter((reason): reason is string => Boolean(reason));
}
/** The reservation is synchronous; callers await ready before accessing native credentials. */
export function reserveAgentCredentialUse(backend: ProviderId) {
  assertAgentProcessAdmission(backend);
  const state = domain(backend);
  const owner = Symbol("credential-use");
  state.credentialUsers.add(owner);
  const ready = Promise.all([state.quota?.settled, state.channel?.settled]).then(() => undefined);
  state.quota?.cancel();
  state.channel?.cancel();
  return { ready, release() {
    if (!state.credentialUsers.delete(owner)) return;
    notifyQuotaAdmission(backend);
  } };
}
/** No queue: a busy Agent keeps its previous quota snapshot until an active consumer can retry. */
export function tryAcquireAgentQuotaLease(backend: AgentBackendId, cancel: () => void) {
  if (agentQuotaBlocked(backend)) return null;
  const state = domain(backend);
  let finish!: () => void;
  const owner = { cancel, settled: new Promise<void>((resolve) => { finish = resolve; }) };
  state.quota = owner;
  state.background += 1;
  return { release() {
    if (state.quota !== owner) return;
    state.quota = undefined;
    state.background -= 1;
    finish();
    drain(backend, state);
    notifyQuotaAdmission(backend);
  } };
}

/* A parked quota channel is not a lease: it has no read in flight, so it neither blocks a
   quota read (it *is* the reader) nor spends a budget slot -- every read through it still
   takes the quota lease, so concurrent account work stays bounded exactly as before. What it
   does need is the cleanup barrier: interactive admission and credential reservations close
   it and wait for its process group before they touch the account (usage PRD §6.5). */
export function registerAgentQuotaChannel(backend: AgentBackendId, close: () => Promise<void>) {
  const state = domain(backend);
  state.channel?.cancel();
  let finish!: () => void;
  let closing: Promise<void> | undefined;
  const owner = { cancel() { closing ??= close().catch(() => undefined).then(clear); },
    settled: new Promise<void>((resolve) => { finish = resolve; }) };
  const clear = () => {
    if (state.channel !== owner) return;
    state.channel = undefined;
    finish();
    drain(backend, state);
    notifyQuotaAdmission(backend);
  };
  state.channel = owner;
  return { release: clear };
}
