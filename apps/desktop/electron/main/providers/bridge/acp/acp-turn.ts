/**
 * [INPUT]: Depends on an AcpConnection (process plus completed handshake), ACP session state, trusted execution authority, materialized prompt blocks and optional main-owned session proof persistence.
 * [OUTPUT]: Provides AcpTurn/acpMcpServers, end-to-end session/prompt lifecycle with typed ProductFailure terminals/notices, pre-prompt complete and continuously frozen model/mode facts, health observation, steering, approval, cancellation and resume
 * [POS]: ACP turn composition root, owning one session/prompt lifecycle over its own connection; session accept/reject doubles as MCP-health evidence, and terminal ownership is resolved here before failure classification and release
 */

import { SessionReplayProof } from "../../../library/sessions/boundary";
import {
  AGENT_METHODS,
  type ClientContext, type ContentBlock, type CreateElicitationRequest,
  type CreateElicitationResponse, type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AgentApprovalDecision, AgentUserInputAnswers } from "../../../../../shared/ipc/agent/agent-ipc";
import { asError } from "../../../ipc/errors";
import type { AdapterSteerOutcome, AgentProcessHost, AgentTurn, BackendTurnOptions, StartOutcome } from "../../../backends/types";
import { ACP_MAX_DELTA_BYTES } from "./turn/framing-guard";
import { elicitationOutcome, mapAcpElicitation, type AcpElicitationMapping } from "./turn/elicitation";
import { AcpConnection } from "./connection/acp-connection";
import type { AcpConnectionHandlers } from "./connection/handlers";
import { AcpStartupTracker } from "../../../backends/acp/startup/budget";
import { AcpProcessEvidence } from "../../../backends/acp/startup/evidence";
import { AcpTurnSettlement } from "./settlement";
import {
  createAcpEventState, flushAcpSegments,
  mapAcpUpdate, mapPermissionRequest, mapQuestionRequest,
  mapStopReason, permissionOutcome, questionOutcome,
  type AcpPermissionMapping, type AcpQuestionMapping,
} from "./mapping/map-events";
import { mapAcpSubagentMeta } from "./mapping/map-subagent-meta";
import { finalizeNativePlan, finalizeNativePlans } from "./mapping/plan-events";
import { requestAcpSteering, SteeringOperationGate } from "./turn/acp-steering";
import { PromptHandoffTracker } from "./turn/prompt-handoff";
import { assertUniqueMcpBackendAliases } from "../../../../../shared/ipc/settings/mcp-servers-ipc";
import { processHostOf, promptBlocks } from "./turn/setup";
import { turnLaunch, type AcpSpawnConfig } from "../../../backends/acp/launch";
import { establishAcpSession } from "./turn/session-establishment";
import { promptReplayTexts } from "./turn/prompt-replay";
import { NegotiatedServerFactsOracle } from "./session/server-facts";
import { observeAcpSessionAccepted, observeAcpSessionRejected } from "./session/mcp-health";
import { AcpSessionFailureProjection, terminalFactsForSessionFailure } from "./session/session-failure";
import { isAcpCancelledError, withFailureDiagnostic } from "../../../backends/acp/failure";
import { agentRuntimeFailure, type ProductFailure } from "../../../../../shared/product/product-failure";

export { normalizeSteerOutcome } from "./turn/acp-steering";
export { acpTurnMode } from "./session/config";
export { processHostOf, promptBlocks } from "./turn/setup";
export { acpMcpServers, type AcpSpawnConfig } from "../../../backends/acp/launch";
type PendingApproval = {
  mapping: AcpPermissionMapping;
  resolve: (response: RequestPermissionResponse) => void;
};

type PendingQuestion = {
  mapping: AcpQuestionMapping;
  resolve: (response: RequestPermissionResponse) => void;
};

type PendingElicitation = {
  mapping: AcpElicitationMapping;
  resolve: (response: CreateElicitationResponse) => void;
};

export class AcpTurn implements AgentTurn {
  /** 本轮自己的连接，随本轮生死。 */
  private readonly connection: AcpConnection;
  private readonly state = createAcpEventState();
  private readonly settlement = new AcpTurnSettlement();
  private readonly evidence: AcpProcessEvidence;
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly questions = new Map<string, PendingQuestion>();
  private readonly elicitations = new Map<string, PendingElicitation>();
  private context?: ClientContext;
  private sessionId?: string;
  private readonly replayProof = new SessionReplayProof();
  private restoredSessionResumed = false;
  private supportsSteering = false;
  private promptSettled = false;
  private readonly steeringGate = new SteeringOperationGate();
  private readonly handoff = new PromptHandoffTracker();
  private readonly sessionFailures: AcpSessionFailureProjection;
  private readonly serverFacts?: NegotiatedServerFactsOracle;
  /** 连接已绑着本轮会话时为真：本轮没有新的协商事实，也没有新的会话受理。 */

  constructor(
    private readonly options: BackendTurnOptions,
    private readonly config: AcpSpawnConfig,
    host: AgentProcessHost = options.processHost ?? processHostOf()
  ) {
    assertUniqueMcpBackendAliases(options.thirdPartyMcpPlan?.entries ?? []);
    if (options.serverFactBinding) {
      this.serverFacts = new NegotiatedServerFactsOracle(options.serverFactBinding);
    }
    const thirdPartySecrets = (options.thirdPartyMcpPlan?.entries ?? [])
      .flatMap((entry) => Object.values(
        entry.transport === "stdio" ? entry.env : entry.headers
      ))
      .filter(Boolean);
    this.evidence = new AcpProcessEvidence(config.env, {
      secrets: thirdPartySecrets,
    });
    this.sessionFailures = new AcpSessionFailureProjection(
      options.callbacks,
      (message) => this.evidence.redact(message),
      () => {
        this.state.skillDescriptionsTruncated = true;
      }
    );
    const backend = options.payload.turnOptions.backend;
    this.connection =
      AcpConnection.spawn(
        turnLaunch(options, config),
        host,
        {
          backend,
          /* 证据与本轮同源：脱敏用的密钥来自本轮的第三方 MCP 计划。 */
          evidence: this.evidence,
          ...(config.startupBudgetMs
            ? { startupBudgetMs: config.startupBudgetMs }
            : {}),
          trace: Boolean(options.trace),
          /* spawn 当场安装：子进程可以在 start() 之前就死，死因不能没人接。 */
          handlers: this.connectionHandlers(),
        }
      );
  }

  /**
   * 本轮在连接上的全部落点。连接只认这张表，不认识 AcpTurn——所以同一条
   * 连接可以在下一轮换一张表，而不必重建进程或重做握手。
   */
  private connectionHandlers(): AcpConnectionHandlers {
    return {
      handoff: this.handoff,
      onUpdate: (params) => this.handleUpdate(params),
      onPermission: (requestId, params) =>
        this.handlePermission(requestId, params),
      onElicitation: (userInputId, params) =>
        this.handleElicitation(userInputId, params),
      onProcessError: (cause) => this.processError(cause),
      onPolicyViolation: (violation) =>
        this.options.callbacks.onPolicyViolation?.(violation),
      ...(this.options.trace
        ? {
            onWire: (direction: "in" | "out", line: string) =>
              this.options.trace?.recordWire(direction, line),
          }
        : {}),
    };
  }

  get pid() {
    return this.connection.pid;
  }

  get steeringSupported() {
    return this.supportsSteering;
  }

  promptHandoff() {
    return this.handoff.waitForTerminal();
  }

  async start(startupSignal = new AbortController().signal): Promise<StartOutcome> {
    startupSignal.throwIfAborted();
    if (!this.settlement.beginStart()) {
      return this.settlement.waitForStart();
    }
    /* 归因内核：每步各自计时，子进程退出恒先手。调用点只给步名，
       不认识任何计时器——新增一步是表里加一行数据，不是加一个分支。 */
    const stage = new AcpStartupTracker(
      this.connection.evidence.waitForExit(),
      this.config.startupBudgetMs
    );
    let context: ClientContext;
    try {
      await this.connection.handshake(stage);
      context = this.connection.requireContext();
    } catch (cause) {
      /* 握手三步都发生在本轮协议动作之前，也必须走同一个 failure owner。
         直接从 start() 抛 raw cause 会绕过 callback 顺序与 secret 脱敏。 */
      if (this.settlement.active) this.processError(cause);
      return this.settlement.waitForStart();
    }
    this.context = context;
    this.supportsSteering = this.connection.supportsSteering;
    void this.runPrompt(context, stage, startupSignal).catch((cause) => {
      if (this.settlement.active) this.processError(cause);
    });
    return this.settlement.waitForStart();
  }

  /* ============================================================
   * 本轮的协议动作：会话 → 内置 MCP → 权威校验 → prompt。
   *
   * 它不再是 connectWith 的 op——transport 的寿命归连接，不归某一轮——
   * 所以发出 prompt 之后就返回，终态由 prompt 的结算与 settleTransport
   * 负责。失败只交给这一条出口：先 reject start 会把 SDK 的裸 EOF 永久
   * 写进 started，随后拿到的 exit/stderr 与 failureKind 都覆盖不掉
   * first-settled promise。
   * ============================================================ */
  private async runPrompt(
    context: ClientContext,
    stage: AcpStartupTracker,
    startupSignal: AbortSignal
  ) {
    try {
      const sessionId = await this.resolveSession(context, stage);
      if (!sessionId) {
        this.settlement.resolveStart("resume-failed");
        this.settleTransport();
        return;
      }
      observeAcpSessionAccepted(this.options, this.config);
      if (this.options.builtinMcp) {
        const builtin = this.options.builtinMcp;
        await stage.run("builtin-mcp", () => builtin.waitReady(startupSignal));
      }
      startupSignal.throwIfAborted();
      this.serverFacts?.assertComplete();
      await this.options.trustedAuthority?.validate();
      startupSignal.throwIfAborted(); this.options.trustedAuthority?.current();
      const blocks = await promptBlocks(this.options, this.restoredSessionResumed);
      startupSignal.throwIfAborted();
      await this.options.onSessionPrompt?.(sessionId, promptReplayTexts(this.config.promptReplay, blocks));
      startupSignal.throwIfAborted(); this.options.trustedAuthority?.current();
      const prompt = context.request(AGENT_METHODS.session_prompt, { sessionId, prompt: blocks });
      this.settlement.resolveStart("started");
      void prompt.then(
        (response) => {
          this.promptSettled = true;
          const failure = this.sessionFailures.projectPrompt(
            (response as { _meta?: unknown })._meta
          );
          if (failure) {
            void this.finish({ type: "error", failure });
            return;
          }
          void this.finish(mapStopReason(response.stopReason));
        },
        (cause) => this.processError(cause)
      );
    } catch (cause) {
      this.context = undefined;
      throw cause;
    }
  }

  /**
   * 建立本轮会话（resume 或 new）；被拒时记录受理失败再上抛。
   */
  private async resolveSession(
    context: ClientContext,
    stage: AcpStartupTracker
  ) {
    try {
      return await stage.run("session", () => this.establishSession(context));
    } catch (cause) {
      observeAcpSessionRejected(
        this.options,
        (value) => this.evidence.redact(value),
        cause
      );
      throw cause;
    }
  }

  /** 本轮与 transport 的解绑：连接随本轮收口，进程组由其 owner（宿主托管）结束。 */
  private settleTransport() {
    this.connection.releaseTransport();
  }

  /* ============================================================
   * 会话建立：resume 与 new 两条路各自完成「取得 sessionId + 应用本轮
   * 配置」。返回 sessionId；返回 undefined 表示上游确证会话已不存在，
   * 调用方据此走降级重开，而不是把它当失败上抛。
   *
   * sessionId 恒为校验过的非空串，所以 undefined 不会与它撞义。
   * ============================================================ */
  private async establishSession(
    context: ClientContext
  ): Promise<string | undefined> {
    return establishAcpSession({
      context,
      options: this.options,
      config: this.config,
      serverFacts: this.serverFacts,
      replay: this.replayProof,
      onRecoveryOutcome: outcome => { this.restoredSessionResumed = outcome === "resumed"; },
      onSessionId: (sessionId) => {
        this.sessionId = sessionId;
      },
    });
  }

  async steer(prompt: ContentBlock[]): Promise<AdapterSteerOutcome> {
    if (!this.context || !this.sessionId) {
      throw new Error("ACP steering 缺少活动 session");
    }
    if (!this.supportsSteering) {
      return { outcome: "unconsumed", reason: "unsupported" };
    }
    if (
      !this.settlement.active ||
      this.promptSettled
    ) {
      return { outcome: "unconsumed", reason: "not-in-flight" };
    }
    return this.steeringGate.run(
      requestAcpSteering(
        () =>
          this.context!.request("_session/steering", {
            sessionId: this.sessionId!,
            prompt,
            _meta: { steering: { idleBehavior: "promptRequired" } },
          }),
        () => this.interrupt()
      )
    );
  }

  async respondApproval(
    approvalId: string,
    decision: AgentApprovalDecision
  ) {
    const pending = this.approvals.get(approvalId);
    if (!pending) throw new Error("ACP 审批请求已结束");
    if (!pending.mapping.options.has(decision)) {
      throw new Error("ACP 审批选项已失效或不属于当前请求");
    }
    this.approvals.delete(approvalId);
    this.options.callbacks.onApprovalClosed(approvalId);
    pending.resolve({
      outcome: permissionOutcome(pending.mapping, decision),
    });
  }

  interrupt() {
    if (!this.context || !this.sessionId) return;
    void this.context
      .notify(AGENT_METHODS.session_cancel, { sessionId: this.sessionId })
      .catch((cause) => this.processError(cause));
  }

  markStopped() {
    if (!this.settlement.stop()) return;
    for (const [id, pending] of this.approvals) {
      pending.resolve({
        outcome: pending.mapping.rejectOptionId
          ? {
              outcome: "selected",
              optionId: pending.mapping.rejectOptionId,
            }
          : { outcome: "cancelled" },
      });
      this.options.callbacks.onApprovalClosed(id);
    }
    this.approvals.clear();
    for (const [id, pending] of this.questions) {
      pending.resolve({
        outcome: questionOutcome(pending.mapping, {}),
      });
      this.options.callbacks.onUserInputClosed?.(id);
    }
    this.questions.clear();
    for (const [id, pending] of this.elicitations) {
      pending.resolve({ action: "cancel" });
      this.options.callbacks.onUserInputClosed?.(id);
    }
    this.elicitations.clear();
    void this.closeTransportAfterSteering();
  }

  pendingUserInput(userInputId: string) {
    const pending = this.questions.get(userInputId);
    if (pending) return { questions: [pending.mapping.question] };
    const elicitation = this.elicitations.get(userInputId);
    return elicitation
      ? { questions: elicitation.mapping.questions }
      : undefined;
  }

  respondUserInput(userInputId: string, answers: AgentUserInputAnswers) {
    const pending = this.questions.get(userInputId);
    if (pending) {
      this.questions.delete(userInputId);
      pending.resolve({
        outcome: questionOutcome(pending.mapping, answers),
      });
      this.options.callbacks.onUserInputClosed?.(userInputId);
      return;
    }
    const elicitation = this.elicitations.get(userInputId);
    if (!elicitation) throw new Error("用户输入请求已过期或不存在");
    this.elicitations.delete(userInputId);
    elicitation.resolve(elicitationOutcome(elicitation.mapping, answers));
    this.options.callbacks.onUserInputClosed?.(userInputId);
  }

  private handleUpdate(params: SessionNotification) {
    if (this.replayProof.observe(params)) return;
    if (params.sessionId !== this.sessionId) return;
    if (params.update.sessionUpdate === "config_option_update") {
      this.options.callbacks.onConfigOptionUpdate?.(
        params.update.configOptions
      );
    }
    if (params.update.sessionUpdate === "session_info_update") {
      this.sessionFailures.projectUpdate(
        (params.update as { _meta?: unknown })._meta
      );
    }
    const subagentThreadId = this.handleSubagentMeta(params.update);
    for (const event of mapAcpUpdate(params.update, this.state)) {
      if (!this.emitMapped(event, subagentThreadId)) return;
    }
  }

  private emitMapped(
    event: ReturnType<typeof mapAcpUpdate>[number],
    subagentThreadId?: string
  ) {
    this.options.trace?.recordMapped(event);
    if (event.type === "delta") {
      const bytes = Buffer.byteLength(event.text, "utf8");
      if (bytes > ACP_MAX_DELTA_BYTES) {
        this.options.callbacks.onPolicyViolation?.({
          budget: "delta-bytes",
          detail: `${bytes} > ${ACP_MAX_DELTA_BYTES}`,
          ...this.turnFacts(),
        });
        return false;
      }
      if (subagentThreadId) {
        this.options.callbacks.onSubagentItemDelta?.(
          subagentThreadId,
          event.itemId,
          event.text
        );
      } else {
        this.options.callbacks.onItemDelta(event.itemId, event.text);
      }
      return true;
    }
    if (event.type === "item-removed") {
      this.options.callbacks.onItemRemoved(event.itemId);
      return true;
    }
    if (subagentThreadId) {
      this.options.callbacks.onSubagentItem?.(subagentThreadId, event.item);
    } else {
      this.options.callbacks.onItem(event.item, event.metadata);
    }
    return true;
  }

  private flushTerminalSegments(status: "completed" | "failed") {
    for (const event of flushAcpSegments(this.state, status)) {
      this.emitMapped(event);
    }
  }

  private handleSubagentMeta(update: unknown) {
    const meta = mapAcpSubagentMeta(update, this.config.validateSessionId);
    if (!meta) return undefined;
    const now = Date.now();
    const current = this.options.subagents.get(meta.threadId);
    const agent = this.options.subagents.upsertMeta({
      agentThreadId: meta.threadId,
      name:
        current?.name ?? meta.name ?? `Agent ${meta.threadId.slice(0, 8)}`,
      status: meta.status,
      spawnedAt: current?.spawnedAt ?? now,
      lastActivityAt: now,
    }).meta;
    this.options.callbacks.onSubagentUpdate?.(agent);
    return agent.agentThreadId;
  }

  private handlePermission(
    approvalId: string,
    params: Parameters<typeof mapPermissionRequest>[1]
  ) {
    const question = mapQuestionRequest(params);
    if (question) {
      return new Promise<RequestPermissionResponse>((resolve) => {
        this.questions.set(approvalId, { mapping: question, resolve });
        this.options.callbacks.onUserInput?.({
          userInputId: approvalId,
          itemId: params.toolCall.toolCallId,
          session: {
            backend: this.options.payload.turnOptions.backend,
            id: this.sessionId ?? params.sessionId,
          },
          turnId: approvalId,
          questions: [question.question],
        });
      });
    }
    const mapping = mapPermissionRequest(
      approvalId,
      params,
      this.config.suppressAlwaysApprovalOptions,
      this.options.payload.turnOptions.permissionMode
    );
    /* plan-review 携带的完整计划以原生 plan item 进 transcript：先封口
       在途消息段保持顺序，审批卡从此只承载决策。这里是 `kind:"plan"` 的
       **唯一生产者**——在此之前 PlanCard/plan 消息/决策卡整条管线没有任何
       后端点得亮它（ACP 的 `sessionUpdate:"plan"` 是 TODO 清单，恒映射为
       `kind:"other"` 过程条目，见 map-events）。故本分支不生效即全无 Plan 块。 */
    if (mapping.planReview) {
      this.flushTerminalSegments("completed");
      const planId = mapping.planItemId ?? `plan-review-${approvalId}`;
      const event = finalizeNativePlan(this.state, planId, mapping.plan);
      if (event) this.emitMapped(event);
    }
    const mode = this.options.payload.turnOptions.permissionMode;
    if (
      mode !== "ask-for-approval" &&
      !mapping.planReview &&
      !this.config.reviewResidualApprovals
    ) {
      return Promise.resolve({
        outcome: permissionOutcome(mapping, "accept"),
      });
    }
    return new Promise<RequestPermissionResponse>((resolve) => {
      this.approvals.set(approvalId, { mapping, resolve });
      this.options.callbacks.onApproval(mapping.approval);
    });
  }

  private handleElicitation(
    userInputId: string,
    params: CreateElicitationRequest
  ) {
    if (!("sessionId" in params) || params.sessionId !== this.sessionId) {
      return { action: "cancel" } satisfies CreateElicitationResponse;
    }
    const mapping = mapAcpElicitation(params);
    if (!mapping) {
      return { action: "cancel" } satisfies CreateElicitationResponse;
    }
    return new Promise<CreateElicitationResponse>((resolve) => {
      this.elicitations.set(userInputId, { mapping, resolve });
      const toolCallId =
        "toolCallId" in params && typeof params.toolCallId === "string"
          ? params.toolCallId
          : undefined;
      this.options.callbacks.onUserInput?.({
        userInputId,
        itemId: toolCallId ?? `elicitation-${userInputId}`,
        session: {
          backend: this.options.payload.turnOptions.backend,
          id: this.sessionId!,
        },
        turnId: userInputId,
        questions: mapping.questions,
      });
    });
  }

  private async finish(event: {
    type: "done" | "cancelled" | "error";
    message?: string;
    failure?: ProductFailure;
  }) {
    if (!this.settlement.requestTerminal()) return;
    await this.steeringGate.wait();
    if (!this.settlement.claimTerminal()) return;
    for (const plan of finalizeNativePlans(this.state)) this.emitMapped(plan);
    this.flushTerminalSegments(
      event.type === "done" ? "completed" : "failed"
    );
    const diagnostic =
      event.type === "error" && event.message
        ? { ...event, message: this.evidence.redact(event.message) }
        : event;
    this.options.callbacks.onTerminal({
      ...(diagnostic.type === "error"
        ? diagnostic.failure
          ? {
              ...diagnostic,
              ...terminalFactsForSessionFailure(diagnostic.failure),
            }
          : { ...diagnostic, ...this.terminalFailure() }
        : diagnostic),
      ...this.turnFacts(),
    });
    this.settleTransport();
  }

  /**
   * 轮级事实与终态类型无关：截断已经发生过，无论这一轮是善终、死于进程错误
   * 还是撞上预算围栏。三个出口共用这一处推导，新增事实位不会只补上一半。
   */
  private turnFacts() {
    return this.state.skillDescriptionsTruncated
      ? { facts: { skillDescriptionsTruncated: true as const } }
      : {};
  }

  /**
   * 终态错误没有 RPC cause 可分类，但带外到达的限流快照仍然作数——
   * 无 code/data 时其余判据自然不成立，所以这只会把 unknown 升格为确凿的 usage-limit。
   */
  private terminalFailure() {
    const failure = this.config.classifyFailure?.(
      {},
      { rateLimit: this.state.rateLimit }
    );
    return failure?.kind === "usage-limit"
      ? {
          failureKind: failure.kind,
          usageLimit: failure.limit,
          failure: failure.failure,
        }
      : {
          failureKind: failure?.kind ?? ("unknown" as const),
          failure: failure?.failure ?? agentRuntimeFailure("unknown"),
        };
  }

  private processError(cause: unknown) {
    if (isAcpCancelledError(cause)) {
      void this.finish({ type: "cancelled" });
      return;
    }
    if (!this.settlement.requestTerminal()) return;
    void this.finishError(cause);
  }

  private async finishError(rawCause: unknown) {
    await this.steeringGate.wait();
    if (this.settlement.stopped) return;
    /* SDK 的 "ACP connection closed" 不含 code 也不含 stderr，且总在 race
       里抢在 close 事件之前。让位给进程自己的死因，证据才不会丢。 */
    const cause = await this.connection.evidence.preferExit(rawCause);
    if (!this.settlement.claimTerminal()) return;
    for (const plan of finalizeNativePlans(this.state)) this.emitMapped(plan);
    this.flushTerminalSegments("failed");
    const classified = this.config.classifyFailure?.(cause, {
      rateLimit: this.state.rateLimit,
    }) ?? {
      kind: "unknown" as const,
      message: asError(cause).message,
      failure: agentRuntimeFailure("unknown"),
    };
    const failure = {
      ...withFailureDiagnostic(
        classified,
        this.evidence.redact(classified.message)
      ),
      ...this.turnFacts(),
    };
    /* onProcessError 是带 failureKind 的完整终态出口，必须先于 start()
       rejection 发布；否则 bridge 的通用 startup catch 会抢先把分类抹掉。 */
    this.options.callbacks.onProcessError(failure);
    this.settlement.rejectStart(new Error(failure.message));
    this.settleTransport();
  }

  private async closeTransportAfterSteering() {
    await this.steeringGate.wait();
    this.settleTransport();
  }
}
