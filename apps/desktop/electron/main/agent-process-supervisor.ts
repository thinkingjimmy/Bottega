/**
 * [INPUT]: Depends on AgentBackendId, ChildProcess and process-group
 * [OUTPUT]: Provides backend subdomain type access, owner-scoped security lock/unlock wake up, 4 slots semaphore, 2 interactive reservations, bordered FIFO background queues, auxiliary recording/observing and clustering shutdown
 * [POS]: The only owner of the Agent process resources of Electron main; lease before spawn, CleanupResult after settlement
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../shared/agent-ipc";
import { asError } from "./errors";
import {
  cleanProcessGroup,
  type CleanupResult,
} from "./process-group";

type AuxiliaryProcess = {
  child: ChildProcessWithoutNullStreams;
  settled: Promise<void>;
};

type BackendDomain = {
  auxiliary: Map<symbol, AuxiliaryProcess>;
  admissionOpen: boolean;
  safetyLocks: Map<symbol, string>;
  interactive: number;
  background: number;
  interactiveQueue: QueueEntry[];
  backgroundQueue: QueueEntry[];
};

type ProcessClass = "interactive" | "background";

export type AgentProcessAdmissionReason =
  | "queue-full"
  | "queue-timeout"
  | "cancelled"
  | "closed"
  | "safety-lock";

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
  resolve: (lease: AgentProcessLease) => void;
  reject: (cause: Error) => void;
  signal?: AbortSignal;
  timeout?: NodeJS.Timeout;
  onAbort?: () => void;
};

export type AgentProcessLease = {
  readonly backend: AgentBackendId;
  readonly kind: ProcessClass;
  release(): void;
};

export const AGENT_PROCESS_BUDGET = {
  capacity: 4,
  backgroundCapacity: 2,
  backgroundQueueLimit: 8,
  backgroundWaitMs: 120_000,
} as const;

const domains = new Map<AgentBackendId, BackendDomain>();
const LEGACY_SAFETY_OWNER = Symbol("interactive-safety-owner");

function domain(backend: AgentBackendId) {
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
    };
    domains.set(backend, value);
  }
  return value;
}

function total(state: BackendDomain) {
  return state.interactive + state.background;
}

function canAcquire(state: BackendDomain, kind: ProcessClass) {
  if (total(state) >= AGENT_PROCESS_BUDGET.capacity) return false;
  return (
    kind === "interactive" ||
    state.background < AGENT_PROCESS_BUDGET.backgroundCapacity
  );
}

function createLease(
  backend: AgentBackendId,
  state: BackendDomain,
  kind: ProcessClass
): AgentProcessLease {
  if (kind === "interactive") state.interactive += 1;
  else state.background += 1;
  let released = false;
  return {
    backend,
    kind,
    release() {
      if (released) return;
      released = true;
      if (kind === "interactive") state.interactive -= 1;
      else state.background -= 1;
      drain(backend, state);
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

function drain(backend: AgentBackendId, state: BackendDomain) {
  if (!state.admissionOpen || state.safetyLocks.size) return;
  while (canAcquire(state, "interactive") && state.interactiveQueue.length) {
    const entry = state.interactiveQueue.shift()!;
    removeQueued(state, entry);
    entry.resolve(createLease(backend, state, "interactive"));
  }
  while (
    state.interactiveQueue.length === 0 &&
    canAcquire(state, "background") &&
    state.backgroundQueue.length
  ) {
    const entry = state.backgroundQueue.shift()!;
    removeQueued(state, entry);
    entry.resolve(createLease(backend, state, "background"));
  }
}

export function acquireAgentProcessLease(
  backend: AgentBackendId,
  kind: ProcessClass,
  signal?: AbortSignal
): Promise<AgentProcessLease> {
  assertAgentProcessAdmission(backend);
  if (signal?.aborted) {
    throw new AgentProcessAdmissionError(
      "cancelled",
      `${backend} ${kind} 等待已取消`
    );
  }
  const state = domain(backend);
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
    state.backgroundQueue.length === 0 &&
    canAcquire(state, kind)
  ) {
    return Promise.resolve(createLease(backend, state, kind));
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
    const entry: QueueEntry = { kind, resolve, reject, signal };
    entry.onAbort = () => {
      removeQueued(state, entry);
      reject(
        new AgentProcessAdmissionError(
          "cancelled",
          `${backend} ${kind} 等待已取消`
        )
      );
    };
    signal?.addEventListener("abort", entry.onAbort, { once: true });
    if (kind === "background") {
      entry.timeout = setTimeout(() => {
        removeQueued(state, entry);
        reject(
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

export function assertAgentProcessAdmission(backend: AgentBackendId) {
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

export function agentProcessSafetyLock(backend: AgentBackendId) {
  const reasons = [...new Set(domain(backend).safetyLocks.values())];
  return reasons.length ? reasons.join("；") : undefined;
}

export function reportAgentCleanupFailure(
  backend: AgentBackendId,
  cause: unknown,
  owner: symbol = LEGACY_SAFETY_OWNER
) {
  domain(backend).safetyLocks.set(owner, asError(cause).message);
}

export function clearAgentSafetyLockWhenIdle(backend: AgentBackendId) {
  const state = domain(backend);
  if (state.auxiliary.size > 0) return;
  state.safetyLocks.delete(LEGACY_SAFETY_OWNER);
  drain(backend, state);
}

export type AuxiliaryProcessRegistration = (() => void) & {
  owner: symbol;
};

export function registerAuxiliaryAgentProcess(
  backend: AgentBackendId,
  child: ChildProcessWithoutNullStreams,
  settled: Promise<void>
) {
  assertAgentProcessAdmission(backend);
  const state = domain(backend);
  const token = Symbol(`${backend}-auxiliary`);
  state.auxiliary.set(token, { child, settled });
  const unregister = (() => {
    state.auxiliary.delete(token);
    state.safetyLocks.delete(token);
    drain(backend, state);
  }) as AuxiliaryProcessRegistration;
  unregister.owner = token;
  return unregister;
}

export function stopAgentProcessAdmission(backend: AgentBackendId) {
  const state = domain(backend);
  state.admissionOpen = false;
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
  backend: AgentBackendId,
  clean: (pid: number) => Promise<CleanupResult> = cleanProcessGroup
) {
  const state = domain(backend);
  stopAgentProcessAdmission(backend);
  const entries = [...state.auxiliary.entries()];
  const cleanup = await Promise.allSettled(
    entries.map(async ([token, { child }]) => {
      if (child.pid) {
        const result = await clean(child.pid);
        if (!result.ok) throw result.error;
      }
      state.auxiliary.delete(token);
      state.safetyLocks.delete(token);
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

export function reopenAgentProcessAdmission(backend: AgentBackendId) {
  const state = domain(backend);
  if (state.safetyLocks.size || state.auxiliary.size > 0) return false;
  state.admissionOpen = true;
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

export function agentProcessBudgetSnapshot(backend: AgentBackendId) {
  const state = domain(backend);
  return {
    interactive: state.interactive,
    background: state.background,
    interactiveQueued: state.interactiveQueue.length,
    backgroundQueued: state.backgroundQueue.length,
  };
}

/** 只暴露数量，不泄露 child/token；测试与 shutdown 诊断据此证明无残留。 */
export function agentAuxiliaryProcessCount(backend: AgentBackendId) {
  return domain(backend).auxiliary.size;
}
