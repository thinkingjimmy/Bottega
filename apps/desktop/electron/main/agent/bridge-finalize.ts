/**
 * [INPUT]: Depends on TurnRegistry projection lane, bridge, stabilization/Steer durable finalizer, port, canonical commit, projection and process group clearance
 * [OUTPUT]: Provides Agent turn cleanup, fresh sensitive lease release, wait for orderly item, project, abort/drain child and commit structured terminals, overtime Steer state transfer, settled/persist trace and continuous sequencing with boundary retesting
 * [POS]: The agent module's terminal transaction owner; agent-bridge is only responsible for launching, event routing and lifecycle
 */

import type { AgentEventBody } from "../../../shared/agent-ipc";
import { SubagentRegistry } from "../../../shared/subagent-registry";
import {
  clearAgentSafetyLockWhenIdle,
  reportAgentCleanupFailure,
} from "../agent-process-supervisor";
import { backendById } from "../backends";
import type { AgentTurn } from "../backends/types";
import { asError } from "../errors";
import { cleanProcessGroup, type CleanupResult } from "../process-group";
import {
  blocksNewTurn,
  type SourceTerminal,
  type TurnRegistry,
} from "../turn-registry";
import { prepareTurnCommit } from "./commit";
import type {
  AgentBridgeOptions,
  AppendTurnResult,
  BridgeEntry,
} from "./bridge-types";

type AgentEventPayload = AgentEventBody extends infer Event
  ? Event extends AgentEventBody
    ? Omit<Event, "requestId">
    : never
  : never;

type FinalizerPorts = {
  turns: TurnRegistry<AgentTurn>;
  publish(entry: BridgeEntry, body: AgentEventPayload): unknown;
  publishState(entry: BridgeEntry): void;
  observe(promise: Promise<unknown>, context: string): void;
};

export async function cleanupAgentTurn(
  turn: AgentTurn
): Promise<CleanupResult> {
  turn.markStopped();
  return turn.pid ? cleanProcessGroup(turn.pid) : { ok: true };
}

export function createBridgeFinalizer(ports: FinalizerPorts) {
  const { turns, publish, publishState, observe } = ports;

  async function persistEntry(
    entry: BridgeEntry,
    options: AgentBridgeOptions,
    force = false
  ) {
    if (["stored", "empty", "missing"].includes(entry.persist)) return;
    if (entry.retry.inFlight) return entry.retry.inFlight;
    if (!entry.prepared) return;
    turns.markPersist(entry, "pending");
    publishState(entry);
    const task = (async () => {
      let forcedFailure: Error | undefined;
      try {
        await options.onTurnPrepared?.({
          conversationId: entry.conversationId,
          requestId: entry.requestId,
          assistantMessageId: entry.messageId,
          planRequested: entry.planRequested,
          origin: entry.origin,
          context: entry.context,
          terminal: entry.effectiveTerminal?.type ?? "error",
          commit: entry.prepared!,
        });
        const result = options.appendTurnResult
          ? await options.appendTurnResult(entry.conversationId, entry.prepared!)
          : ({
              outcome: entry.prepared?.message ? "stored" : "empty",
            } as AppendTurnResult);
        if (result.subagents !== undefined) {
          entry.subagents = new SubagentRegistry(result.subagents);
        }
        turns.markPersist(entry, result.outcome);
        entry.trace?.recordPersist(entry.generation, result.outcome);
        publish(entry, {
          type: "turn-persisted",
          terminal: entry.effectiveTerminal?.type ?? "error",
          ...(entry.effectiveTerminal?.message
            ? { message: entry.effectiveTerminal.message }
            : {}),
          outcome: result.outcome,
          blocksNewTurn: blocksNewTurn(entry),
          cleanup: entry.cleanup,
          ...(result.storedMessage
            ? { assistantMessage: result.storedMessage }
            : {}),
          ...(result.subagents !== undefined
            ? { subagents: result.subagents }
            : {}),
        });
        publishState(entry);
        if (result.outcome === "retryable") {
          if (force) {
            forcedFailure =
              result.error ?? new Error("turn 持久化重试失败");
          } else {
            const delay = Math.min(30_000, 250 * 2 ** entry.retry.attempt++);
            entry.retry.timer = setTimeout(() => {
              entry.retry.timer = undefined;
              observe(
                persistEntry(entry, options),
                `persist retry requestId=${entry.requestId}`
              );
            }, delay);
          }
        }
        if (result.outcome === "fatal" && force) {
          forcedFailure =
            result.error ?? new Error("turn 持久化发生不可恢复错误");
        }
        if (["stored", "empty", "missing", "fatal"].includes(result.outcome)) {
          await options.onTurnSettled?.({
            conversationId: entry.conversationId,
            requestId: entry.requestId,
            assistantMessageId: entry.messageId,
            planRequested: entry.planRequested,
            origin: entry.origin,
            context: entry.context,
            terminal: entry.effectiveTerminal?.type ?? "error",
            outcome: result.outcome,
            assistantMessage: result.storedMessage,
          });
          entry.trace?.close("complete");
        }
      } catch (cause) {
        entry.trace?.close("truncated");
        throw cause;
      }
      if (forcedFailure) {
        if (entry.persist === "retryable") {
          entry.trace?.close("truncated");
        }
        throw forcedFailure;
      }
    })();
    const inFlight = task.finally(() => {
      if (entry.retry.inFlight === inFlight) entry.retry.inFlight = undefined;
    });
    entry.retry.inFlight = inFlight;
    return inFlight;
  }

  async function finalizeEntry(
    entry: BridgeEntry,
    source: SourceTerminal,
    options: AgentBridgeOptions,
    expectedGeneration?: number
  ) {
    if (entry.phase === "retry-claiming") {
      await turns.waitForRetryClaim(entry);
    }
    if (
      expectedGeneration !== undefined &&
      entry.generation !== expectedGeneration
    ) {
      return;
    }
    await turns.drainProjections(entry);
    turns.lockSourceTerminal(entry, source);
    const finalizing = turns.runFinalize(entry, async () => {
      entry.memoryContribution?.release();
      entry.memoryContribution = undefined;
      const fence = await turns.closeSteerFence(entry);
      if (fence.timedOutEpochs.length) {
        await options.onSteerFenceTimeout?.({
          requestId: entry.requestId,
          opEpochs: fence.timedOutEpochs,
        });
      }
      entry.builtinMcp?.revoke();
      entry.builtinMcp = undefined;
      let childCleanupError: Error | undefined;
      try {
        await turns.drainChildren(entry);
      } catch (cause) {
        childCleanupError = asError(cause);
      }
      if (entry.sourceTerminal?.type === "cancelled") {
        turns.requestCancel(entry);
      }
      if (entry.phase !== "active") {
        entry.resolvedInput?.rollback();
        entry.resolvedInput = undefined;
      }
      let cleanupError: Error | undefined;
      try {
        try {
          await turns.runCleanup(entry, async () => {
            if (!entry.turn) {
              /* 从未 spawn 过：唯一诚实的收口是 pre-owned tombstone。
                 这里编一个 PID 出来，重启后就会有人照着它去杀无辜进程。 */
              await entry.custody?.abort("cancelled-before-owned");
              entry.custody = undefined;
              return;
            }
            /* durable「打算释放」先于任何信号；顺序反了的话，kill 途中崩溃
               就分不清信号到底发没发过。 */
            await entry.custody?.beginRelease();
            const result = await cleanupAgentTurn(entry.turn);
            if (!result.ok) throw result.error;
            /* settle 自己再验一次进程身份：`cleanProcessGroup` 没抛错只是
               间接证据，而 released 是要拿去解锁 generation GC 的。 */
            await entry.custody?.settle();
            entry.custody = undefined;
            await entry.resolvedInput?.release();
            entry.resolvedInput = undefined;
          });
          /* dependency 只能在 custody 收口之后释放，而且必须在同一条路径上：
             上面任何一步抛出，这一行就不会执行，generation 于是继续被账本
             钉住，交给下次启动的 reconcile 收敛——这正是 D33 要的顺序。 */
          if (entry.context) await options.releaseContext?.(entry.context);
        } finally {
          entry.processLease?.release();
          entry.processLease = undefined;
        }
        if (!turns.hasCleanupFailure(entry.backend)) {
          clearAgentSafetyLockWhenIdle(entry.backend);
        }
      } catch (cause) {
        cleanupError = asError(cause);
        reportAgentCleanupFailure(entry.backend, cleanupError);
      }
      await turns.runPostProcess(entry, async (terminal) => {
        if (childCleanupError || cleanupError) {
          const error = childCleanupError ?? cleanupError!;
          throw new Error(
            `${backendById(entry.backend).displayName} 进程组清理失败：${error.message}`
          );
        }
        if (terminal.type === "done" && entry.appId) {
          await options.onAppTurnCompleted(
            entry.appId,
            entry.conversationId,
            entry.requestId
          );
        } else if (entry.appId) {
          await options.onAppTurnFailed?.(
            entry.appId,
            entry.conversationId,
            entry.requestId
          );
        }
      });
      entry.promptHandoff =
        (await entry.turn?.promptHandoff?.()) ?? { kind: "not-created" };
      const prepared = turns.prepare(
        entry,
        prepareTurnCommit(entry, {
          origin: entry.origin?.kind === "manual" ? "manual" : "other",
          frozenAdmission: entry.context?.memory ?? null,
          prepared: entry.memoryRecall?.prepared ?? null,
          prePromptValidation:
            entry.memoryPrePromptValidation ?? { kind: "not-run" },
          promptHandoff: entry.promptHandoff,
        })
      );
      entry.trace?.recordSettled(
        entry.generation,
        prepared.message,
        entry.effectiveTerminal?.type ?? "error"
      );
      await persistEntry(entry, options);
    });
    return finalizing.catch((cause) => {
      entry.trace?.close("truncated");
      throw cause;
    });
  }

  return { finalizeEntry, persistEntry };
}
