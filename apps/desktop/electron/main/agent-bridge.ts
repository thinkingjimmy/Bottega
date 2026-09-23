/**
 * [INPUT]: Depends on the backend registry, TurnRegistry, synchronous Steer policy, payload validation, Project Tools receipts, Chat commit, Gallery, Memory, MCP leases, artifact capture sessions, frozen sessions, retry guards and credential reservations
 * [OUTPUT]: Provides canonical execution, main-only session prompt evidence, scoped availability, Project policy narrowing, MCP/session guards, typed finalization, interaction/retry IPC with authorized saved-history session replacement carrying the original user identity, and shutdown.
 * [POS]: Main-process multi-backend turn executor; the conversation coordinator supplies already-admitted manual intent
 */

import { artifactRuntime } from "./artifacts/runtime";
import { type BrowserWindow } from "electron";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
  type AgentSendPayload,
  type SessionRef,
} from "../../shared/agent-ipc";
import { stagedInputReadRoots } from "./agent-input";
import { parseAgentPayloadForStart } from "./agent-payload-validation";
import {
  acquireAgentProcessLease,
  reserveAgentCredentialUse,
  agentProcessSafetyLock,
  assertAgentProcessAdmission,
  clearAgentSafetyLockWhenIdle,
  reopenAgentProcessAdmission,
  shutdownAuxiliaryAgentProcesses,
  stopAllAgentProcessAdmission,
} from "./agent-process-supervisor";
import { backendById, backendRuntimeRegistry } from "./backends";
import { resolvedInputBlocks } from "./backends/acp/acp-turn";
import type { AgentTurn, ResolvedRuntime, ResolvedAgentInput, TrustedTurnAuthority } from "./backends/types";
import {
  assertBackendCapabilities,
  assertModelCapabilities,
  assertResolvedInputCapabilities,
} from "./backends/capability-validation";
import { asError, withDeadline } from "./errors";
import {
  ProductFailureError,
  agentRuntimeFailure,
  diagnosticFailureDetails,
} from "../../shared/product-failure";
import { acpStartupBackstopMs } from "./backends/acp/startup/budget";
import { createAgentBridgeIpcHandlers, registerAgentBridgeIpc } from "./agent/bridge-ipc";
import { steerCarriesStagedSnapshot, steerTurnCanConsume } from "./agent/controls/steering";
export { steerCarriesStagedSnapshot, steerTurnCanConsume } from "./agent/controls/steering";
import type {
  AgentBridgeOptions,
  AgentContext,
  BridgeEntry,
  ConversationAdmission,
  TurnOrigin,
} from "./agent/bridge-types";
import { executableIdentity } from "./custody/identity";
import { createTurnCallbacks } from "./agent/turn-callbacks";
import { resolveTurnConnection } from "./agent/connection-wiring";
import { ensurePersistedForDrain } from "./agent/drain-guard";
import { assertAgentAvailable, assertInstalledRuntime } from "./agent/runtime-gate";
import { switchActivityReason } from "./agent/turn-actions";
import {
  retryAgentSameSession,
  retryAgentWithoutSession,
} from "./agent/retry";
import { createBridgeFinalizer } from "./agent/bridge-finalize";
import { TokenizedSubscriptionBroker } from "./subscription-broker";
import { ThreadScopeRegistry } from "./thread-scope";
import { TurnRegistry, blocksNewTurn } from "./turn-registry";
import { AcpTraceWriter, acpTraceEnabled } from "./backends/acp/trace";
import type { BuiltinMcpLease } from "./tools/lease";
import { createSubagentChannel, type SubagentChannel } from "./agent/subagent-channel";
import { unavailableRecallProjection } from "./memory/service/memory-status";
import { MEMORY_RECALL_TOTAL_TIMEOUT_MS } from "./memory/prompt-lane";
import { isActiveImageOccurrence } from "./gallery/agent-image-projection";
import type { ActiveImageSourceRef } from "./gallery/agent-image-projection";
import { assertPlatformCapability } from "../../shared/platform-capabilities";
import { AgentActivityPublisher } from "./agent/activity-publisher";
import { installAcpDraftTrace } from "./agent/trace-observer";
import type { HydratedProjectTools } from "./sections/coordinator/admission/prepared-project-tools";
import { createBridgeEventPublisher } from "./agent/bridge-event-publisher";
import { snapshotStopOperations } from "./agent/snapshots/stop-operations";
import { taskStartFence, StartDeferredError, requestOperation, type StopOperation } from "./presence/lifecycle/start-fence";

export const turns = new TurnRegistry<AgentTurn>();
installAcpDraftTrace(turns);
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

export { ensurePersistedForDrain } from "./agent/drain-guard";
export {
  assertModelCapabilities,
  assertResolvedInputCapabilities,
} from "./backends/capability-validation";
export type { SubagentChannel } from "./agent/subagent-channel";

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

export function registerAgentSteerOperation(requestId: string) {
  const entry = turns.byRequest(requestId) as BridgeEntry | undefined;
  if (!entry?.turn) throw new Error("目标 turn 不存在或尚未启动");
  const operation = turns.registerSteerOp(entry);
  return {
    ...operation,
    conversationId: entry.conversationId,
    payload: structuredClone(entry.payload!),
    assertCurrent: () =>
      turns.assertSteerEpoch(entry, operation.epoch, operation.signal),
  };
}

export async function steerAgentTurn(
  requestId: string,
  input: ResolvedAgentInput["input"]
) {
  const entry = turns.byRequest(requestId);
  if (!entry?.turn?.steer) {
    return { outcome: "unconsumed", reason: "unsupported" } as const;
  }
  /* 退回队列不是降级：transferred 是既有终局，同一份快照由下一轮带着正确
     读面重新出发，附件那时真的读得到。 */
  if (steerCarriesStagedSnapshot(input)) {
    return { outcome: "unconsumed", reason: "staged-resource" } as const;
  }
  if (!steerTurnCanConsume(entry.backend, input, (entry as BridgeEntry).context?.activeCapabilities)) {
    return { outcome: "unconsumed", reason: "unsupported" } as const;
  }
  return entry.turn.steer(resolvedInputBlocks(input));
}

async function spawnAgent(
  entry: BridgeEntry,
  payload: AgentSendPayload,
  context: AgentContext,
  options: AgentBridgeOptions,
  reuseInput?: ResolvedAgentInput,
  trustedAuthority?: TrustedTurnAuthority
) {
  const backend = backendById(payload.turnOptions.backend);
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
      entry.processLease = await acquireAgentProcessLease(
        backend.id,
        "interactive"
      );
      await assertModelCapabilities(
        backend,
        payload,
        snapshot.runtime,
        context.workspace,
        entry.childController.signal
      );
      if (payload.planMode) {
        await options.assertPlanAvailable?.(
          true,
          context.workspace,
          backend.id
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
            if (context.memory && entry.origin?.kind === "manual") {
              entry.memoryRecall = await options.recallMemory?.({
                admission: context.memory,
                queryText: entry.origin.queryText,
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
    entry.thirdPartyMcpPlan ??= options.resolveThirdPartyMcpPlan?.({
      backendId: backend.id,
      backendRuntimeIdentity: `${backend.id}@${runtime.version}`,
      planMode: Boolean(payload.planMode),
      origin: entry.origin,
      context,
    });
    if (entry.thirdPartyMcpPlan) {
      const preparedContext = context.preparedProjectTools?.receipt.projectContext;
      if (
        preparedContext &&
        (preparedContext.projectId !== entry.thirdPartyMcpPlan.projectContext.projectId ||
          preparedContext.projectLifecycleRevision !==
            entry.thirdPartyMcpPlan.projectContext.projectLifecycleRevision)
      ) {
        throw new Error("PROJECT_TOOLS_PLAN_CONTEXT_MISMATCH");
      }
      if (payload.session) {
        const binding = payload.session.toolPlan;
        if (
          !binding ||
          binding.planDigest !== entry.thirdPartyMcpPlan.planDigest ||
          binding.projectId !== entry.thirdPartyMcpPlan.projectContext.projectId
        ) {
          throw new Error("SESSION_TOOL_PLAN_STALE");
        }
      }
    }
    /* 产物目录进围栏的 stateWriteRoots，必须先于认领解析：借来的连接与本轮自己起的进程，围栏输入要逐格相同。 */
    const artifactDirectory = await artifactRuntime()?.directory(entry.conversationId);
    const builtinMcp = await resolveTurnConnection(options, entry, {
      payload, context, generation, runtime, runtimeGeneration,
      ...(artifactDirectory ? { artifactDirectory } : {}) });
    /* Persist custody before spawn: each attempt needs its own process identity,
       even when resume retries reuse the request ID. 借来的连接的进程早已在
       `connection` owner 名下入账，再开一笔就是一个 PID 记两个主人。 */
    entry.custody = entry.connection
      ? undefined
      : await options.beginTurnCustody?.({
          turnRequestId: payload.requestId,
          owner: context.custodyOwner ?? {
            kind: "chat-turn",
            ownerId: entry.conversationId,
            ownerRevision: generation,
          },
          backendRuntimeIdentity: `${backend.id}@${runtime.version}`,
          dependencies: context.custodyDependencies ?? [],
        });
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
    entry.backendSessionConfig ??=
      await options.freezeBackendSessionConfig?.(backend.id);
    const artifactContext = artifactDirectory
      ? `When the user asks to see a chart, page or other visualization, write it as a standalone HTML or SVG file under ${artifactDirectory} and reply with one standalone line visualize{"path":"absolute file path","title":"Short title"}; the HTML may use relative local resources and must not be inlined in the reply. Deliverable documents (pdf, docx, xlsx, pptx) that are not part of the project source also belong in that directory. Project files stay in the project.`
      : "";
    const turn = backend.createTurn({
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
      ...(entry.custody ? { processHost: entry.custody.host } : {}),
      ...(entry.connection ? { connection: entry.connection.connection } : {}),
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
    const terminal = cause instanceof ProductFailureError
      ? { type: "error" as const, failure: cause.failure }
      : {
          type: "error" as const,
          failure: agentRuntimeFailure(
            entry.turn ? "unknown" : "runtime-unavailable",
            diagnosticFailureDetails(asError(cause).message)
          ),
        };
    await finalizeEntry(entry, terminal, options, generation);
  } finally { credentialUse?.release(); }
}

export function claimAgentRequest(backend: AgentBackendId, requestId: string, conversationId = requestId, incarnationId?: string) {
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

export type { AgentBridgeOptions, AgentContext, ConversationAdmission } from "./agent/bridge-types";

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
  const backend = backendById(payload.turnOptions.backend);
  const releaseReservation = claimAgentRequest(backend.id, payload.requestId, payload.scope.conversationId,
    options.conversationIncarnation?.(payload.scope.conversationId));
  try {
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
    throw new Error(
      `${backend.displayName} 启动失败：${asError(cause).message}`
    );
  }
  } finally { releaseReservation(); }
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
      return options.prepareFreshRetry?.(entry.payload!,
        entry.origin?.kind === "manual" ? entry.origin.userMessageId : undefined);
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
  turns.requestCancel(entry);
  const afterStartup =
    entry.startup?.task.catch(() => {}) ?? Promise.resolve();
  observe(
    afterStartup.then(() =>
      finalizeEntry(entry, { type: "cancelled" }, options)
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
  await ensurePersistedForDrain(entry, () =>
    persistEntry(entry, options, true)
  );
  if (entry.cleanup === "failed") {
    throw new Error(`${entry.backend} cleanup 失败，安全锁仍驻留`);
  }
}
export async function shutdownAllAgents() {
  shuttingDown = true;
  stopAllAgentProcessAdmission();
  await drainRequestReservations();
  const results = await Promise.allSettled([
    backendRuntimeRegistry.shutdown(),
    turns.drain(
      () => true,
      (entry) => drainEntry(entry as BridgeEntry, lastOptions)
    ),
    shutdownAuxiliaryAgentProcesses(),
  ]);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
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
