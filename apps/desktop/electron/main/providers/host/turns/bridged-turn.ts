/**
 * [INPUT]: Depends on Node crypto, the backend turn types, the shared fenced launch (turnLaunch), ACP process evidence (redaction), the bridge protocol and ProviderBridgeRuntime
 * [OUTPUT]: Provides BridgedAcpTurn, an AgentTurn whose ACP client runs in the Provider bridge while every effect it has on main is applied here; for the acp MCP transport it answers the session's servers (tokens included) while the turn lives; a prompt handoff the bridge can no longer answer is pending, so a dead bridge never blocks finalization or quit
 * [POS]: The main half of a bridged turn (Codex, OpenCode, Kimi). The turn registry, ChatsService and renderer see an ordinary AgentTurn; main seals the launch (fence + environment + secrets) on the execution ref, applies the bridge's ordered events to the real callbacks, answers its awaited requests, and forwards approvals, answers, steer and Stop; its process is owned by host custody, bound here as processOwner (B2-01)
 */
import { randomUUID } from "node:crypto";
import type { AgentApprovalDecision, AgentUserInputAnswers, AgentUserInputQuestion, PromptHandoff } from "../../../../../shared/ipc/agent/agent-ipc";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AdapterSteerOutcome, AgentTurn, BackendTurnOptions, StartOutcome, TurnProcessOwner } from "../../../backends/types";
import { acpMcpServers, turnLaunch, type AcpSpawnConfig } from "../../../backends/acp/launch";
import { AcpProcessEvidence } from "../../../backends/acp/startup/evidence";
import type { UtilityHost } from "../../../host/utility-host";
import type { VerifiedPrincipal } from "../../../operations/principals";
import { NOTIFY_CALLBACKS, type BridgeTurnEvent, type BridgeTurnRequest, type BridgeTurnStart } from "../protocol";
import type { ProviderBridgeRuntime } from "../runtime";

const REDACTED_CALLBACKS = new Set(["onTerminal", "onProcessError", "onPolicyViolation"]);
const RELEASE_GRACE_MS = 30_000;
const secretsOf = (options: BackendTurnOptions) => [...(options.thirdPartyMcpPlan?.entries ?? [])
  .flatMap(entry => Object.values(entry.transport === "stdio" ? entry.env : entry.headers)),
  ...Object.values(options.builtinMcp?.server.env ?? {})].filter(Boolean);

export class BridgedAcpTurn implements AgentTurn {
  readonly turnKey = randomUUID();
  private host: UtilityHost | null = null;
  private ref: string | null = null;
  private pidValue: number | undefined;
  private owner: TurnProcessOwner | null = null;
  private steering = false;
  private done = false;
  private readonly questions = new Map<string, { questions: AgentUserInputQuestion[] }>();
  private readonly evidence: AcpProcessEvidence;

  constructor(private readonly options: BackendTurnOptions, private readonly config: AcpSpawnConfig, private readonly runtime: ProviderBridgeRuntime,
    private readonly prepareLaunch?: (launch: ReturnType<typeof turnLaunch>) => Promise<import("../../../backends/types").AgentProcessLaunch>) {
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
    const baseLaunch = turnLaunch(this.options, this.config);
    const launch = this.prepareLaunch ? await this.prepareLaunch(baseLaunch) : baseLaunch;
    const chat = { chatId: this.options.payload.scope.conversationId,
      incarnationId: this.options.builtinMcp?.lease.incarnationId ?? "provider-bridge" };
    const principal: VerifiedPrincipal = this.runtime.turnPrincipal(chat, this.options.payload.requestId, this.turnKey, () => !this.done);
    this.host = await this.runtime.ensure(this.providerId, principal, this.options.runtime);
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
    if (this.done) return;
    const callbacks = this.options.callbacks as unknown as Record<string, ((...args: unknown[]) => void) | undefined>;
    if (event.k === "cb") {
      if (!NOTIFY_CALLBACKS.includes(event.name)) return;
      const args = REDACTED_CALLBACKS.has(event.name) ? this.redact(event.args) : event.args;
      if (event.name === "onUserInput") { const request = args[0] as { userInputId: string; questions: AgentUserInputQuestion[] }; this.questions.set(request.userInputId, { questions: request.questions }); }
      if (event.name === "onUserInputClosed") this.questions.delete(args[0] as string);
      callbacks[event.name]?.(...args);
      if (event.name === "onTerminal" || event.name === "onProcessError") this.finish();
    } else if (event.k === "subagent-meta") {
      this.options.subagents.upsertMeta(event.input as Parameters<BackendTurnOptions["subagents"]["upsertMeta"]>[0]);
    } else if (event.k === "trace-wire") {
      this.options.trace?.recordWire(event.direction as never, event.line);
    } else if (event.k === "trace-mapped") {
      this.options.trace?.recordMapped(event.event as never);
    } else if (event.k === "process") {
      this.pidValue = event.pid ?? undefined; this.steering = event.steering;
    }
  }

  /** The awaited callbacks, answered by the real main objects; the synchronous authority check rides along (C5). */
  async request(request: BridgeTurnRequest): Promise<unknown> {
    if (this.done) throw new Error("turn already finished");
    switch (request.k) {
      case "thread": return this.options.callbacks.onThread(request.session);
      case "authority": await this.options.trustedAuthority?.validate(); this.options.trustedAuthority?.current(); return null;
      case "session-prompt": this.options.trustedAuthority?.current(); await this.options.onSessionPrompt?.(request.sessionId, request.texts as string[]); return null;
      case "builtin-ready": await this.options.builtinMcp?.waitReady(new AbortController().signal); return null;
      case "recovery-complete": await this.options.sessionRecovery?.complete(request.outcome as "resumed" | "replayed"); return null;
      /* Only a live turn is answered: the tokens exist in the bridge for this session's creation, never for a later one. */
      case "mcp-servers": return acpMcpServers(this.options, this.config);
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
  steer(prompt: ContentBlock[]) { return this.invoke("turn.steer", { prompt }) as Promise<AdapterSteerOutcome>; }
  /* A bridge that cannot answer (gone with the process group at quit, or the turn already released there) leaves the handoff unknowable:
     the prompt counts as possibly handed off, and finalization, quit included, goes on. */
  promptHandoff() {
    return (this.invoke("turn.promptHandoff", {}) as Promise<PromptHandoff>).catch((): PromptHandoff => ({ kind: "pending" }));
  }
  interrupt() { void this.invoke("turn.interrupt", {}).catch(() => undefined); }
  markStopped() {
    void this.invoke("turn.markStopped", {}).catch(() => undefined);
    this.finish();
    /* The finalizer may still ask for the prompt handoff after Stop; the bridge keeps the turn for a short grace. */
    setTimeout(() => { void this.host?.invoke("turn.release", { turnKey: this.turnKey }, []).catch(() => undefined); }, RELEASE_GRACE_MS).unref();
  }

  /** The bridge died or went away mid-turn: the Chat fails typed instead of hanging (C8). */
  bridgeLost(reason: string) {
    if (this.done) return;
    this.options.callbacks.onProcessError({ kind: "unknown", message: `Provider bridge stopped: ${reason}` } as never);
    this.finish();
  }

  /** Terminal: no further event is applied and the execution ref dies with the principal; bridge state waits for Stop. */
  private finish() {
    if (this.done) return;
    this.done = true;
    this.runtime.forget(this);
  }

  private invoke(method: string, params: Record<string, unknown>) {
    if (!this.host) return Promise.reject(new Error("bridged turn has not started"));
    return this.host.invoke(method, { turnKey: this.turnKey, ...params }, []);
  }

  private redact(args: unknown[]) {
    return JSON.parse(JSON.stringify(args), (_key, value) => typeof value === "string" ? this.evidence.redact(value) : value) as unknown[];
  }

  /** Everything the bridge needs, secrets blanked: MCP credentials stay in the sealed launch environment (C9). */
  private startInput(): BridgeTurnStart {
    const options = this.options, blank = (record: Record<string, string>) => Object.fromEntries(Object.keys(record).map(key => [key, ""]));
    return JSON.parse(JSON.stringify({
      turnKey: this.turnKey, payload: options.payload, input: options.input.input, runtime: options.runtime, workspace: options.workspace,
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
      sessionMeta: this.config.sessionMeta?.(options),
      trace: Boolean(options.trace),
    }));
  }
}
