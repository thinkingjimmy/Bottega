/**
 * [INPUT]: Depends on Synchronous request, Chat incarnation, and generation identities.
 * [OUTPUT]: Provides owned non-destructive start holds, deferred-start errors, exact stop permits, and operation deduplication.
 * [POS]: Shared lifecycle boundary for dispatch, retry, request reservations, and safe quit.
 */

export type StopOperation = Readonly<{
  backend?: import("../../../../shared/agent-ipc").AgentBackendId;
  startedAt?: number;
  conversationId: string;
  incarnationId?: string;
  operationId: string;
  requestId?: string;
  generation: number;
}>;

export class StartDeferredError extends Error {
  constructor() { super("TASK_START_DEFERRED"); }
}

/** Holds never reopen an owner's permanent admission gate. */
export class StartFence {
  private readonly holds = new Set<symbol>();
  private readonly listeners = new Set<() => void>();
  get held() { return this.holds.size > 0; }
  assertOpen() { if (this.held) throw new StartDeferredError(); }
  acquire() {
    const token = Symbol("startup-hold");
    this.holds.add(token);
    return () => {
      if (!this.holds.delete(token) || this.held) return;
      for (const listener of this.listeners) {
        try { listener(); } catch (cause) { console.warn("[presence] dispatch wake failed", cause); }
      }
    };
  }
  onReleased(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

export const taskStartFence = new StartFence();
export const requestOperation = (conversationId: string, requestId: string,
  incarnationId?: string, generation = 1): StopOperation => ({
  conversationId, incarnationId, requestId, generation, operationId: `request:${requestId}`,
});
export const permitsOperation = (permit: readonly StopOperation[], current: StopOperation) =>
  permit.some((allowed) => allowed.conversationId === current.conversationId &&
    allowed.operationId === current.operationId && allowed.generation === current.generation &&
    (!allowed.incarnationId || allowed.incarnationId === current.incarnationId));

export function uniqueStopOperations(operations: readonly StopOperation[]): StopOperation[] {
  const result = new Map<string, StopOperation>();
  for (const operation of operations) {
    const key = JSON.stringify([operation.conversationId, operation.incarnationId, operation.operationId, operation.generation]);
    result.set(key, operation);
  }
  return [...result.values()];
}
