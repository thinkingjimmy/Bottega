/**
 * [INPUT]: Uses the work's actual Provider identity, product turn/input contracts, main-sealed ACP or native plans, execution references and ordered bridge events.
 * [OUTPUT]: Exports BridgedTurn with frozen configuration, approval/control forwarding, live exact-owner MCP consent eligibility, delivery evidence and cancellation-safe Chat background transfer with exact-item termination and exact-owner durable result commits.
 * [POS]: Main-side authorization and custody owner; protocol parsing remains in the pinned bridge driver.
 */
import { randomUUID } from "node:crypto";
import type { AgentApprovalDecision, AgentUserInputAnswers, AgentUserInputQuestion, PromptHandoff } from "../../../../../shared/ipc/agent/agent-ipc";
import type { ProviderTurnInput } from "../../../backends/contracts/turn-input";
import type { NativeSpawnConfig } from "../../codex/native/policy/launch";
import { nativeBackgrounds } from "../../codex/native/background/registry";
import type { AdapterSteerOutcome, AgentTurn, BackendTurnOptions, StartOutcome, TurnProcessOwner } from "../../../backends/contracts/types";
import { acpMcpServers, turnLaunch, type AcpSpawnConfig } from "../../../backends/acp/launch";
import { AcpProcessEvidence } from "../../../backends/acp/startup/evidence";
import type { UtilityHost } from "../../../host/utility-host";
import type { VerifiedPrincipal } from "../../../operations/principals";
import { NOTIFY_CALLBACKS, type BridgeTurnEvent, type BridgeTurnRequest, type BridgeTurnStart } from "../protocol";
import type { ProviderBridgeRuntime } from "../runtime";

const REDACTED_CALLBACKS = new Set(["onTerminal", "onProcessError", "onPolicyViolation"]);
const RELEASE_GRACE_MS = 30_000;
type NativePlan = { protocol: "codex-app-server"; env: NodeJS.ProcessEnv; prepare(): Promise<NativeSpawnConfig> };
const secretsOf = (options: BackendTurnOptions) => [...(options.thirdPartyMcpPlan?.entries ?? [])
  .flatMap(entry => Object.values(entry.transport === "stdio" ? entry.env : entry.headers)),
  ...Object.values(options.builtinMcp?.server.env ?? {})].filter(Boolean);

export class BridgedTurn implements AgentTurn {
  readonly turnKey = randomUUID();
  private host: UtilityHost | null = null;
  private ref: string | null = null;
  private pidValue: number | undefined;
  private owner: TurnProcessOwner | null = null;
  private steering = false;
  private done = false;
  private closed = false;
  private stopping = false;
  private backgroundStaged = false;
  private readonly questions = new Map<string, { questions: AgentUserInputQuestion[] }>();
  private readonly evidence: AcpProcessEvidence;
  private native: NativeSpawnConfig | null = null;
  private nativeConfigIssued = false;
  private readonly mcpBinding: Readonly<{ leaseId: string; generation: number; requestId: string; chatId: string; incarnationId: string }> | null;
  private readonly mcpServers: ReadonlySet<string>;

  constructor(private readonly options: BackendTurnOptions, private readonly config: AcpSpawnConfig | NativePlan, private readonly runtime: ProviderBridgeRuntime,
    private readonly prepareLaunch?: (launch: ReturnType<typeof turnLaunch>) => Promise<import("../../../backends/contracts/types").AgentProcessLaunch>) {
    const lease = options.builtinMcp?.lease;
    this.mcpBinding = lease ? Object.freeze({ leaseId: lease.leaseId, generation: lease.generation,
      requestId: options.payload.requestId, chatId: options.payload.scope.conversationId,
      incarnationId: options.chatIncarnationId ?? lease.incarnationId }) : null;
    this.mcpServers = new Set((options.thirdPartyMcpPlan?.entries ?? []).map(entry => entry.backendAlias));
    this.evidence = new AcpProcessEvidence(config.env, { secrets: secretsOf(options) });
  }

  /** The Provider whose bridge runs this turn (G7: a bridge's exit fails only its own Provider's turns). */
  get providerId() { return this.options.payload.turnOptions.backend; }
  get pid() { return this.pidValue; }
  /** B2-01: the host-custody child main launched for this turn; cleanup and Force stop act through it, never the outer intent. */
  processOwner() { return this.owner; }
  get steeringSupported() { return this.steering; }

  async start(startupSignal?: AbortSignal): Promise<StartOutcome> {
    /* The launch is sealed here, with the fence and the full environment; the bridge only ever asks to spawn it (C2, C3). */
    startupSignal?.throwIfAborted();
    if ("protocol" in this.config) this.native = await this.config.prepare();
    startupSignal?.throwIfAborted();
    if (this.closed) throw new Error("Turn stopped before launch preparation completed");
    const baseLaunch = this.native ? this.native.launch : turnLaunch(this.options, this.config as AcpSpawnConfig);
    const launch = this.prepareLaunch ? await this.prepareLaunch({ ...baseLaunch, args: [...baseLaunch.args] }) : baseLaunch;
    const chat = { chatId: this.options.payload.scope.conversationId,
      incarnationId: this.options.chatIncarnationId ?? this.options.builtinMcp?.lease.incarnationId ?? "provider-bridge" };
    const principal: VerifiedPrincipal = this.runtime.turnPrincipal(chat, this.options.payload.requestId, this.turnKey, () => !this.closed);
    this.host = await this.runtime.ensure(this.providerId, principal, this.options.runtime);
    startupSignal?.throwIfAborted();
    if (this.closed) throw new Error("Turn stopped before process admission");
    this.ref = this.runtime.issue(principal, { launch, bind: owner => { this.owner = owner; },
      dependencies: this.options.custodyDependencies ?? [] }, this);
    const abort = () => { void this.host?.invoke("turn.abortStart", { turnKey: this.turnKey }, []).catch(() => undefined); };
    startupSignal?.addEventListener("abort", abort, { once: true });
    try {
      return await this.host.invoke("turn.start", this.startInput(), [this.ref]) as StartOutcome;
    } finally {
      startupSignal?.removeEventListener("abort", abort);
    }
  }

  /** Applied in the order the bridge produced them; a finished turn applies nothing more (C5, C6). */
  apply(event: BridgeTurnEvent) {
    if (event.k === "native-background-update") { nativeBackgrounds.update(this.turnKey, event.terminals, event.output); return; }
    if (event.k === "native-background-ended") { void nativeBackgrounds.stop(this.turnKey, "unknown").catch(cause => console.warn("[codex] background cleanup failed", cause)); return; }
    if (this.done) return;
    const callbacks = this.options.callbacks as unknown as Record<string, ((...args: unknown[]) => void) | undefined>;
    if (event.k === "cb") {
      if (!NOTIFY_CALLBACKS.includes(event.name)) return;
      const args = this.native || REDACTED_CALLBACKS.has(event.name) ? this.redact(event.args) : event.args;
      if (event.name === "onUserInput") { const request = args[0] as { userInputId: string; questions: AgentUserInputQuestion[] }; this.questions.set(request.userInputId, { questions: request.questions }); }
      if (event.name === "onUserInputClosed") this.questions.delete(args[0] as string);
      callbacks[event.name]?.(...args);
      if (event.name === "onTerminal" || event.name === "onProcessError") {
        const retain = this.backgroundStaged && !this.stopping && event.name === "onTerminal" && (args[0] as { type?: string })?.type === "done";
        this.finish(retain);
      }
    } else if (event.k === "subagent-meta") {
      this.options.subagents.upsertMeta(event.input as Parameters<BackendTurnOptions["subagents"]["upsertMeta"]>[0]);
    } else if (event.k === "trace-wire") {
      this.options.trace?.recordWire(event.direction as never, this.evidence.redact(event.line));
    } else if (event.k === "trace-mapped") {
      this.options.trace?.recordMapped(this.redact([event.event])[0] as never);
    } else if (event.k === "process") {
      this.pidValue = event.pid ?? undefined; this.steering = event.steering;
    }
  }

  /** The awaited callbacks, answered by the real main objects; the synchronous authority check rides along (C5). */
  async request(request: BridgeTurnRequest): Promise<unknown> {
    if (request.k === "native-background-result") {
      if (!this.native || !this.backgroundStaged) throw new Error("No native background result authority");
      const result = { ...request.result, output: this.evidence.redact(request.result.output) };
      await nativeBackgrounds.complete(this.turnKey, result); return null;
    }
    if (this.done) throw new Error("turn already finished");
    switch (request.k) {
      case "thread": {
        const expected = this.native?.nativeConfig.continuation?.threadId;
        if (request.previous && (!expected || request.previous.backend !== this.providerId || request.previous.id !== expected ||
          this.options.payload.session?.backend !== this.providerId || this.options.payload.session.id !== expected || request.session.backend !== this.providerId || request.session.id === expected)) throw new Error("Native fork binding does not match its frozen source");
        if (expected && !request.previous) throw new Error("Native fork requires an atomic source-session replacement");
        return this.options.callbacks.onThread(request.session, request.previous);
      }
      case "authority": await this.options.trustedAuthority?.validate(); this.options.trustedAuthority?.current(); return null;
      case "session-prompt": this.options.trustedAuthority?.current(); await this.options.onSessionPrompt?.(request.sessionId, request.texts as string[]); return null;
      case "builtin-ready": await this.options.builtinMcp?.waitReady(new AbortController().signal); return null;
      case "recovery-complete": await this.options.sessionRecovery?.complete(request.outcome as "resumed" | "replayed"); return null;
      /* Only a live turn is answered: the tokens exist in the bridge for this session's creation, never for a later one. */
      case "mcp-servers": {
        if (this.native) throw new Error("Native turns do not expose ACP MCP servers");
        return acpMcpServers(this.options, this.config as AcpSpawnConfig);
      }
      case "native-mcp-consent": {
        if (!this.native || !this.nativeConfigIssued || !this.owner || !this.ref || this.closed || this.stopping
          || typeof request.serverName !== "string" || typeof request.toolName !== "string" || !/^[A-Za-z0-9_./:-]{1,128}$/.test(request.toolName)) return false;
        this.options.trustedAuthority?.current();
        const builtin = this.options.builtinMcp, binding = this.mcpBinding;
        if (builtin && builtin.server.name === request.serverName) {
          const lease = builtin.lease;
          return Boolean(binding && lease.leaseId === binding.leaseId && lease.generation === binding.generation
            && lease.requestId === binding.requestId && lease.chatId === binding.chatId && lease.incarnationId === binding.incarnationId
            && lease.initiatorBackend === this.providerId && lease.state !== "revoked" && !lease.signal.aborted
            && lease.allowedTools.some(tool => tool === request.toolName));
        }
        return this.mcpServers.has(request.serverName);
      }
      case "native-config": {
        if (!this.native || this.nativeConfigIssued) throw new Error("Native configuration is unavailable or already consumed");
        this.options.trustedAuthority?.current();
        this.nativeConfigIssued = true;
        return this.native.nativeConfig;
      }
      case "native-background": {
        if (!this.native || !this.owner || this.backgroundStaged) throw new Error("Native background ownership is unavailable");
        this.backgroundStaged = true;
        const owner = this.owner;
        if (!owner.recordDescendants) throw new Error("Native background custody requires durable descendant evidence");
        await owner.recordDescendants();
        if (this.done || this.closed || this.stopping) throw new Error("Native background transfer was cancelled");
        await nativeBackgrounds.stage({ key: this.turnKey, requestId: this.options.payload.requestId, providerId: this.providerId, chatId: this.options.payload.scope.conversationId,
          incarnationId: this.options.chatIncarnationId ?? "provider-bridge", threadId: request.threadId, lastTurnId: request.lastTurnId,
          persist: results => { if (!this.options.persistNativeBackgroundResults) throw new Error("Background result persistence unavailable"); return this.options.persistNativeBackgroundResults(results); },
          permissionMode: this.options.payload.turnOptions.permissionMode, terminals: request.terminals.map(terminal => ({ ...terminal, command: this.evidence.redact(terminal.command), cwd: this.evidence.redact(terminal.cwd) })),
          stopNative: () => this.invoke("turn.background.stop", {}).then(() => undefined), settle: () => owner.settle(),
          stopCommandNative: itemId => this.invoke("turn.background.stopCommand", { itemId }).then(() => undefined),
          forget: () => { this.closed = true; this.runtime.forget(this); void this.host?.invoke("turn.release", { turnKey: this.turnKey }, []).catch(() => undefined); } });
        if (this.done || this.closed || this.stopping) {
          nativeBackgrounds.discard(this.turnKey);
          throw new Error("Native background transfer was cancelled");
        }
        return null;
      }
      case "contribution-consume": {
        /* Main owns the lease: it is consumed here, once per ask, and the bridge's prompt uses the validation it gets back (G9). */
        const contribution = this.options.sensitiveContribution;
        if (!contribution) throw new Error("this turn carries no contribution");
        const validation = await contribution.consume();
        this.options.onPromptContributionValidation?.(validation);
        return validation;
      }
    }
  }

  respondApproval(approvalId: string, decision: AgentApprovalDecision) {
    return this.invoke("turn.respondApproval", { approvalId, decision }).then(() => undefined);
  }
  pendingUserInput(userInputId: string) { return this.questions.get(userInputId); }
  respondUserInput(userInputId: string, answers: AgentUserInputAnswers) {
    this.questions.delete(userInputId);
    void this.invoke("turn.respondUserInput", { userInputId, answers }).catch(() => undefined);
  }
  steer(prompt: ProviderTurnInput[]) { return this.invoke("turn.steer", { prompt }) as Promise<AdapterSteerOutcome>; }
  /* A bridge that cannot answer (gone with the process group at quit, or the turn already released there) leaves the handoff unknowable:
     the prompt counts as possibly handed off, and finalization, quit included, goes on. */
  promptHandoff() {
    return (this.invoke("turn.promptHandoff", {}) as Promise<PromptHandoff>).catch((): PromptHandoff => ({ kind: "pending" }));
  }
  interrupt() { this.stopping = true; void this.invoke("turn.interrupt", {}).catch(() => undefined); }
  markStopped() {
    this.stopping = true;
    void this.invoke("turn.markStopped", {}).catch(() => undefined);
    this.finish();
    if (!this.closed) { this.closed = true; nativeBackgrounds.discard(this.turnKey); this.runtime.forget(this); }
    /* The finalizer may still ask for the prompt handoff after Stop; the bridge keeps the turn for a short grace. */
    setTimeout(() => { void this.host?.invoke("turn.release", { turnKey: this.turnKey }, []).catch(() => undefined); }, RELEASE_GRACE_MS).unref();
  }

  async transferBackground(release: () => Promise<void>) {
    return this.backgroundStaged && this.done && !this.closed && !this.stopping && nativeBackgrounds.activate(this.turnKey, release);
  }

  /** The bridge died or went away mid-turn: the Chat fails typed instead of hanging (C8). */
  bridgeLost(reason: string) {
    this.stopping = true;
    if (this.backgroundStaged && this.done) { void nativeBackgrounds.stop(this.turnKey, "unknown").catch(cause => console.warn("[codex] lost background cleanup failed", cause)); return; }
    if (this.done) return;
    this.options.callbacks.onProcessError({ kind: "unknown", message: `Provider bridge stopped: ${reason}` } as never);
    this.finish();
  }

  /** Terminal: no further event is applied and the execution ref dies with the principal; bridge state waits for Stop. */
  private finish(retain = false) {
    if (this.done) return;
    this.done = true;
    if (retain) return;
    this.closed = true;
    nativeBackgrounds.discard(this.turnKey);
    this.runtime.forget(this);
  }

  private invoke(method: string, params: Record<string, unknown>) {
    if (!this.host) return Promise.reject(new Error("bridged turn has not started"));
    return this.host.invoke(method, { turnKey: this.turnKey, ...params }, []);
  }

  private redact(args: unknown[]) {
    return JSON.parse(JSON.stringify(args), (_key, value) => typeof value === "string" ? this.evidence.redact(value) : value) as unknown[];
  }

  /** Initial bridge input has no secrets; main supplies frozen MCP configuration through an awaited authorized request. */
  private startInput(): BridgeTurnStart {
    const options = this.options, blank = (record: Record<string, string>) => Object.fromEntries(Object.keys(record).map(key => [key, ""]));
    return JSON.parse(JSON.stringify({
      turnKey: this.turnKey, protocol: this.native ? "codex-app-server" : "acp", chatIncarnationId: options.chatIncarnationId, payload: options.payload, input: options.input.input, runtime: options.runtime, workspace: options.workspace,
      artifactDirectory: options.artifactDirectory, productContext: options.productContext,
      sensitive: options.sensitiveContribution && { kind: options.sensitiveContribution.kind, text: options.sensitiveContribution.text,
        count: options.sensitiveContribution.count, bytes: options.sensitiveContribution.bytes },
      serverFactBinding: options.serverFactBinding,
      recovery: options.sessionRecovery && { candidate: options.sessionRecovery.candidate },
      hooks: { sessionPrompt: Boolean(options.onSessionPrompt), authority: Boolean(options.trustedAuthority) },
      builtinMcp: options.builtinMcp && { server: { ...options.builtinMcp.server, env: blank(options.builtinMcp.server.env) } },
      thirdPartyMcpPlan: options.thirdPartyMcpPlan && { ...options.thirdPartyMcpPlan, entries: options.thirdPartyMcpPlan.entries.map(entry =>
        entry.transport === "stdio" ? { ...entry, env: blank(entry.env) } : { ...entry, headers: blank(entry.headers) }) },
      subagents: options.subagents.persisted(),
      sessionMeta: "sessionMeta" in this.config ? this.config.sessionMeta?.(options) : undefined,
      trace: Boolean(options.trace),
    }));
  }
}
