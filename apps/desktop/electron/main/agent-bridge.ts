/**
 * [INPUT]: Depends on the backend registry, TurnRegistry/TurnOrigin, Gallery, Memory, Chat commit, credible input, FinalTurnProjection, adopt retry guard built-in MCP lease, main Freeze the third-party MCP planner and the backend session config provider
 * [OUTPUT]: Provides the same prompt turn to consume the same final projection and release the fresh lease at the end, execute createTurn, previously frozen backend session config, canonical facts, reject adopted retryWithoutSession, steer input, resolved capabilities, Subagent/approval/question/retry IPC and unified shutdown
 * [POS]: The multi-backend turn executor of the Electron main; The renderer sends the encrypted, manually accessed truth to the Conversation Coordinator
 */

import { randomUUID } from "node:crypto";
import { type BrowserWindow } from "electron";
import {
  AGENT_BACKEND_ORDER,
  AGENT_CHANNEL,
  type AgentBackendId,
  type AgentEventBody,
  type AgentSendPayload,
  type ChatActivityEvent,
  type SessionRef,
} from "../../shared/agent-ipc";
import { stagedInputReadRoots } from "./agent-input";
import { validateAgentPayload } from "./agent-payload-validation";
import {
  acquireAgentProcessLease,
  agentProcessSafetyLock,
  assertAgentProcessAdmission,
  clearAgentSafetyLockWhenIdle,
  reopenAgentProcessAdmission,
  reportAgentCleanupFailure,
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
import { acpStartupBackstopMs } from "./backends/acp/startup/budget";
import { createAgentBridgeIpcHandlers, registerAgentBridgeIpc } from "./agent/bridge-ipc";
import type {
  AgentBridgeOptions,
  AgentContext,
  AgentEventPayload,
  BridgeEntry,
  ConversationAdmission,
  TurnOrigin,
} from "./agent/bridge-types";
import { createTurnCallbacks } from "./agent/turn-callbacks";
import { ensurePersistedForDrain } from "./agent/drain-guard";
import { retryAgentWithoutSession } from "./agent/retry";
import { cleanupAgentTurn, createBridgeFinalizer } from "./agent/bridge-finalize";
import { TokenizedSubscriptionBroker } from "./subscription-broker";
import { ThreadScopeRegistry } from "./thread-scope";
import { TurnRegistry, awaitsUserResponse, blocksNewTurn } from "./turn-registry";
import { AcpTraceWriter, acpTraceEnabled } from "./backends/acp/trace";
import type { BuiltinMcpLease } from "./tools/lease";
import { createSubagentChannel, type SubagentChannel } from "./agent/subagent-channel";
import { unavailableRecallProjection } from "./memory/service/memory-status";
import { MEMORY_RECALL_TOTAL_TIMEOUT_MS } from "./memory/prompt-lane";
import { isActiveImageOccurrence, redactImageDetails } from "./gallery/agent-image-projection";
import type { ActiveImageSourceRef } from "./gallery/agent-image-projection";

const turns = new TurnRegistry<AgentTurn>();
if (acpTraceEnabled()) {
  turns.setDraftObserver((entry, observation) => {
    const trace = (entry as BridgeEntry).trace;
    if (!trace) return;
    trace.recordDraft(
      entry.generation,
      observation.type === "item"
        ? { type: "item", item: observation.item, draft: entry.draft }
        : { type: "delta", itemId: observation.itemId, draft: entry.draft }
    );
  });
}
const subscriptions = new TokenizedSubscriptionBroker<BrowserWindow>();
const requestReservations = new Set<string>();
const threadScopes = new ThreadScopeRegistry();
// conversationId → 该会话是否卡在用户身上；不在表中即「未在跑」
const activityRunning = new Map<string, boolean>();
let activityWindow: BrowserWindow | null = null;
let shuttingDown = false;

function publish(
  entry: BridgeEntry,
  body: AgentEventPayload
) {
  const event = turns.stamp(entry.conversationId, {
    ...body,
    requestId: entry.requestId,
  } as AgentEventBody);
  // 必须早于下面的订阅者早退：审批/追问的开闭正是靠 stamp 写进 entry 的，
  // 而后台会话没有订阅者——不在此处广播，侧边栏就永远看不到「卡在你身上」。
  // publishActivity 自带跃迁去重，逐个 item-delta 调它也不会多发一条。
  publishActivity(entry.conversationId);
  const subscription = subscriptions.current(entry.conversationId);
  if (!subscription || subscription.isDestroyed()) return event;
  try {
    subscription.webContents.send(
      AGENT_CHANNEL.event,
      redactImageDetails(event)
    );
  } catch (cause) {
    console.warn("[agent] event publish failed", cause);
  }
  return event;
}

function publishState(entry: BridgeEntry) {
  const turn = turns.snapshot(entry.conversationId);
  if (turn) publish(entry, { type: "turn-state-changed", turn });
  publishActivity(entry.conversationId);
}
// ─── 会话活动：窗口级广播，只在 (running, waiting) 跃迁时发一次 ───
// tombstone 回收、重复 publishState 都不会产生跃迁，天然幂等。
//
// waiting 取自 turn 上未闭合的审批与追问——它们正是「agent 停下来等你回话」的
// 协议级真相，且后台会话拿不到 agent:event，此广播是它唯一的信使。
function publishActivity(conversationId: string) {
  const entry = turns.byConversation(conversationId);
  const running = blocksNewTurn(entry);
  const waiting = running && awaitsUserResponse(entry);
  // 「不在表中」即「未在跑」，于是复合态恰好就是 Map 的取值，
  // 跃迁判定塌成一次相等比较——不必再分 running/not-running 两路。
  const next = running ? waiting : undefined;
  if (next === activityRunning.get(conversationId)) return;
  if (next === undefined) activityRunning.delete(conversationId);
  else activityRunning.set(conversationId, next);
  const window = activityWindow;
  if (!window || window.isDestroyed()) return;
  try {
    window.webContents.send(AGENT_CHANNEL.activity, {
      conversationId,
      running,
      waiting,
      ...(entry?.effectiveTerminal
        ? { terminal: entry.effectiveTerminal.type }
        : {}),
    } satisfies ChatActivityEvent);
  } catch (cause) {
    console.warn("[agent] activity publish failed", cause);
  }
}

function observe(promise: Promise<unknown>, context: string) {
  void promise.catch((cause) => console.error(`[agent] ${context}`, cause));
}
const { finalizeEntry, persistEntry } = createBridgeFinalizer({
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
  /* resume 重试复用同一个 context 与 requestId，但换一条新进程：旧 custody
     必须在这里就地收口，否则新 attempt 的身份会盖在死者的账上。 */
  await entry.custody?.beginRelease();
  const result = await cleanupAgentTurn(turn);
  entry.processLease?.release();
  entry.processLease = undefined;
  if (!result.ok) {
    reportAgentCleanupFailure(entry.backend, result.error);
    throw result.error;
  }
  await entry.custody?.settle();
  entry.custody = undefined;
  entry.cleanup = "complete";
  turns.markResumeFailed(entry, randomUUID());
  publishState(entry);
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
          snapshot.capabilities
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
      options.freezeBackendSessionConfig?.(backend.id);
    const turn = backend.createTurn({
      payload,
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
    if (turns.activate(entry)) publishState(entry);
    if (entry.startup?.cancelRequested || shuttingDown) {
      await finalizeEntry(entry, { type: "cancelled" }, options, generation);
    }
  } catch (cause) {
    if (entry.generation !== generation) return;
    entry.builtinMcp?.revoke();
    entry.builtinMcp = undefined;
    if (!entry.turn) resolvedInput?.rollback();
    await finalizeEntry(
      entry,
      { type: "error", message: asError(cause).message },
      options,
      generation
    );
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
  admissionHeld = false
) {
  if (!options) throw new Error("Agent bridge 尚未初始化");
  validateAgentPayload(rawPayload);
  const payload = rawPayload;
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
          origin
        );
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

export function registerAgentBridge(
  window: BrowserWindow,
  rendererUrl: string,
  options: AgentBridgeOptions
) {
  lastOptions = options;
  activityWindow = window;
  const handlers = createAgentBridgeIpcHandlers({
    turns,
    subscriptions,
    listActivity: () =>
      [...activityRunning].map(([conversationId, waiting]) => ({
        conversationId,
        waiting,
      })),
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
      return retryAgentWithoutSession({
        turns,
        requestId,
        retryToken,
        replaceSession: (entry, oldSession) =>
          options.replaceSession?.(
            entry.conversationId,
            oldSession,
            null
          ) ?? Promise.resolve(),
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
    },
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
    steerSnapshot: (conversationId) =>
      options.steerSnapshot?.(conversationId) ?? [],
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

export function releaseConversations(conversationIds: Iterable<string>) {
  for (const conversationId of conversationIds) {
    turns.release(conversationId);
    subscriptions.release(conversationId);
    threadScopes.releaseConversation(conversationId);
    activityRunning.delete(conversationId);
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
