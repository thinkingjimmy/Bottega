/**
 * [INPUT]: Depends on the backend registry, TurnRegistry, synchronous Steer policy, payload validation, Project Tools receipts and the MCP plan binding guard, Chat commit, Gallery, Memory, MCP leases, artifact capture sessions, frozen sessions, retry guards and credential reservations
 * [OUTPUT]: Provides canonical execution, main-only session prompt evidence, scoped availability, Project policy narrowing, MCP/session guards, typed finalization (only availability gates may say "install or update"; a Stop during the process-slot wait cancels), StartNotDispatchedError for every start that failed before an Agent process existed, generation-scoped Stop, interaction/retry IPC with authorized saved-history session replacement carrying the original user identity, and shutdown (which returns only after every settling turn has finished its ledger writes); a turn starts on turnBackend (a built-in's host code or an available package Provider's DescriptorBackend; nothing runs it: runtime-unavailable), and a package turn gets no plan check, third-party MCP plan or App session config.
 * Workflow turns isolate native Skills and omit ambient backend plugin projections while preserving Provider settings.
 * Workflow turns disable native Provider memory; quit judges remaining safety locks after runtime and turn owners settle. Explicit application exit may report background cleanup separately once all turn persistence succeeds.
 * [POS]: apps/desktop/electron/main/agent/bridge; Main-process multi-backend turn executor; the conversation coordinator supplies already-admitted manual intent
 */

import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { artifactRuntime } from "../../artifacts/runtime";
import { type BrowserWindow } from "electron";
import {
  AGENT_BACKEND_ORDER,
  type AgentSendPayload,
  type SessionRef,
} from "../../../../shared/ipc/agent/agent-ipc";
import { stagedInputReadRoots } from "./agent-input";
import { workflowTurnPolicyFor } from "../../workflows/turn-policy";
import { workflowNativeSkillRoots } from "../../agent-configs/selection";
import { parseAgentPayloadForStart } from "../validation";
import {
  AgentProcessAdmissionError,
  acquireAgentProcessLease,
  reserveAgentCredentialUse,
  agentProcessSafetyLock,
  assertAgentProcessAdmission,
  clearAgentSafetyLockWhenIdle,
  reopenAgentProcessAdmission,
  shutdownAuxiliaryAgentProcesses,
  stopAllAgentProcessAdmission,
} from "../../agent-process-supervisor";
import { backendRuntimeRegistry, turnBackend } from "../../backends";
import { builtinAgent } from "../../../../shared/chat-agent/options";
import type { AgentTurn, ResolvedRuntime, ResolvedAgentInput, TrustedTurnAuthority } from "../../backends/types";
import {
  assertBackendCapabilities,
  assertModelCapabilities,
  assertResolvedInputCapabilities,
} from "../../backends/runtime/capability-validation";
import { asError, withDeadline } from "../../ipc/errors";
import {
  ProductFailureError,
  agentRuntimeFailure,
  diagnosticFailureDetails,
} from "../../../../shared/product/product-failure";
import { acpStartupBackstopMs } from "../../backends/acp/startup/budget";
import { createAgentBridgeIpcHandlers, registerAgentBridgeIpc } from "./bridge-ipc";
export { steerCarriesStagedSnapshot, steerTurnCanConsume } from "../controls/steering";
import type {
  AgentBridgeOptions,
  AgentContext,
  BridgeEntry,
  ConversationAdmission,
  TurnOrigin,
} from "./bridge-types";
import { executableIdentity } from "../../custody/identity";
import { createTurnCallbacks } from "../turns/turn/turn-callbacks";
import { assertThirdPartyMcpPlanBinding } from "../admission/tool-plan-guard";
import { ensurePersistedForDrain } from "../turns/drain/drain-guard";
import { assertAgentAvailable, assertInstalledRuntime } from "../admission/runtime-gate";
import { switchActivityReason } from "../turns/turn/turn-actions";
import {
  retryAgentSameSession,
  retryAgentWithoutSession,
} from "../turns/retry/retry";
import { createBridgeFinalizer } from "./bridge-finalize";
import { TokenizedSubscriptionBroker } from "../../ipc/subscription-broker";
import { ThreadScopeRegistry } from "../turns/thread/thread-scope";
import { TurnRegistry } from "../turns/turn/turn-registry";
import { blocksNewTurn, turnMessageId } from "../turns/turn/turn-registry-model";
import { AcpTraceWriter, acpTraceEnabled } from "../../backends/acp/trace";
import type { BuiltinMcpLease } from "../../tools/lease";
import { createSubagentChannel, type SubagentChannel } from "../subagents/subagent-channel";
import { unavailableRecallProjection } from "../../memory/service/memory-status";
import { MEMORY_RECALL_TOTAL_TIMEOUT_MS } from "../../memory/prompt-lane";
import { isActiveImageOccurrence } from "../../gallery/agent-image-projection";
import type { ActiveImageSourceRef } from "../../gallery/agent-image-projection";
import { assertPlatformCapability } from "../../../../shared/platform/platform-capabilities";
import { AgentActivityPublisher } from "../activity-publisher";
import { installAcpDraftTrace } from "../trace-observer";
import type { HydratedProjectTools } from "../../sections/coordinator/admission/prepared-project-tools";
import { createBridgeEventPublisher } from "./bridge-event-publisher";
import { snapshotStopOperations } from "../snapshots/stop-operations";
import { taskStartFence, StartDeferredError, StartNotDispatchedError, requestOperation, type StopOperation } from "../../presence/lifecycle/start-fence";

import { createSteeringOperations } from "./steering";

export const turns = new TurnRegistry<AgentTurn>();
installAcpDraftTrace(turns);
export const { registerAgentSteerOperation, steerAgentTurn } = createSteeringOperations(turns);
const subscriptions = new TokenizedSubscriptionBroker<BrowserWindow>();
const requestReservations = new Map<string, { operation: StopOperation; settled: Promise<void> }>();

export const agentStopOperations = () => snapshotStopOperations(turns.liveEntries(), [...requestReservations.values()].map(({ operation }) => operation));

async function drainRequestReservations() {
  while (requestReservations.size) await Promise.all([...requestReservations.values()].map(({ settled }) => settled));
}
const threadScopes = new ThreadScopeRegistry();
const turnAuthorities = new WeakMap<BridgeEntry, TrustedTurnAuthority>();
export const activity = new AgentActivityPublisher(turns);
let shuttingDown = false;
const { publish, publishState, observe } = createBridgeEventPublisher({
  turns,
  subscriptions,
  activity,
  options: () => lastOptions,
});
const { finalizeEntry, handleResumeFailed, persistEntry } = createBridgeFinalizer({
  turns,
  publish,
  publishState,
  observe,
});

export { ensurePersistedForDrain } from "../turns/drain/drain-guard";
export {
  assertModelCapabilities,
  assertResolvedInputCapabilities,
} from "../../backends/runtime/capability-validation";
export type { SubagentChannel } from "../subagents/subagent-channel";

export function hasActiveImageOccurrence(sourceRef: ActiveImageSourceRef) {
  return isActiveImageOccurrence(
    (chatId) => turns.byConversation(chatId) as BridgeEntry | undefined,
    sourceRef
  );
}

export function openSubagentChannel(
  lease: BuiltinMcpLease
): SubagentChannel | undefined {
  return createSubagentChannel(lease, turns, publish);
}

async function spawnAgent(
  entry: BridgeEntry,
  payload: AgentSendPayload,
  context: AgentContext,
  options: AgentBridgeOptions,
  reuseInput?: ResolvedAgentInput,
  trustedAuthority?: TrustedTurnAuthority
) {
  /* A built-in's host code or an available package Provider's DescriptorBackend; nothing runs it: the named runtime-unavailable. */
  const backend = turnBackend(payload.turnOptions.backend), builtin = builtinAgent(backend.id);
  const generation = entry.generation;
  let resolvedInput = reuseInput;
  let credentialUse: ReturnType<typeof reserveAgentCredentialUse> | undefined;
  try {
    credentialUse = reserveAgentCredentialUse(backend.id);
    await credentialUse.ready;
    assertAgentProcessAdmission(backend.id);
    let runtime: ResolvedRuntime | undefined;
    let runtimeGeneration: number | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await backendRuntimeRegistry.resolveForSpawn(backend.id);
      const gateTarget = await backendRuntimeRegistry.executionTarget(backend.id, snapshot, {
        cwd: context.workspace, model: payload.turnOptions.model ?? undefined,
      });
      assertAgentAvailable(snapshot, backend.displayName, {
        conversationId: payload.scope.conversationId, requestId: payload.requestId, target: gateTarget,
      });
      assertBackendCapabilities(backend, payload, snapshot.capabilities);
      entry.processLease = await acquireAgentProcessLease(backend.id, "interactive", entry.childController.signal);
      await assertModelCapabilities(
        backend,
        payload,
        snapshot.runtime,
        context.workspace,
        entry.childController.signal
      );
      if (payload.planMode && builtin) {
        await options.assertPlanAvailable?.(
          true,
          context.workspace,
          builtin
        );
      }
      if (await backendRuntimeRegistry.confirmForSpawn(backend.id, snapshot)) {
        assertAgentProcessAdmission(backend.id);
        context =
          (await options.finalizeContextForRuntime?.(context, snapshot)) ??
          context;
        entry.context = context;
        resolvedInput ??= await options.resolveInput(
          payload,
          context.workspace,
          snapshot.capabilities,
          context
        );
        resolvedInput =
          (await options.mergeLateInput?.(resolvedInput, payload.requestId)) ??
          resolvedInput;
        assertResolvedInputCapabilities(
          backend,
          resolvedInput.input,
          snapshot.capabilities
        );
        if (!entry.recallAttempted) {
          entry.recallAttempted = true;
          try {
            const workflow = entry.origin?.kind === "workflow" ? workflowTurnPolicyFor(entry.requestId) : null;
            const queryText = entry.origin?.kind === "manual" ? entry.origin.queryText : workflow?.workflowMemoryRead ? workflow.recallQuery : undefined;
            if (context.memory && queryText !== undefined) {
              entry.memoryRecall = await options.recallMemory?.({
                admission: context.memory,
                queryText,
                signal: entry.childController.signal,
                deadlineAt: Date.now() + MEMORY_RECALL_TOTAL_TIMEOUT_MS,
              });
            }
          } catch {
            /* Memory façade 契约上不抛；若抛，必须落回闭集 unavailable——
               eligible + 无 prepared 不在 §9.5 事实表里，不能留空洞。 */
            if (context.memory?.kind === "eligible") {
              entry.memoryRecall = unavailableRecallProjection(
                context.memory.context.requestId,
                "provider"
              );
            }
          }
        }
        context.activeCapabilities = { ...snapshot.capabilities };
        const target = await backendRuntimeRegistry.executionTarget(backend.id, snapshot, { cwd: context.workspace, model: payload.turnOptions.model ?? undefined });
        context.availabilityStart = backendRuntimeRegistry.evidence.beginTurn(entry.conversationId, entry.requestId, target);
        runtime = snapshot.runtime;
        runtimeGeneration = snapshot.generation;
        break;
      }
      entry.processLease.release();
      entry.processLease = undefined;
    }
    if (!runtime || runtimeGeneration === undefined || !resolvedInput) {
      throw new Error(`${backend.displayName} CLI 文件身份持续变化，已拒绝启动`);
    }
    /* A package Provider's turn gets no third-party MCP plan: no package has proved it honours one (d4b follow-up slice 2). */
    entry.thirdPartyMcpPlan ??= !builtin ? undefined : options.resolveThirdPartyMcpPlan?.({
      backendId: builtin,
      backendRuntimeIdentity: `${backend.id}@${runtime.version}`,
      planMode: Boolean(payload.planMode),
      origin: entry.origin,
      context,
    });
    if (entry.thirdPartyMcpPlan) {
      assertThirdPartyMcpPlanBinding(entry.thirdPartyMcpPlan, context.preparedProjectTools, payload.session);
    }
    const artifactDirectory = await artifactRuntime()?.directory(entry.conversationId);
    const builtinMcp = entry.builtinMcp = options.issueBuiltinMcp?.(payload, generation, entry.origin, context);
    /* Every turn runs on its Provider's bridge, its process in host custody alone (TASK-11 D7, flip): no agent-turn custody entry. */
    const memoryContribution =
      context.memory && entry.memoryRecall
        ? options.prepareMemoryContribution?.(
            context.memory,
            entry.memoryRecall
          )
        : null;
    entry.memoryContribution = memoryContribution
      ? { release: () => memoryContribution.release() }
      : undefined;
    /* A package Provider's turn has no App-configured session config (d4b follow-up slice 2). */
    entry.backendSessionConfig ??= builtin ? await options.freezeBackendSessionConfig?.(builtin, {
      isolateSkills: entry.origin?.kind === "workflow",
    }) : undefined;
    const artifactContext = artifactDirectory
      ? `When the user asks to see a chart, page or other visualization, write it as a standalone HTML or SVG file under ${artifactDirectory} and reply with one standalone line visualize{"path":"absolute file path","title":"Short title"}; the HTML may use relative local resources and must not be inlined in the reply. Deliverable documents (pdf, docx, xlsx, pptx) that are not part of the project source also belong in that directory. Project files stay in the project.`
      : "";
    const turn = backend.createTurn({
      disableProviderMemory: context.builtinToolPolicy?.workflowStep === true,
      sessionRecovery: context.sessionRecovery,
      onSessionPrompt: context.onSessionPrompt,
      ...(artifactDirectory ? { artifactDirectory } : {}),
      ...(trustedAuthority ? { trustedAuthority } : {}),
      /* entry.payload keeps persisted intent. The derived wire snapshot alone
         honors a same-session fallback until an explicit model/Speed action. */
      payload: threadScopes.payloadForTurn(payload),
      input: resolvedInput,
      productContext: [context.finalTurnProjection?.productContext, artifactContext].filter(Boolean).join("\n\n"),
      ...(memoryContribution
        ? {
            sensitiveContribution: memoryContribution,
            onPromptContributionValidation: (value) => {
              entry.memoryPrePromptValidation = value;
              entry.memoryContribution?.release();
              entry.memoryContribution = undefined;
            },
          }
        : {}),
      ...(context.custodyDependencies?.length ? { custodyDependencies: context.custodyDependencies } : {}),
      callbacks: createTurnCallbacks(
        { turns, threadScopes, publish, observe, finalizeEntry },
        { entry, generation, backend, runtimeGeneration, options, context, trustedAuthority }
      ),
      runtime,
      serverFactBinding: {
        runtimeGeneration,
        executableIdentity: executableIdentity(runtime.executable),
      },
      workspace: context.workspace,
      ...(entry.origin?.kind === "workflow" ? { skillIsolation: {
        deniedRoots: workflowNativeSkillRoots(backend.id, context.workspace, backend.skills),
      } } : {}),
      processEnv: context.appId
        ? await options.resolveAppEnvironment?.(context.appId)
        : undefined,
      ...(entry.backendSessionConfig
        ? { backendSessionConfig: entry.backendSessionConfig }
        : {}),
      // Only this bridge has both the frozen grants and staged input roots;
      // authorize them together before any backend starts reading attachments.
      ...(context.filesystemAccess
        ? {
            filesystemAccess: {
              ...context.filesystemAccess,
              readOnlyRoots: [
                ...context.filesystemAccess.readOnlyRoots,
                ...stagedInputReadRoots(resolvedInput.input),
              ],
            },
          }
        : {}),
      subagents: entry.subagents,
      ...(entry.trace
        ? {
            trace: entry.trace.sink(generation, {
              secrets: (entry.thirdPartyMcpPlan?.entries ?? []).flatMap(
                (server) => Object.values(
                  server.transport === "stdio" ? server.env : server.headers
                )
              ),
            }),
          }
        : {}),
      ...(builtinMcp
        ? {
            builtinMcp: {
              server: builtinMcp.server,
              lease: builtinMcp.lease,
              waitReady: builtinMcp.waitReady,
            },
          }
        : {}),
      ...(entry.thirdPartyMcpPlan
        ? { thirdPartyMcpPlan: entry.thirdPartyMcpPlan }
        : {}),
    });
    turns.bindTurn(entry, turn, resolvedInput);
    const startupController = new AbortController();
    // AcpTurn reports individual startup steps; this deadline catches only a
    // start operation that never settles and is therefore an internal failure.
    await trustedAuthority?.validate(); trustedAuthority?.current();
    const outcome = await withDeadline(
      turn.start(startupController.signal),
      acpStartupBackstopMs(),
      () => {
        startupController.abort();
        return new Error(`${backend.displayName} 启动链未在总预算内结算（内部错误）`);
      }
    );
    if (outcome === "resume-failed") {
      await handleResumeFailed(entry, turn, generation);
      return;
    }
    if (entry.generation !== generation) return;
    if (turns.activate(entry)) {
      publishState(entry);
      await options.onTurnStarted?.({
        conversationId: entry.conversationId,
        requestId: entry.requestId,
        explicitDesign: resolvedInput.input.some(
          (item) => item.type === "skill" && item.name === "design"
        ),
        context,
      });
    }
    if (entry.startup?.cancelRequested || shuttingDown) {
      await finalizeEntry(entry, { type: "cancelled" }, options, generation);
    }
  } catch (cause) {
    if (entry.generation !== generation) return;
    entry.builtinMcp?.revoke();
    entry.builtinMcp = undefined;
    if (!entry.turn) resolvedInput?.rollback();
    /* Availability gates throw a typed ProductFailure; only they may ask to install or update the Agent. A Stop
       while waiting for a process slot is a cancel, a closed or locked backend is a service problem, and anything
       else (a missing Chat folder, a drifted identity) is unclassified rather than blamed on the install. */
    const cancelled = entry.startup?.cancelRequested || (cause instanceof AgentProcessAdmissionError && cause.reason === "cancelled");
    const terminal = cause instanceof ProductFailureError ? { type: "error" as const, failure: cause.failure }
      : cancelled ? { type: "cancelled" as const }
      : { type: "error" as const, failure: agentRuntimeFailure(cause instanceof AgentProcessAdmissionError ? "service-unavailable" : "unknown",
        diagnosticFailureDetails(asError(cause).message)) };
    await finalizeEntry(entry, terminal, options, generation);
  } finally { credentialUse?.release(); }
}

export function claimAgentRequest(backend: ProviderId, requestId: string, conversationId = requestId, incarnationId?: string) {
  taskStartFence.assertOpen();
  assertAgentProcessAdmission(backend);
  if (shuttingDown) throw new Error("应用正在退出，不能启动新请求");
  if (requestReservations.has(requestId) || turns.byRequest(requestId)) {
    throw new Error("requestId 正在执行");
  }
  const credentialUse = reserveAgentCredentialUse(backend);
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  requestReservations.set(requestId, { operation: requestOperation(conversationId, requestId, incarnationId), settled });
  return Object.assign(() => { requestReservations.delete(requestId); credentialUse.release(); finish(); }, { ready: credentialUse.ready });
}

export type { AgentBridgeOptions, AgentContext, ConversationAdmission } from "./bridge-types";

export async function startAgentPayload(
  rawPayload: unknown,
  options = lastOptions,
  assistantMessageId?: string,
  origin?: TurnOrigin,
  reuseInput?: ResolvedAgentInput,
  reservedAssistantSeq?: number,
  admissionHeld = false,
  preparedProjectTools?: HydratedProjectTools,
  trustedAuthority?: TrustedTurnAuthority
) {
  if (!options) throw new Error("Agent bridge 尚未初始化");
  if (options.platformSupport) {
    assertPlatformCapability(options.platformSupport, "agentTurns");
  }
  const payload = parseAgentPayloadForStart(
    rawPayload,
    origin,
    preparedProjectTools?.receipt.projectContext
  );
  const backend = turnBackend(payload.turnOptions.backend);
  /* Until turns.claim no Agent process exists for this start, so every failure before it is "not dispatched". */
  let dispatched = false, releaseReservation: ReturnType<typeof claimAgentRequest> | undefined;
  try {
  releaseReservation = claimAgentRequest(backend.id, payload.requestId, payload.scope.conversationId,
    options.conversationIncarnation?.(payload.scope.conversationId));
  await releaseReservation.ready;
  const snapshot = await backendRuntimeRegistry.resolve(backend.id);
  taskStartFence.assertOpen();
  assertInstalledRuntime(snapshot, backend.displayName);
  assertBackendCapabilities(backend, payload, snapshot.capabilities);
  await options.assertChatBackend?.(
    payload.scope.conversationId,
    backend.id
  );
  taskStartFence.assertOpen();
  trustedAuthority?.current();
  await options.assertTurnAdmission?.(payload, trustedAuthority);
  taskStartFence.assertOpen();
  const safetyLockReason = agentProcessSafetyLock(backend.id);
  if (safetyLockReason) {
    throw new Error(
      `${backend.displayName} 已进入安全锁定：${safetyLockReason}`
    );
  }
  if (payload.session) {
    threadScopes.assertResume(payload.session, payload.scope.conversationId);
  }
  // The coordinator already holds the project lifecycle gate when admissionHeld
  // is true; reacquiring it would deadlock the same submission.
  const admission: ConversationAdmission = admissionHeld
    ? (_conversationId, register) => register()
    : options.withConversationAdmission;
  try {
    await admission(
      payload.scope.conversationId,
      async () => {
        const context = await options.resolveContext(
          payload.scope.conversationId,
          payload,
          origin,
          preparedProjectTools
        );
        if (preparedProjectTools && !context.preparedProjectTools) {
          context.preparedProjectTools = preparedProjectTools;
        }
        let contextRetained = false;
        try {
          taskStartFence.assertOpen();
          if (shuttingDown) throw new StartDeferredError();
          const currentSnapshot = await backendRuntimeRegistry.resolve(backend.id);
          const target = await backendRuntimeRegistry.executionTarget(backend.id, currentSnapshot, {
            cwd: context.workspace, model: payload.turnOptions.model ?? undefined,
          });
          assertAgentAvailable(currentSnapshot, backend.displayName, {
            conversationId: payload.scope.conversationId, requestId: payload.requestId, target,
          });
          taskStartFence.assertOpen();
          if (shuttingDown) throw new StartDeferredError();
          if (
            blocksNewTurn(
              turns.byConversation(payload.scope.conversationId)
            )
          ) {
            throw new Error("当前聊天已有请求正在执行");
          }
          const subagents = await options.loadSubagents?.(
            payload.scope.conversationId
          );
          const assistantSeq =
            reservedAssistantSeq ??
            (await options.reserveAssistantSequence?.(
              payload.scope.conversationId
            ));
          if (assistantSeq === undefined) {
            throw new Error("聊天消息序号 allocator 未配置");
          }
          taskStartFence.assertOpen();
          if (shuttingDown) throw new StartDeferredError();
          turns.seedSubagents(payload.scope.conversationId, subagents);
          const entry = turns.claim({
            backend: backend.id,
            conversationId: payload.scope.conversationId,
            requestId: payload.requestId,
            planRequested: Boolean(payload.planMode),
            origin,
            ...(assistantMessageId ? { messageId: assistantMessageId } : {}),
            assistantSeq,
            appId: context.appId,
          }) as BridgeEntry;
          dispatched = true;
          entry.incarnationId = options.conversationIncarnation?.(entry.conversationId);
          contextRetained = true;
          entry.payload = payload;
          if (trustedAuthority) turnAuthorities.set(entry, trustedAuthority);
          entry.context = context;
          if (acpTraceEnabled() && options.traceDirectory) {
            try {
              entry.trace = new AcpTraceWriter(
                options.traceDirectory,
                entry.conversationId,
                entry.assistantSeq,
                entry.backend
              );
            } catch (cause) {
              console.warn("[acp-trace] recorder unavailable", cause);
            }
          }
          publishState(entry);
          const startup = spawnAgent(entry, payload, context, options, reuseInput, trustedAuthority);
          turns.setStartup(entry, startup);
          observe(startup, `startup requestId=${payload.requestId}`);
        } finally {
          if (!contextRetained) await options.releaseContext?.(context);
        }
      }
    );
  } catch (cause) {
    if (cause instanceof StartDeferredError) throw cause;
    const message = `${backend.displayName} 启动失败：${asError(cause).message}`;
    throw dispatched ? new Error(message) : new StartNotDispatchedError(message, { cause });
  }
  } catch (cause) {
    if (dispatched || cause instanceof StartDeferredError || cause instanceof StartNotDispatchedError) throw cause;
    throw new StartNotDispatchedError(asError(cause).message, { cause });
  } finally { releaseReservation?.(); }
}

export function seedThreadScope(session: SessionRef, conversationId: string) {
  threadScopes.bind(session, conversationId);
}

/** lifecycle cwd 迁移后撤销旧 CLI session 的 main-side resume 权限。 */
export function releaseThreadScopeForConversation(conversationId: string) {
  threadScopes.releaseConversation(conversationId);
}

// Reset model/Speed fallback in the session, live entry, and renderer together
// so explicit preference changes cannot leave stale fallback state visible.
export function resetThreadServiceTierEffective(conversationId: string) {
  threadScopes.resetServiceTierEffective(conversationId);
  const entry = turns.byConversation(conversationId) as BridgeEntry | undefined;
  if (entry) publish(entry, { type: "service-tier-effective" });
}

export function registerAgentBridge(
  window: BrowserWindow,
  rendererUrl: string,
  options: AgentBridgeOptions
) {
  lastOptions = options;
  activity.bind(window);
  const retry = (
    mode: typeof retryAgentSameSession,
    requestId: string,
    retryToken: string,
    authority?: TrustedTurnAuthority
  ) => mode({
    turns,
    requestId,
    retryToken,
    prepareFreshInput: async (entry) => {
      const currentAuthority = authority ?? turnAuthorities.get(entry as BridgeEntry);
      await currentAuthority?.validate(); currentAuthority?.current();
      await options.assertTurnAdmission?.(entry.payload!, currentAuthority);
      return options.prepareFreshRetry?.(entry.payload!, turnMessageId(entry.origin));
    },
    replaceSession: (entry, oldSession) =>
      Promise.resolve(
        options.replaceSession?.(entry.conversationId, oldSession, null)
      ).then(() => {
        threadScopes.releaseSession(oldSession, entry.conversationId);
      }),
    publishState: (entry) => publishState(entry as BridgeEntry),
    onGenerationStart: (entry, generation) =>
      (entry as BridgeEntry).trace?.recordGenerationStart(generation),
    restart: (entry, input) => {
      const bridgeEntry = entry as BridgeEntry;
      // The remote authority governs this attempt only; persisting it would expire
      // the entry's own authority and break later local recovery actions.
      const startup = spawnAgent(
        bridgeEntry,
        bridgeEntry.payload!,
        bridgeEntry.context!,
        options,
        input,
        authority ?? turnAuthorities.get(bridgeEntry)
      );
      turns.setStartup(bridgeEntry, startup);
      observe(startup, `resume retry requestId=${entry.requestId}`);
    },
  });
  const handlers = createAgentBridgeIpcHandlers({
    turns,
    attachSnapshot: (conversationId) => {
      const snapshot = turns.attachSnapshot(conversationId);
      return {
        ...snapshot,
        turn: snapshot.turn && options.projectTurnSnapshot
          ? options.projectTurnSnapshot(conversationId, snapshot.turn)
          : snapshot.turn,
      };
    },
    subscriptions,
    listActivity: () => activity.list(),
    publishState: (entry) => publishState(entry as BridgeEntry),
    clearSafetyLock: clearAgentSafetyLockWhenIdle,
    retryWithoutSession: (requestId, retryToken, trusted) =>
      retry(retryAgentWithoutSession, requestId, retryToken, trusted?.authority),
    retrySameSession: (requestId, retryToken, trusted) =>
      retry(retryAgentSameSession, requestId, retryToken, trusted?.authority),
    cancel: (requestId) => cancelAgentTurn(requestId, options),
    steer: (input) => {
      if (!options.steer) throw new Error("steering 服务未配置");
      return options.steer(input);
    },
    decideSteer: (input) => {
      if (!options.decideSteer) throw new Error("steering 裁决服务未配置");
      return options.decideSteer(input);
    },
    ackSteerIntents: (outboxRefs) =>
      options.ackSteerIntents?.(outboxRefs) ?? Promise.resolve(),
    steerSnapshot: (conversationId) => options.steerSnapshot?.(conversationId) ?? [],
    conversationForOutboxRef: (outboxRef) => options.conversationForOutboxRef?.(outboxRef),
  });
  registerAgentBridgeIpc(window, rendererUrl, handlers);
}
let lastOptions: AgentBridgeOptions | undefined;
export function cancelAgentTurn(
  requestId: string,
  options = lastOptions
) {
  const entry = turns.byRequest(requestId) as BridgeEntry | undefined;
  if (!entry || !blocksNewTurn(entry) || !options) return;
  /* A Stop during "retry in a new session" is carried into the new generation by the registry; finalizing here
     without the generation would settle that new generation while its process is still starting (F-31). */
  const generation = entry.generation;
  turns.requestCancel(entry);
  const afterStartup =
    entry.startup?.task.catch(() => {}) ?? Promise.resolve();
  observe(
    afterStartup.then(() =>
      finalizeEntry(entry, { type: "cancelled" }, options, generation)
    ),
    `cancel requestId=${requestId}`
  );
}
async function drainEntry(
  entry: BridgeEntry,
  options?: AgentBridgeOptions
) {
  turns.requestCancel(entry);
  await entry.startup?.task.catch(() => {});
  if (!options) {
    if (blocksNewTurn(entry)) {
      throw new Error("Agent bridge 尚未注册持久化 owner");
    }
    return;
  }
  await finalizeEntry(entry, { type: "cancelled" }, options);
  /* At quit a result that can never be written is abandoned, as the person would from the Chat; otherwise it wedges every quit (F-27). */
  if (shuttingDown && entry.persist === "fatal") { turns.abandonFatalTurn(entry.conversationId); return; }
  await ensurePersistedForDrain(entry, () =>
    persistEntry(entry, options, true)
  );
  if (entry.cleanup === "failed") {
    throw new Error(`${entry.backend} cleanup 失败，安全锁仍驻留`);
  }
}
export async function shutdownAllAgents(options: { onBackgroundCleanupFailure?(cause: unknown): void } = {}) {
  shuttingDown = true;
  stopAllAgentProcessAdmission();
  await drainRequestReservations();
  const results = await Promise.allSettled([
    backendRuntimeRegistry.shutdown(),
    turns.drain(
      () => true,
      (entry) => drainEntry(entry as BridgeEntry, lastOptions)
    ),
  ]);
  /* The owners close right after this returns: a turn still settling must finish its ledger writes first. */
  await turns.drainSettlements();
  // Owners can release safety locks while draining; judge them only after those owners settle.
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  try { await shutdownAuxiliaryAgentProcesses(); }
  catch (cause) {
    // Quit still closes host custody and its guardians. A quota/probe cleanup lock
    // cannot hold the application open after every user turn has been persisted.
    if (!failures.length && options.onBackgroundCleanupFailure) options.onBackgroundCleanupFailure(cause);
    else failures.push(cause);
  }
  if (failures.length) {
    throw new AggregateError(failures, "Agent shutdown 失败");
  }
}
export async function cancelConversations(
  conversationIds: Iterable<string>
) {
  const targets = new Set(conversationIds);
  await turns.drain(
    (entry) => targets.has(entry.conversationId),
    (entry) => drainEntry(entry as BridgeEntry, lastOptions)
  );
}
/** Drain only the prepared/live turns named by exact request custody. */
export async function cancelAgentRequests(requestIds: Iterable<string>) {
  const targets = new Set(requestIds);
  await turns.drain(
    (entry) => targets.has(entry.requestId),
    (entry) => drainEntry(entry as BridgeEntry, lastOptions)
  );
}
export function releaseConversations(conversationIds: Iterable<string>) {
  for (const conversationId of conversationIds) {
    turns.release(conversationId);
    subscriptions.release(conversationId);
    threadScopes.releaseConversation(conversationId);
    activity.forget(conversationId);
  }
}
export const conversationSwitchActivityReason = (id: string) => switchActivityReason(turns.byConversation(id));
export function hasConversationActivity(ids: Iterable<string>) { return turns.hasActivity(ids); }
export function recoverAfterFailedShutdown() {
  const recovered = AGENT_BACKEND_ORDER.every(
    (backend) =>
      !agentProcessSafetyLock(backend) &&
      reopenAgentProcessAdmission(backend)
  );
  if (!recovered) return false;
  if (!backendRuntimeRegistry.reopen()) return false;
  shuttingDown = false;
  return true;
}
