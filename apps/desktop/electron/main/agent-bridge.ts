/**
 * [INPUT]: Depends on the backend registry, TurnRegistry, split public/internal Agent payload validation, hydrated Project Tools receipts, Chat commit, Gallery, Memory, MCP leases, frozen session configuration, and retry guards
 * [OUTPUT]: Provides canonical turn execution with runtime-only Project policy narrowing, MCP plan/session binding guards, same-session Speed convergence, ProductFailure-preserving finalization, leases, interaction/retry IPC, and shutdown
 * [POS]: Main-process multi-backend turn executor; the conversation coordinator supplies already-admitted manual intent
 */

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
  agentProcessSafetyLock,
  assertAgentProcessAdmission,
  clearAgentSafetyLockWhenIdle,
  reopenAgentProcessAdmission,
  shutdownAuxiliaryAgentProcesses,
  stopAllAgentProcessAdmission,
} from "./agent-process-supervisor";
import { backendById, backendRuntimeRegistry } from "./backends";
import { resolvedInputBlocks } from "./backends/acp/acp-turn";
import type { AgentTurn, ResolvedRuntime, ResolvedAgentInput } from "./backends/types";
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
import type {
  AgentBridgeOptions,
  AgentContext,
  BridgeEntry,
  ConversationAdmission,
  TurnOrigin,
} from "./agent/bridge-types";
import { executableIdentity } from "./custody/identity";
import { createTurnCallbacks } from "./agent/turn-callbacks";
import { ensurePersistedForDrain } from "./agent/drain-guard";
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

const turns = new TurnRegistry<AgentTurn>();
installAcpDraftTrace(turns);
const subscriptions = new TokenizedSubscriptionBroker<BrowserWindow>();
const requestReservations = new Set<string>();
const threadScopes = new ThreadScopeRegistry();
const activity = new AgentActivityPublisher(turns);
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

/**
 * staged 快照只能被「声明过它的那道围栏」读到，而围栏在 spawn 时就冻结了：
 * 插入消息的快照是此后才落盘的，注进去必然 EPERM——Agent 收到一条自己打不开
 * 的 `resource_link`。所以带附件的插入不进运行中的 turn。
 */
export const steerCarriesStagedSnapshot = (
  input: ResolvedAgentInput["input"]
) => input.some((item) => item.type === "mention" || item.type === "skill");

/**
 * steer 注入的能力闸。outbox 的 ACK 窗口比 spawn 长得多，而插入消息可以带
 * `@Section` 图片——admission 时能力为真、注入时后端已换代，没有这道闸就是
 * fail-open：图片被静默丢弃或直接喂给一个不认图片的后端。
 */
export async function assertSteerTurnCapabilities(
  backendId: AgentBackendId,
  input: ResolvedAgentInput["input"]
) {
  const backend = backendById(backendId);
  const snapshot = await backendRuntimeRegistry.resolve(backendId);
  assertResolvedInputCapabilities(backend, input, snapshot.capabilities);
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
  await assertSteerTurnCapabilities(entry.backend, input);
  return entry.turn.steer(resolvedInputBlocks(input));
}

async function spawnAgent(
  entry: BridgeEntry,
  payload: AgentSendPayload,
  context: AgentContext,
  options: AgentBridgeOptions,
  reuseInput?: ResolvedAgentInput
) {
  const backend = backendById(payload.turnOptions.backend);
  const generation = entry.generation;
  let resolvedInput = reuseInput;
  try {
    assertAgentProcessAdmission(backend.id);
    let runtime: ResolvedRuntime | undefined;
    let runtimeGeneration: number | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await backendRuntimeRegistry.resolveForSpawn(backend.id);
      if (snapshot.runtimeStatus !== "installed") {
        throw new Error(
          `未检测到 ${backend.displayName} CLI，请前往 Settings 安装或登录`
        );
      }
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
        entry.builtinMcp = options.issueBuiltinMcp?.(
          payload,
          generation,
          entry.origin,
          context
        );
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
    const builtinMcp = entry.builtinMcp;
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
    /* ============================================================
     * intent 必须先于 spawn 落盘，且这条 attempt 的 dependency 集合在这里
     * 就已闭合。resume 重试走的是同一个 requestId 但不同进程，所以每次进来
     * 都换一条新 custody——把上一条的死亡证据盖在新进程头上，正是重启后
     * 「杀错人」或「早 GC」的来源。
     * ============================================================ */
    entry.custody = await options.beginTurnCustody?.({
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
    const turn = backend.createTurn({
      /* entry.payload keeps persisted intent. The derived wire snapshot alone
         honors a same-session fallback until an explicit model/Speed action. */
      payload: threadScopes.payloadForTurn(payload),
      input: resolvedInput,
      ...(context.finalTurnProjection?.productContext
        ? { productContext: context.finalTurnProjection.productContext }
        : {}),
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
      callbacks: createTurnCallbacks(
        { turns, threadScopes, publish, observe, finalizeEntry },
        { entry, generation, backend, runtimeGeneration, options, context }
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
      /* 本轮交出去的快照进读面。围栏与 staged 输入在这里才第一次同时在手，
         而它们必须一起说话：少了这一步，附件/@Section/Skill 全是 EPERM。
         由 bridge 一处补齐，四家后端各自的翻译层不必认识 staging。 */
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
    /* 分步归因归 AcpTurn：哪一步卡住就报哪一步，带上已完成步骤的耗时。
       这里只留「turn.start 自己没结算」的总兜底——它一旦出现在用户面前，
       那是 bug 报告，不是操作指引，所以文案照实说是内部错误。 */
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
  }
}

export function claimAgentRequest(backend: AgentBackendId, requestId: string) {
  assertAgentProcessAdmission(backend);
  if (shuttingDown) throw new Error("应用正在退出，不能启动新请求");
  if (requestReservations.has(requestId) || turns.byRequest(requestId)) {
    throw new Error("requestId 正在执行");
  }
  requestReservations.add(requestId);
  return () => requestReservations.delete(requestId);
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
  preparedProjectTools?: HydratedProjectTools
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
  const snapshot = await backendRuntimeRegistry.resolve(backend.id);
  if (snapshot.runtimeStatus !== "installed") {
    throw new Error(`${backend.displayName} CLI 未安装或版本不受支持`);
  }
  assertBackendCapabilities(backend, payload, snapshot.capabilities);
  await options.assertChatBackend?.(
    payload.scope.conversationId,
    backend.id
  );
  await options.assertTurnAdmission?.(payload);
  const safetyLockReason = agentProcessSafetyLock(backend.id);
  if (safetyLockReason) {
    throw new Error(
      `${backend.displayName} 已进入安全锁定：${safetyLockReason}`
    );
  }
  if (payload.session) {
    threadScopes.assertResume(payload.session, payload.scope.conversationId);
  }
  /* coordinator 持 project lifecycle gate 派发时（admissionHeld），
     排他性已由同一把 projects 锁提供；再取一次就是自锁死——
     IPC 悬死、renderer 无回执。持锁事实只信调用方下传。 */
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
        let releaseReservation: (() => void) | undefined;
        let contextRetained = false;
        try {
          releaseReservation = claimAgentRequest(
            backend.id,
            payload.requestId
          );
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
          contextRetained = true;
          entry.payload = payload;
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
          const startup = spawnAgent(entry, payload, context, options, reuseInput);
          turns.setStartup(entry, startup);
          observe(startup, `startup requestId=${payload.requestId}`);
        } finally {
          releaseReservation?.();
          if (!contextRetained) await options.releaseContext?.(context);
        }
      }
    );
  } catch (cause) {
    throw new Error(
      `${backend.displayName} 启动失败：${asError(cause).message}`
    );
  }
}

export function seedThreadScope(session: SessionRef, conversationId: string) {
  threadScopes.bind(session, conversationId);
}

/** lifecycle cwd 迁移后撤销旧 CLI session 的 main-side resume 权限。 */
export function releaseThreadScopeForConversation(conversationId: string) {
  threadScopes.releaseConversation(conversationId);
}

/** Explicit model/Speed actions retry the persisted preference in this session.
 *  三个落点必须同时清：main 的运行态 map（下一轮 payload 不再被回落覆写）、
 *  turn entry 的 `serviceTierEffective`（attach 快照的真相源）、以及 renderer
 *  投影（横幅读的就是它）。只清第一个，用户重开 Fast 后横幅仍挂着旧回落原因
 *  直到下一 turn 才刷新——那正是「显式重置后投影陈旧」。 */
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
    retryToken: string
  ) => mode({
    turns,
    requestId,
    retryToken,
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
      const startup = spawnAgent(
        bridgeEntry,
        bridgeEntry.payload!,
        bridgeEntry.context!,
        options,
        input
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
    send: (rawPayload) => {
      if (options.acceptRendererSend === false) {
        throw new Error("人工 turn 必须经 ConversationCoordinator 提交");
      }
      return startAgentPayload(rawPayload, options);
    },
    retryWithoutSession: (requestId, retryToken) => {
      const entry = turns.byRequest(requestId);
      if (entry) options.assertRetryWithoutSession?.(entry.conversationId);
      return retry(retryAgentWithoutSession, requestId, retryToken);
    },
    retrySameSession: (requestId, retryToken) =>
      retry(retryAgentSameSession, requestId, retryToken),
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

export function hasConversationActivity(
  conversationIds: Iterable<string>
) {
  return turns.hasActivity(conversationIds);
}

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
