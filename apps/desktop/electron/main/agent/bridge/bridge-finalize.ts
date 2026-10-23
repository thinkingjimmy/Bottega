/**
 * [INPUT]: Depends on TurnRegistry projection lane, bridge, stabilization/Steer durable finalizer, port, canonical commit, projection and process group clearance only by the turn's custody launch identity or, for a bridged turn, its host-custody owner (a reused PID is never signalled; no identity, no signal; a reported PID with no identity is unverified, B2-01)
 * [OUTPUT]: Keeps uncommitted persistence failures retryable beyond the automatic budget; verifies cleanup owners and retries effects/ACKs separately.
 * [POS]: apps/desktop/electron/main/agent/bridge; The agent module's terminal transaction owner; agent-bridge is only responsible for launching, event routing and lifecycle
 * Workflow recall receipts use settled handoff facts without granting capture.
 */

import { artifactRuntime } from "../../artifacts/core/runtime";
import { previewFeature } from "../../preview/session/runtime";
import { encodeArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { randomUUID } from "node:crypto";
import { SubagentRegistry } from "../../../../shared/tools/subagent-registry";
import {
  clearAgentSafetyLockWhenIdle,
  reportAgentCleanupFailure,
} from "../../agent-process-supervisor";
import type { AgentTurn } from "../../backends/contracts/types";
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
  type Receipt = { run(): Promise<void>; done: boolean; attempts: number; flight?: Promise<void>; timer?: ReturnType<typeof setTimeout> };
  const receipts = new WeakMap<BridgeEntry, { artifact: Receipt; business: Receipt }>();
  const receipt = (effect: () => Promise<void>, acknowledge: () => Promise<void>): Receipt => {
    let applied = false;
    return { done: false, attempts: 0, run: async () => {
      if (!applied) { await effect(); applied = true; }
      await acknowledge();
    } };
  };
  const replay = (receipt: Receipt, requestId: string) => {
    if (receipt.done) return Promise.resolve();
    if (receipt.flight) return receipt.flight;
    const flight = Promise.resolve().then(receipt.run).then(() => { receipt.done = true; }).catch(cause => {
      if (++receipt.attempts < 6) {
        receipt.timer = setTimeout(() => observe(replay(receipt, requestId), `settlement retry requestId=${requestId}`), 250 * 2 ** (receipt.attempts - 1));
        receipt.timer.unref();
      }
      throw cause;
    }).finally(() => { if (receipt.flight === flight) receipt.flight = undefined; });
    receipt.flight = flight; return flight;
  };
  const settleReceipts = (entry: BridgeEntry) => {
    const pair = receipts.get(entry);
    if (pair) {
      entry.settlementInFlight = replay(pair.business, entry.requestId);
      observe(entry.settlementInFlight, `business settlement requestId=${entry.requestId}`);
      observe(replay(pair.artifact, entry.requestId), `artifact settlement requestId=${entry.requestId}`);
    }
  };

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
    if (["stored", "empty", "missing"].includes(entry.persist)) {
      settleReceipts(entry);
      if (!receipts.has(entry) && options.onTurnSettled) await artifactRuntime()?.recoverSettlements(options.onTurnSettled);
      return;
    }
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
        const journal = artifactRuntime()?.settlements;
        const intent = entry.incarnationId ? { conversationId: entry.conversationId, incarnationId: entry.incarnationId,
          requestId: entry.requestId, assistantMessageId: entry.messageId, planRequested: entry.planRequested,
          terminal: entry.sourceTerminal?.type ?? entry.effectiveTerminal?.type ?? "error", cleanup: entry.cleanup, business: false, artifact: false } : undefined;
        let journalPrepared = false;
        const prepareJournal = async () => {
          if (!journalPrepared && intent && journal) { await journal.prepare(intent); journalPrepared = true; }
        };
        // Persist the recovery intent before append; exceptions enter the same automatic persistence retry path.
        await prepareJournal();
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
          const acknowledge = async (channel: "business" | "artifact") => {
            await prepareJournal();
            await journal?.patch(entry.requestId, { outcome: result.outcome as "stored" | "empty" | "missing" | "fatal", cleanup: entry.cleanup, [channel]: true });
          };
          receipts.set(entry, {
            artifact: receipt(async () => { await artifactRuntime()?.settled(entry, result.outcome === "stored"); }, () => acknowledge("artifact")),
            business: receipt(async () => {
              await options.onTurnSettled?.({ conversationId: entry.conversationId, requestId: entry.requestId,
                assistantMessageId: entry.messageId, planRequested: entry.planRequested, origin: entry.origin,
                context: entry.context, terminal: entry.effectiveTerminal?.type ?? "error", outcome: result.outcome,
                assistantMessage: result.storedMessage, cleanup: entry.cleanup });
            }, () => acknowledge("business")),
          });
          settleReceipts(entry);
          entry.trace?.close("complete");
        }
      } catch (cause) {
        entry.trace?.close("truncated");
        if (!["stored", "empty", "missing"].includes(entry.persist)) {
          turns.markPersist(entry, "retryable");
          publishState(entry);
        }
        if (!force && entry.retry.attempt < 6) {
          const delay = 250 * 2 ** entry.retry.attempt++;
          entry.retry.timer = setTimeout(() => { entry.retry.timer = undefined; observe(persistEntry(entry, options), `settlement receipt recovery requestId=${entry.requestId}`); }, delay);
          entry.retry.timer.unref();
        }
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
    turns.lockSourceTerminal(entry, source);
    publishState(entry);
    /* Bounded like the steer fence and the children: a projection lane that never drains must not keep a cancel "cancelling"
       forever. Past the ceiling the turn finalizes anyway and says why. */
    let ceiling: NodeJS.Timeout | undefined;
    const drained = await Promise.race([turns.drainProjections(entry).then(() => true),
      new Promise<boolean>((resolve) => { ceiling = setTimeout(() => resolve(false), PROJECTION_DRAIN_MS); })]).finally(() => clearTimeout(ceiling));
    if (!drained) console.warn(`[agent] projection drain exceeded ${PROJECTION_DRAIN_MS / 1000}s; finalizing requestId=${entry.requestId} without it`);
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
            if (childCleanupError) await turns.drainChildren(entry);
            if (!entry.turn) return;
            const resolved = entry.resolvedInput, sessionConfig = entry.backendSessionConfig, context = entry.context;
            if (source.type === "done" && await entry.turn.transferBackground?.(async () => {
              await resolved?.release();
              await sessionConfig?.releaseClaudePluginProjection?.();
              if (context) await options.releaseContext?.(context);
            })) {
              entry.resolvedInput = undefined;
              return;
            }
            /* Host custody settles the process and proves it gone before `released`, which is what lets its dependencies go. */
            const result = await cleanupAgentTurn(entry.turn);
            if (!result.ok) throw result.error;
            await entry.resolvedInput?.release();
            entry.resolvedInput = undefined;
            await entry.backendSessionConfig?.releaseClaudePluginProjection?.();
            entry.backendSessionConfig = undefined;
            if (entry.context) await options.releaseContext?.(entry.context);
          });
        } finally {
          entry.processLease?.release();
          entry.processLease = undefined;
        }
        if (!turns.hasUnverifiedCleanup(entry.backend)) {
          clearAgentSafetyLockWhenIdle(entry.backend);
        }
      } catch (cause) {
        cleanupError = asError(cause);
        reportAgentCleanupFailure(entry.backend, cleanupError);
      }
      await turns.runPostProcess(entry, async (terminal) => {
        // Source completion remains true while dependent consumers wait for verified cleanup.
        if (childCleanupError || cleanupError) {
          if (entry.appId) await options.onAppTurnFailed?.(entry.appId, entry.conversationId, entry.requestId);
          return;
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
      if (entry.cleanup === "failed") observe((async () => {
        const started = Date.now();
        for (let attempt = 1; attempt <= 3 && Date.now() - started < 20_000; attempt++) {
          await new Promise(resolve => setTimeout(resolve, attempt * 500));
          if (turns.byRequest(entry.requestId) !== entry || entry.cleanup !== "failed") return;
          try {
            await turns.acknowledgeCleanupFailure(entry.conversationId);
            if (!turns.hasUnverifiedCleanup(entry.backend)) clearAgentSafetyLockWhenIdle(entry.backend);
            publishState(entry);
            return;
          } catch { publishState(entry); }
        }
      })(), `cleanup recovery requestId=${entry.requestId}`);
    });
    return finalizing.catch((cause) => {
      entry.trace?.close("truncated");
      throw cause;
    });
  }

  return { finalizeEntry, handleResumeFailed, persistEntry };
}
