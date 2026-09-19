/**
 * [INPUT]: Depends on AgentProcessHost launch/delivered custody, AcpProcessEvidence, the framing guard/trace tee/outbound sink transport chain, the ACP SDK client and the startup budget tracker
 * [OUTPUT]: Provides AcpConnection — one child process plus one completed ACP handshake, with a mutable turn handler slot (attach/detach), request/notify delegation, session binding, exit observation and close
 * [POS]: The ACP process-and-handshake owner; AcpTurn keeps only the per-turn protocol state machine and may either own a private connection or borrow a resident one
 */

import {
  AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION, client, ndJsonStream,
  type ClientContext, type InitializeResponse,
} from "@agentclientprotocol/sdk";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import { asError } from "../../../errors";
import { cleanProcessGroup, wait, type CleanupResult } from "../../../process-group";
import type { AgentProcessHost, AgentProcessLaunch } from "../../types";
import { assertAcpProtocolVersion } from "../probe";
import { AcpStartupTracker, type AcpStartupBudget } from "../startup/budget";
import { AcpProcessEvidence } from "../startup/evidence";
import { describeAcpExit, type AcpExitReport } from "../startup/exit";
import { AcpTraceTee } from "../trace";
import { buildAcpClientCapabilities, SESSION_CAPABILITY_POLICY } from "../session/client-capabilities";
import { AcpFramingGuard } from "../turn/framing-guard";
import { AcpOutboundSink, type PromptHandoffSink } from "../turn/prompt-handoff";
import { unattachedRequest, type AcpConnectionHandlers } from "./handlers";

/** 关闭时给进程自己退出的窗口；超时即走进程组清理。 */
const ACP_CONNECTION_EXIT_GRACE_MS = 1_000;

export type AcpConnectionOptions = {
  backend: AgentBackendId;
  /** 证据宿主。turn 私有连接传入自己那一份，stderr/exit 与脱敏保持同源。 */
  evidence?: AcpProcessEvidence;
  startupBudgetMs?: AcpStartupBudget;
  /** 逐行脱敏只对开了 trace 的连接生效，与未抽出前的条件一致。 */
  trace?: boolean;
  /** spawn 时即安装：进程在 handshake 之前就可能死，死因不能没人接。 */
  handlers?: AcpConnectionHandlers;
  cleanProcessGroup?: typeof cleanProcessGroup;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

export class AcpConnection {
  readonly child: ChildProcessWithoutNullStreams;
  readonly evidence: AcpProcessEvidence;
  private readonly clean: typeof cleanProcessGroup;
  private readonly lifetime = deferred<void>();
  private readonly ready = deferred<ClientContext>();
  private readonly exitListeners = new Set<(report: AcpExitReport) => void>();
  private handlers?: AcpConnectionHandlers;
  private clientContext?: ClientContext;
  private negotiated?: InitializeResponse;
  private steering = false;
  private session?: string;
  private deadCause?: Error;
  private deadFlag = false;
  private dropped = 0;
  private transport?: Promise<void>;
  private closing?: Promise<CleanupResult>;

  private constructor(
    private readonly launch: AgentProcessLaunch,
    private readonly host: AgentProcessHost,
    private readonly options: AcpConnectionOptions
  ) {
    this.evidence = options.evidence ?? new AcpProcessEvidence(launch.env);
    this.clean = options.cleanProcessGroup ?? cleanProcessGroup;
    this.handlers = options.handlers;
    /* 围栏、workspace cwd 与 backend env 在这里只是**被交付**，不等于已经
       被某个进程接收：custody 宿主要等 durable activation-authorized 落账
       才把这份 capability 经 authenticated channel 送出去，那一刻是
       `delivered`，不是 `launch`。 */
    this.child = host.launch(launch);
    this.observeProcess();
  }

  /**
   * 只起进程、只挂证据线，不做任何握手。
   *
   * 与 `open` 分成两半是为了「握手失败时调用方仍要拿得到这个连接」：
   * turn 的失败分类要读它的 stderr 尾巴与退出码，而进程组清理归 bridge。
   */
  static spawn(
    launch: AgentProcessLaunch,
    host: AgentProcessHost,
    options: AcpConnectionOptions
  ) {
    return new AcpConnection(launch, host, options);
  }

  /** 池的入口：spawn + custody 交付 + initialize，失败即自行收口进程。 */
  static async open(
    launch: AgentProcessLaunch,
    host: AgentProcessHost,
    options: AcpConnectionOptions
  ) {
    const connection = AcpConnection.spawn(launch, host, options);
    try {
      await connection.handshake(
        new AcpStartupTracker(
          connection.evidence.waitForExit(),
          options.startupBudgetMs
        )
      );
      return connection;
    } catch (cause) {
      await connection.close("open-failed");
      throw cause;
    }
  }

  get pid() {
    return this.child.pid;
  }

  /** 已协商的 initialize 结果；未握手时为 undefined。 */
  get initialized() {
    return this.negotiated;
  }

  get supportsSteering() {
    return this.steering;
  }

  /** 进程已死或 transport 已断：所有者据此拒绝复用，而不是再试一次。 */
  get dead() {
    return this.deadFlag;
  }

  get boundSession() {
    return this.session;
  }

  /** 空槽期被丢弃的 session/update 计数；只作诊断，不驱动任何判决。 */
  get droppedUpdates() {
    return this.dropped;
  }

  get context() {
    return this.clientContext;
  }

  requireContext() {
    if (this.deadCause) throw this.deadCause;
    if (!this.clientContext) throw new Error("ACP 连接尚未完成 initialize");
    return this.clientContext;
  }

  async handshake(stage: AcpStartupTracker) {
    if (this.clientContext) return;
    await stage.run("spawn", () =>
      new Promise<void>((resolve, reject) => {
        if (this.child.pid) resolve();
        else {
          this.child.once("spawn", () => resolve());
          this.child.once("error", reject);
        }
      })
    );
    /* 宿主进程起来 ≠ backend 拿到能力。custody 路径上还隔着 owned →
       activation-authorized → 交付 → ack 四笔账；在此之前往 stdin 写
       initialize 只会堆在管道里，把一次确指的托管故障拖成一句启动超时。 */
    await stage.run("custody", () => this.host.delivered);
    this.connect();
    try {
      this.negotiated = await stage.run("initialize", async () => {
        const context = await this.ready.promise;
        const value = await context.request(AGENT_METHODS.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          /* 政策格是唯一来源：生产 turn、readiness 探针与深握手都按后端 id
             取同一格，spawn config 不再复制一份——复制品与本体永远相等的
             那天起，摘掉复制品的负向用例就只是在测它自己。 */
          clientCapabilities: buildAcpClientCapabilities(
            SESSION_CAPABILITY_POLICY[this.options.backend]
          ),
          clientInfo: { name: "bottega", title: "Bottega", version: "0.1.0" },
        });
        assertAcpProtocolVersion(value);
        return value;
      });
    } catch (cause) {
      /* 握手失败即拆 transport：调用方拿到的是这一步的确指原因，而不是
         随后才到的 SDK 裸 EOF。 */
      this.markDead(cause);
      this.lifetime.resolve();
      throw cause;
    }
    this.steering =
      (this.negotiated as { _meta?: { steering?: { supported?: unknown } } })
        ._meta?.steering?.supported === true;
  }

  attach(handlers: AcpConnectionHandlers) {
    if (this.handlers && this.handlers !== handlers) {
      throw new Error("ACP 连接已被另一个 turn 占用");
    }
    if (this.deadCause) throw this.deadCause;
    if (this.deadFlag) throw new Error("ACP 连接已关闭");
    this.handlers = handlers;
  }

  detach() {
    this.handlers = undefined;
  }

  request<Response = unknown>(method: string, params?: unknown) {
    return this.requireContext().request<Response>(method, params);
  }

  notify(method: string, params?: unknown) {
    return this.requireContext().notify(method, params);
  }

  /** 会话绑定至多一个；同 id 重复无害，异 id 是串号。 */
  bindSession(sessionId: string) {
    if (this.session && this.session !== sessionId) {
      throw new Error("ACP 连接已绑定其他会话");
    }
    this.session = sessionId;
  }

  onExit(listener: (report: AcpExitReport) => void) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /**
   * 只收口 transport，不碰进程。
   *
   * turn 私有连接的终态走这里：进程组清理仍由 bridge 的 cleanupAgentTurn
   * 按 `turn.pid` 负责，顺序与既有的 custody 释放账保持不变。
   */
  releaseTransport() {
    this.lifetime.resolve();
  }

  /** 所有者收口：断开槽、收 transport、给退出窗口，最后清进程组。 */
  close(reason: string): Promise<CleanupResult> {
    if (this.closing) return this.closing;
    console.info(`[connections:${this.options.backend}] close(${reason})`);
    this.closing = (async () => {
      this.handlers = undefined;
      this.markDead();
      this.lifetime.resolve();
      await this.transport?.catch(() => undefined);
      this.child.stdin.end();
      const pid = this.child.pid;
      if (!pid) return { ok: true } as CleanupResult;
      await Promise.race([
        this.evidence.waitForExit(),
        wait(ACP_CONNECTION_EXIT_GRACE_MS),
      ]);
      return this.clean(pid);
    })();
    return this.closing;
  }

  private connect() {
    const guard = new AcpFramingGuard((violation) =>
      this.handlers?.onPolicyViolation?.(violation)
    );
    this.child.stdout.pipe(guard);
    const input = this.options.trace
      ? guard.pipe(
          new AcpTraceTee((line) => this.handlers?.onWire?.("in", line))
        )
      : guard;
    /* 最终 sink 自己等待 child.stdin.write callback；trace 只是旁路观察
       脱敏副本，不能参与 backpressure，也不能把 tee 接收冒充 writer ack。 */
    const output: Writable = new AcpOutboundSink(
      this.child.stdin,
      this.handoffSink,
      this.options.trace
        ? (line) => this.handlers?.onWire?.("out", line)
        : undefined
    );
    const stream = ndJsonStream(
      Writable.toWeb(output) as WritableStream<Uint8Array>,
      Readable.toWeb(input) as ReadableStream<Uint8Array>
    );
    const app = client({ name: "Bottega" })
      .onNotification(CLIENT_METHODS.session_update, ({ params }) => {
        const handlers = this.handlers;
        if (!handlers) {
          this.dropped += 1;
          return;
        }
        handlers.onUpdate(params);
      })
      .onRequest(
        CLIENT_METHODS.session_request_permission,
        ({ params, requestId }) =>
          this.handlers
            ? this.handlers.onPermission(String(requestId), params)
            : unattachedRequest(CLIENT_METHODS.session_request_permission)
      )
      .onRequest(CLIENT_METHODS.elicitation_create, ({ params, requestId }) =>
        this.handlers
          ? this.handlers.onElicitation(String(requestId), params)
          : unattachedRequest(CLIENT_METHODS.elicitation_create)
      );
    /* op 的寿命就是连接的寿命：SDK 在 op 结算时关闭连接，所以这里等的是
       连接自己的 lifetime，而不是某一轮的终态。 */
    this.transport = app.connectWith(stream, async (context) => {
      this.clientContext = context;
      this.ready.resolve(context);
      await this.lifetime.promise;
    });
    void this.transport.catch((cause) => this.fail(cause));
  }

  private readonly handoffSink: PromptHandoffSink = {
    pending: (requestId) => this.handlers?.handoff.pending(requestId),
    accepted: (requestId) => this.handlers?.handoff.accepted(requestId),
    rejected: (requestId) => this.handlers?.handoff.rejected(requestId),
  };

  private observeProcess() {
    const backend = this.options.backend;
    this.child.stderr.on("data", (chunk: Buffer) => {
      const visible = this.evidence.writeStderr(chunk);
      if (visible) console.warn(`[acp:${backend}]`, visible);
    });
    this.child.stderr.once("end", () => {
      const visible = this.evidence.endStderr();
      if (visible) console.warn(`[acp:${backend}]`, visible);
    });
    this.child.stdin.on("error", (cause) => this.fail(cause));
    this.child.once("error", (cause) => this.fail(cause));
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
      this.announceExit(this.evidence.recordExit(code, signal));
    });
    this.child.once("close", (code, signal) => {
      /* spawn 失败只有 error + close、没有 exit：这里补一次幂等结算，
         证据来源才没有缺口。已结算时 Promise 语义使其自然失效。 */
      const settled = this.evidence.recordExit(code, signal);
      this.announceExit(settled);
      this.fail(new Error(describeAcpExit(settled)));
    });
  }

  private announceExit(report: AcpExitReport) {
    this.markDead();
    for (const listener of [...this.exitListeners]) listener(report);
    this.exitListeners.clear();
  }

  /** 进程或 transport 死了：先记死状，再交给当前 turn；空槽期只留死因。 */
  private fail(cause: unknown) {
    this.markDead(cause);
    this.handlers?.onProcessError(cause);
  }

  private markDead(cause?: unknown) {
    this.deadFlag = true;
    if (cause !== undefined && !this.deadCause) this.deadCause = asError(cause);
  }
}
