/**
 * [INPUT]: Depends on TurnRegistry projection lane, bridge, stabilization/Steer durable finalizer, port, canonical commit, projection and process group clearance only by the turn's custody launch identity or, for a bridged turn, its host-custody owner (a reused PID is never signalled; no identity, no signal; a reported PID with no identity is unverified, B2-01)
 * [OUTPUT]: Turn cleanup, resume settlement, lease release, artifact settlement, a bounded ID/port-only preview recovery projection before cleanup, ordered terminal commit and persistence sequencing.
 * [POS]: apps/desktop/electron/main/agent/bridge; The agent module's terminal transaction owner; agent-bridge is only responsible for launching, event routing and lifecycle
 * Workflow recall receipts use settled handoff facts without granting capture.
 */

import { artifactRuntime } from "../../artifacts/runtime";
import { previewFeature } from "../../preview/session/runtime";
import { encodeArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { randomUUID } from "node:crypto";
import { SubagentRegistry } from "../../../../shared/tools/subagent-registry";
import {
  clearAgentSafetyLockWhenIdle,
  reportAgentCleanupFailure,
} from "../../agent-process-supervisor";
import { providerDisplayName } from "../../backends";
import type { AgentTurn } from "../../backends/types";
import { asError } from "../../ipc/errors";
import type { CleanupResult } from "../process/process-group";
import { type TurnRegistry } from "../turns/turn/turn-registry";
import { blocksNewTurn, type SourceTerminal } from "../turns/turn/turn-registry-model";
import { prepareTurnCommit } from "../turns/commit/commit";
import type {
  AgentBridgeOptions,
  AgentEventPayload,
  AppendTurnResult,
  BridgeEntry,
} from "./bridge-types";

type FinalizerPorts = {
  turns: TurnRegistry<AgentTurn>;
  publish(entry: BridgeEntry, body: AgentEventPayload): unknown;
  publishState(entry: BridgeEntry): void;
  observe(promise: Promise<unknown>, context: string): void;
};


const PROJECTION_DRAIN_MS = 10_000;

/**
 * Settles a turn's process through its owner: host custody (every Provider runs on its bridge, B2-01) stops it only on its own proof. A
 * turn that never reported a process has run nothing; a reported PID with no owner cannot be proven ours and fails closed.
 */
export async function cleanupAgentTurn(turn: AgentTurn): Promise<CleanupResult> {
  turn.markStopped();
  const owner = turn.processOwner?.();
  if (owner) {
    return await owner.settle() === "released" ? { ok: true } : { ok: false, error: new Error(`进程 ${owner.identity.pid} 未能确认结束`) };
  }
  if (!turn.pid) return { ok: true };
  return { ok: false, error: new Error(`进程 ${turn.pid} 没有 owner，拒绝发送信号`) };
}

export function createBridgeFinalizer(ports: FinalizerPorts) {
  const { turns, publish, publishState, observe } = ports;

  async function handleResumeFailed(
    entry: BridgeEntry,
    turn: AgentTurn,
    generation: number
  ) {
    if (entry.generation !== generation) return;
    entry.memoryContribution?.release();
    entry.memoryContribution = undefined;
    entry.builtinMcp?.revoke();
    entry.builtinMcp = undefined;
    /* A resume retry reuses request/context but starts a new process: the dead attempt settles through its host-custody owner first. */
    const result = await cleanupAgentTurn(turn);
    entry.processLease?.release();
    entry.processLease = undefined;
    if (!result.ok) {
      reportAgentCleanupFailure(entry.backend, result.error);
      throw result.error;
    }
    entry.cleanup = "complete";
    turns.markResumeFailed(entry, randomUUID());
    publishState(entry);
  }

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
          ...(entry.effectiveTerminal?.facts
            ? { facts: entry.effectiveTerminal.facts }
            : {}),
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
          await artifactRuntime()?.settled(entry, result.outcome === "stored");
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
            cleanup: entry.cleanup,
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
    /* Bounded like the steer fence and the children: a projection lane that never drains must not keep a cancel "cancelling"
       forever. Past the ceiling the turn finalizes anyway and says why. */
    let ceiling: NodeJS.Timeout | undefined;
    const drained = await Promise.race([turns.drainProjections(entry).then(() => true),
      new Promise<boolean>((resolve) => { ceiling = setTimeout(() => resolve(false), PROJECTION_DRAIN_MS); })]).finally(() => clearTimeout(ceiling));
    if (!drained) console.warn(`[agent] projection drain exceeded ${PROJECTION_DRAIN_MS / 1000}s; finalizing requestId=${entry.requestId} without it`);
    turns.lockSourceTerminal(entry, source);
    const finalizing = turns.runFinalize(entry, async () => {
      for (const [agentThreadId, projection] of entry.artifacts?.children ?? []) {
        const agent = entry.subagents.get(agentThreadId);
        for (const event of await projection.settle(source.type !== "done")) {
          if (agent && event.type === "item") publish(entry, { type: "subagent-item", agentThreadId, agent, item: event.item });
        }
      }
      for (const event of await entry.artifacts?.projection.settle(source.type !== "done") ?? []) publish(entry, event);
      const preview = previewFeature(), lease = entry.builtinMcp?.lease, owner = entry.turn?.processOwner?.();
      if (source.type === "done" && preview?.consent.enabled() && lease?.previewFence && lease.allowedTools.includes("preview_server_start") && owner) {
        const captured = await preview.captures.capture({ chatId: lease.chatId, incarnationId: lease.incarnationId,
          rootPid: owner.identity.pid, rootBirth: owner.identity.birthIdentity, fence: lease.previewFence }).catch(() => []);
        // This explicit whitelist contains no private command data; encodeArtifactFence enforces the closed schema.
        const cards = captured.map(({ serverId, port }) => encodeArtifactFence({ v: 1, id: serverId, kind: "live-app", title: "Live app",
          location: "session", service: { port, lifecycle: "turn", sessionId: serverId } }));
        if (cards.length) publish(entry, { type: "item", item: { itemId: entry.requestId + "-preview-recovery", kind: "agent-message",
          title: "Live app", text: cards.join("\n\n"), status: "completed" } });
      }
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
            /* Never spawned: nothing to settle (a launch still on its way is refused once the turn's ref dies with it). */
            if (!entry.turn) return;
            /* Host custody settles the process and proves it gone before `released`, which is what lets its dependencies go. */
            const result = await cleanupAgentTurn(entry.turn);
            if (!result.ok) throw result.error;
            await entry.resolvedInput?.release();
            entry.resolvedInput = undefined;
          });
          await entry.backendSessionConfig?.releaseClaudePluginProjection?.();
          entry.backendSessionConfig = undefined;
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
            `${providerDisplayName(entry.backend)} 进程组清理失败：${error.message}`
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
          origin: entry.origin?.kind === "manual" ? "manual" : entry.origin?.kind === "workflow" ? "workflow" : "other",
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

  return { finalizeEntry, handleResumeFailed, persistEntry };
}
