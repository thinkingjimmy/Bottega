/**
 * [INPUT]: Depends on ACP SDK client/ndJsonStream/config options, limited stdout framing, startup evidence/settlement, prompt writer handoff, descriptor spawn, freeze productContext/sensitive contribution, built-in MCP ready and frozen third-party MCP plan
 * [OUTPUT]: Provides AcpTurn/acpMcpServers, unified end-to-end protocol/session, fixed productContext→ sensitive contribution→ remaining input, real session/prompt before consumption lease, and deals with writer handoff, health observation, steering, model/mode, message cover, approval, plan-review before the original plan item is dropped, and the decision is asked again, cancellation and resume
 * [POS]: The agreement on ACP transport has been achieved; The acceptance/name denial of the session is evidence of MCP health, not spam; Process evidence with terminal ownership declining startup, failure first raw classification, post-defective release
 */

import {
  AGENT_METHODS,
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  client,
  ndJsonStream,
  type ClientContext,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type {
  AgentApprovalDecision,
  AgentUserInputAnswers,
} from "../../../../shared/agent-ipc";
import { asError } from "../../errors";
import type {
  AdapterSteerOutcome,
  AgentProcessHost,
  AgentTurn,
  BackendTurnOptions,
  StartOutcome,
} from "../types";
import {
  ACP_MAX_DELTA_BYTES,
  AcpFramingGuard,
} from "./turn/framing-guard";
import {
  elicitationOutcome,
  mapAcpElicitation,
  type AcpElicitationMapping,
} from "./turn/elicitation";
import {
  assertAcpProtocolVersion,
  assertAcpSessionId,
} from "./probe";
import {
  AcpStartupTracker,
} from "./startup/budget";
import { describeAcpExit } from "./startup/exit";
import { AcpProcessEvidence } from "./startup/evidence";
import { AcpTurnSettlement } from "./startup/settlement";
import {
  createAcpEventState,
  flushAcpSegments,
  mapAcpSubagentMeta,
  mapAcpUpdate,
  mapPermissionRequest,
  mapQuestionRequest,
  mapStopReason,
  permissionOutcome,
  type AcpPermissionMapping,
  questionOutcome,
  type AcpQuestionMapping,
} from "./map-events";
import {
  requestAcpSteering,
  SteeringOperationGate,
} from "./turn/acp-steering";
import {
  applyTurnConfiguration,
  sessionConfigState,
} from "./session/config";
import { AcpTraceTee } from "./trace";
import { AcpOutboundSink, PromptHandoffTracker } from "./turn/prompt-handoff";
import { wrapInteractiveWithSeatbelt } from "../sandbox/seatbelt";
import { seatbeltOwned } from "../sandbox/fences";
import { assertUniqueMcpBackendAliases } from "../../../../shared/mcp-servers-ipc";
import {
  acpMcpServers,
  isResumeMissing,
  processHostOf,
  promptBlocks,
  type AcpSpawnConfig,
} from "./turn/setup";

export {
  normalizeSteerOutcome,
  resolvedInputBlocks,
} from "./turn/acp-steering";
export { acpTurnMode } from "./session/config";
export {
  acpMcpServers,
  processHostOf,
  promptBlocks,
  type AcpSpawnConfig,
} from "./turn/setup";
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
  readonly child: ChildProcessWithoutNullStreams;
  private readonly state = createAcpEventState();
  private readonly settlement = new AcpTurnSettlement();
  private readonly evidence: AcpProcessEvidence;
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly questions = new Map<string, PendingQuestion>();
  private readonly elicitations = new Map<string, PendingElicitation>();
  private context?: ClientContext;
  private sessionId?: string;
  private supportsSteering = false;
  private promptSettled = false;
  private readonly steeringGate = new SteeringOperationGate();
  private readonly handoff = new PromptHandoffTracker();

  constructor(
    private readonly options: BackendTurnOptions,
    private readonly config: AcpSpawnConfig,
    private readonly host: AgentProcessHost = options.processHost ??
      processHostOf()
  ) {
    assertUniqueMcpBackendAliases(options.thirdPartyMcpPlan?.entries ?? []);
    const thirdPartySecrets = (options.thirdPartyMcpPlan?.entries ?? [])
      .flatMap((entry) => Object.values(
        entry.transport === "stdio" ? entry.env : entry.headers
      ))
      .filter(Boolean);
    this.evidence = new AcpProcessEvidence(config.env, {
      secrets: thirdPartySecrets,
    });
    const backend = options.payload.turnOptions.backend;
    // 谁进 seatbelt 由围栏声明表回答，不在这里维护一份平行名单。
    const wrapped =
      options.filesystemAccess && seatbeltOwned(backend)
        ? wrapInteractiveWithSeatbelt({
            command: config.command,
            args: config.args,
            env: config.env,
            backend,
            permissionMode: options.payload.turnOptions.permissionMode,
            workspace: options.filesystemAccess.workspace,
            readOnlyRoots: options.filesystemAccess.readOnlyRoots,
            controlRoot: options.filesystemAccess.controlRoot,
            builtinMcpServer: options.builtinMcp?.server,
            thirdPartyMcpServers: options.thirdPartyMcpPlan?.entries.flatMap(
              (entry) => entry.transport === "stdio" ? [entry] : []
            ),
            agentRuntime: options.runtime.executable,
          })
        : { command: config.command, args: config.args };
    /* 围栏、workspace cwd 与 backend env 在这里只是**被构造**，不等于已经
       交到某个进程手里：custody 宿主要等 durable activation-authorized 落账
       才把这份 capability 经 authenticated channel 送出去。 */
    this.child = this.host.launch({
      command: wrapped.command,
      args: wrapped.args,
      cwd: options.workspace,
      env: config.env,
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      const visible = this.evidence.writeStderr(chunk);
      if (visible) {
        console.warn(`[acp:${options.payload.turnOptions.backend}]`, visible);
      }
    });
    this.child.stderr.once("end", () => {
      const visible = this.evidence.endStderr();
      if (visible) {
        console.warn(`[acp:${options.payload.turnOptions.backend}]`, visible);
      }
    });
    this.child.stdin.on("error", (cause) => this.processError(cause));
    this.child.once("error", (cause) => this.processError(cause));
    /* ============================================================
     * 死因证据挂 `exit`，失败判决挂 `close`——两件事，两个信号。
     *
     * `close` 等的从来不是死亡，而是 stdio 所有权：任何继承了管道的
     * 孙进程（CLI 自己起的工具子进程、MCP server）都能无限期扣住它。
     * 把证据挂在 `close` 上，等于让孙进程决定我们能不能说出父进程的
     * 死因——启动期 tracker 的第三条腿与 preferProcessExit 的让位窗口
     * 会一起空转，终态退化成 SDK 那句零信息的 EOF。`exit` 谁也扣不住。
     *
     * 判决仍留在 `close`：那时 stdout 已排空，正在解析中的成功终态
     * 不会被拦腰截断成失败。而 `close` 迟迟不来的那些场景里，SDK 早已
     * 因 stdout EOF 拒掉在飞请求，判决自会从那条路进来——届时它拿到的
     * 已经是 `exit` 备好的真死因。
     * ============================================================ */
    this.child.once("exit", (code, signal) => {
      this.evidence.recordExit(code, signal);
    });
    this.child.once("close", (code, signal) => {
      /* spawn 失败只有 error + close、没有 exit：这里补一次幂等结算，
         证据来源才没有缺口。已结算时 Promise 语义使其自然失效。 */
      const settled = this.evidence.recordExit(code, signal);
      if (this.settlement.active) {
        this.processError(new Error(describeAcpExit(settled)));
      }
    });
  }

  get pid() {
    return this.child.pid;
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
    /* 归因内核：四步各自计时，子进程退出恒先手。调用点只给步名，
       不认识任何计时器——新增一步是表里加一行数据，不是加一个分支。 */
    const stage = new AcpStartupTracker(
      this.evidence.waitForExit(),
      this.config.startupBudgetMs
    );
    try {
      await stage.run("spawn", () =>
        new Promise<void>((resolve, reject) => {
          if (this.child.pid) resolve();
          else {
            this.child.once("spawn", resolve);
            this.child.once("error", reject);
          }
        })
      );
    } catch (cause) {
      /* spawn 发生在 connectionTask 之前，也必须走同一 failure owner。
         直接从 start() 抛 raw cause 会绕过 callback 顺序与 secret 脱敏。 */
      if (this.settlement.active) this.processError(cause);
      return this.settlement.waitForStart();
    }
    try {
      /* 宿主进程起来 ≠ backend 拿到能力。custody 路径上还隔着 owned →
         activation-authorized → 交付 → ack 四笔账；在此之前往 stdin 写
         initialize 只会堆在管道里，把一次确指的托管故障拖成一句启动超时。 */
      await stage.run("custody", () => this.host.delivered);
    } catch (cause) {
      if (this.settlement.active) this.processError(cause);
      return this.settlement.waitForStart();
    }
    const guard = new AcpFramingGuard((violation) => {
      this.options.callbacks.onPolicyViolation?.(violation);
    });
    this.child.stdout.pipe(guard);
    const trace = this.options.trace;
    const input = trace
      ? guard.pipe(
          new AcpTraceTee((line) => trace.recordWire("in", line))
        )
      : guard;
    /* 最终 sink 自己等待 child.stdin.write callback；trace 只是旁路观察
       脱敏副本，不能参与 backpressure，也不能把 tee 接收冒充 writer ack。 */
    const output: Writable = new AcpOutboundSink(
      this.child.stdin,
      this.handoff,
      trace ? (line) => trace.recordWire("out", line) : undefined
    );
    const stream = ndJsonStream(
      Writable.toWeb(output) as WritableStream<Uint8Array>,
      Readable.toWeb(input) as ReadableStream<Uint8Array>
    );
    const app = client({ name: "Bottega" })
      .onNotification(
        CLIENT_METHODS.session_update,
        ({ params }) => this.handleUpdate(params)
      )
      .onRequest(
        CLIENT_METHODS.session_request_permission,
        ({ params, requestId }) =>
          this.handlePermission(String(requestId), params)
      )
      .onRequest(
        CLIENT_METHODS.elicitation_create,
        ({ params, requestId }) =>
          this.handleElicitation(String(requestId), params)
      );
    const connectionTask = app.connectWith(stream, async (context) => {
      this.context = context;
      try {
        const initialized = await stage.run("initialize", async () => {
          const value = await context.request(AGENT_METHODS.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
              session: { configOptions: {} },
              ...(this.config.elicitation === "disabled"
                ? {}
                : { elicitation: { form: {} } }),
            },
            clientInfo: {
              name: "bottega",
              title: "Bottega",
              version: "0.1.0",
            },
          });
          assertAcpProtocolVersion(value);
          return value;
        });
        this.supportsSteering =
          (
            initialized as {
              _meta?: { steering?: { supported?: unknown } };
            }
          )._meta?.steering?.supported === true;
        let sessionId: string | undefined;
        try {
          sessionId = await stage.run("session", () =>
            this.establishSession(context)
          );
        } catch (cause) {
          this.observeMcpSessionFailure(cause);
          throw cause;
        }
        if (!sessionId) {
          this.settlement.resolveStart("resume-failed");
          this.settlement.completeTransport();
          return;
        }
        this.observeMcpSessionSuccess();
        if (this.options.builtinMcp) {
          const builtin = this.options.builtinMcp;
          await stage.run("builtin-mcp", () => builtin.waitReady(startupSignal));
        }
        startupSignal.throwIfAborted();
        const prompt = context.request(AGENT_METHODS.session_prompt, {
          sessionId,
          prompt: promptBlocks(this.options),
        });
        this.settlement.resolveStart("started");
        void prompt.then(
          (response) => {
            this.promptSettled = true;
            void this.finish(mapStopReason(response.stopReason));
          },
          (cause) => this.processError(cause)
        );
        await this.settlement.waitForTransport();
      } catch (cause) {
        /* 失败只交给 connectionTask.catch → finishError 这一条出口。
           在这里先 reject 会把 SDK 的裸 EOF 永久写进 started，随后拿到的
           exit/stderr 与 failureKind 都无法覆盖 first-settled promise。 */
        this.context = undefined;
        throw cause;
      }
    });
    void connectionTask.catch((cause) => {
      if (this.settlement.active) this.processError(cause);
    });
    return this.settlement.waitForStart();
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
    const resume = this.options.payload.session;
    if (resume && this.options.payload.turnOptions.backend !== resume.backend) {
      throw new Error("ACP session 与后端不匹配");
    }
    if (!resume) {
      const created = await context.request(AGENT_METHODS.session_new, {
        cwd: this.options.workspace,
        mcpServers: acpMcpServers(this.options, this.config),
        ...(this.config.sessionMeta
          ? { _meta: this.config.sessionMeta(this.options) }
          : {}),
      });
      const id = assertAcpSessionId(created, this.config.validateSessionId);
      this.sessionId = id;
      await applyTurnConfiguration(
        context,
        id,
        created,
        this.options.payload,
        this.config
      );
      await this.options.callbacks.onThread({
        backend: this.options.payload.turnOptions.backend,
        id,
      });
      return id;
    }
    try {
      const resumeParams = {
        sessionId: resume.id,
        cwd: this.options.workspace,
        mcpServers: acpMcpServers(this.options, this.config),
        ...(this.config.sessionMeta
          ? { _meta: this.config.sessionMeta(this.options) }
          : {}),
      };
      const resumed = await context.request(
        this.config.resumeWithoutReplay
          ? AGENT_METHODS.session_resume
          : AGENT_METHODS.session_load,
        resumeParams
      );
      this.sessionId = resume.id;
      await applyTurnConfiguration(
        context,
        resume.id,
        sessionConfigState(resumed),
        this.options.payload,
        this.config
      );
      return resume.id;
    } catch (cause) {
      if (isResumeMissing(cause, this.config.resumeMissingPolicy)) {
        return undefined;
      }
      throw cause;
    }
  }

  /**
   * session/new|load 成功意味着 backend 已协议确认这份精确 inclusion plan。
   * 这比 spawn 强，但不冒充某次 tool call；证据文字把层级说清楚。
   */
  private observeMcpSessionSuccess() {
    for (const entry of this.options.thirdPartyMcpPlan?.entries ?? []) {
      this.options.callbacks.onThirdPartyMcpProtocol?.({
        outcome: "success",
        subject: entry.healthSubject,
        evidence: [
          "acp-session-accepted",
          this.options.payload.turnOptions.backend,
          this.options.runtime.version,
          this.config.thirdPartyMcpTransport ?? "acp",
          entry.identity,
          entry.configDigest,
        ].join("\0"),
      });
    }
  }

  /**
   * generic session 失败不能连坐多台 server。只有诊断点名 alias/identity，或
   * 单 server 且明确提到 MCP，才写 protocol-failure；其余保持 unobserved。
   */
  private observeMcpSessionFailure(cause: unknown) {
    const entries = this.options.thirdPartyMcpPlan?.entries ?? [];
    if (!entries.length) return;
    const evidence = this.evidence.redact(asError(cause).message);
    const named = entries.filter(
      (entry) =>
        evidence.includes(entry.backendAlias) || evidence.includes(entry.identity)
    );
    const failed = named.length
      ? named
      : entries.length === 1 && /\bmcp\b/i.test(evidence)
        ? entries
        : [];
    for (const entry of failed) {
      this.options.callbacks.onThirdPartyMcpProtocol?.({
        outcome: "failure",
        subject: entry.healthSubject,
        evidence: [
          "acp-session-rejected",
          this.options.payload.turnOptions.backend,
          this.options.runtime.version,
          entry.identity,
          entry.configDigest,
          evidence,
        ].join("\0"),
      });
    }
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
    if (params.sessionId !== this.sessionId) return;
    this.handleSubagentMeta(params.update);
    for (const event of mapAcpUpdate(params.update, this.state)) {
      if (!this.emitMapped(event)) return;
    }
  }

  private emitMapped(event: ReturnType<typeof mapAcpUpdate>[number]) {
    this.options.trace?.recordMapped(event);
    if (event.type === "delta") {
      const bytes = Buffer.byteLength(event.text, "utf8");
      if (bytes > ACP_MAX_DELTA_BYTES) {
        this.options.callbacks.onPolicyViolation?.({
          budget: "delta-bytes",
          detail: `${bytes} > ${ACP_MAX_DELTA_BYTES}`,
        });
        return false;
      }
      this.options.callbacks.onItemDelta(event.itemId, event.text);
      return true;
    }
    this.options.callbacks.onItem(event.item);
    return true;
  }

  private flushTerminalSegments(status: "completed" | "failed") {
    for (const event of flushAcpSegments(this.state, status)) {
      this.emitMapped(event);
    }
  }

  private handleSubagentMeta(update: unknown) {
    const meta = mapAcpSubagentMeta(update, this.config.validateSessionId);
    if (!meta) return;
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
      this.config.suppressAlwaysApprovalOptions
    );
    /* plan-review 携带的完整计划以原生 plan item 进 transcript：先封口
       在途消息段保持顺序，审批卡从此只承载决策。这里是 `kind:"plan"` 的
       **唯一生产者**——在此之前 PlanCard/plan 消息/决策卡整条管线没有任何
       后端点得亮它（ACP 的 `sessionUpdate:"plan"` 是 TODO 清单，恒映射为
       `kind:"other"` 过程条目，见 map-events）。故本分支不生效即全无 Plan 块。 */
    if (mapping.plan) {
      this.flushTerminalSegments("completed");
      this.emitMapped({
        type: "item",
        item: {
          itemId: `plan-review-${approvalId}`,
          kind: "plan",
          title: "Plan",
          text: mapping.plan,
          status: "completed",
        },
      });
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
  }) {
    if (!this.settlement.requestTerminal()) return;
    await this.steeringGate.wait();
    if (!this.settlement.claimTerminal()) return;
    this.flushTerminalSegments(
      event.type === "done" ? "completed" : "failed"
    );
    const diagnostic =
      event.type === "error" && event.message
        ? { ...event, message: this.evidence.redact(event.message) }
        : event;
    this.options.callbacks.onTerminal(
      diagnostic.type === "error"
        ? { ...diagnostic, ...this.terminalFailure() }
        : diagnostic
    );
    this.settlement.completeTransport();
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
      ? { failureKind: failure.kind, usageLimit: failure.limit }
      : { failureKind: "unknown" as const };
  }

  private processError(cause: unknown) {
    if (!this.settlement.requestTerminal()) return;
    void this.finishError(cause);
  }

  private async finishError(rawCause: unknown) {
    await this.steeringGate.wait();
    if (this.settlement.stopped) return;
    /* SDK 的 "ACP connection closed" 不含 code 也不含 stderr，且总在 race
       里抢在 close 事件之前。让位给进程自己的死因，证据才不会丢。 */
    const cause = await this.evidence.preferExit(rawCause);
    if (!this.settlement.claimTerminal()) return;
    this.flushTerminalSegments("failed");
    const classified = this.config.classifyFailure?.(cause, {
      rateLimit: this.state.rateLimit,
    }) ?? {
      kind: "unknown" as const,
      message: asError(cause).message,
    };
    const failure = {
      ...classified,
      message: this.evidence.redact(classified.message),
    };
    /* onProcessError 是带 failureKind 的完整终态出口，必须先于 start()
       rejection 发布；否则 bridge 的通用 startup catch 会抢先把分类抹掉。 */
    this.options.callbacks.onProcessError(failure);
    this.settlement.rejectStart(new Error(failure.message));
    this.settlement.completeTransport();
  }

  private async closeTransportAfterSteering() {
    await this.steeringGate.wait();
    this.settlement.completeTransport();
  }
}
