/**
 * [INPUT]: Uses a custody-backed AgentProcessHost, main-frozen NativeTurnConfig, native RPC and product callbacks.
 * [OUTPUT]: Exports CodexNativeTurn, implementing the product AgentTurn over native Thread/Turn methods.
 * Native Skill-budget warnings remain durable turn facts on success and failure.
 * [POS]: Native lifecycle owner; no ACP methods, launcher fallback or client-side automatic approval.
 */
import type { AgentApprovalDecision, AgentUserInputAnswers, PromptHandoff } from "../../../../../../shared/ipc/agent/agent-ipc";
import type { AgentProcessHost, AgentTurn, AdapterSteerOutcome, BackendTurnOptions, StartOutcome } from "../../../../backends/contracts/types";
import type { ProviderTurnInput } from "../../../../backends/contracts/turn-input";
import { providerInput } from "../../../../backends/contracts/materialize";
import { NativeConnection, type NativeMessage } from "../transport/connection";
import { nativeInput, type NativeTurnConfig } from "../policy/parameters";
import { NativeEvents } from "../mapping/events";
import { nativeRecord } from "../transport/record";
import { NativeRpcError } from "../transport/errors";
import type { ThreadItem } from "../schema";
import { NativeInteractions } from "./interactions";
import { nativeHistoryMatches } from "./history";
import { nativeFailure } from "../mapping/failure";
import { codexSessionMissing } from "../../turn-config";
import type { NativeTerminal } from "../background/registry";

function boundedResultOutput(value: string) {
  const bytes = Buffer.from(value);
  if (bytes.length <= 65_536) return value;
  let offset = bytes.length - 65_500;
  while ((bytes[offset] & 0xc0) === 0x80) offset++;
  return "[Output truncated]\n" + bytes.subarray(offset).toString("utf8");
}

export class CodexNativeTurn implements AgentTurn {
  private readonly rpc: NativeConnection;
  private readonly events: NativeEvents;
  private readonly interactions: NativeInteractions;
  private readonly secrets = new Set<string>();
  private threadId: string | null = null;
  private turnId: string | null = null;
  private done = false;
  private started = false;
  private submitted = false;
  private accepted = false;
  private handoff: PromptHandoff = { kind: "not-created" };
  private readonly handoffWaiters = new Set<(value: PromptHandoff) => void>();
  private readonly earlyEvents: NativeMessage[] = [];
  private chain: Promise<void> = Promise.resolve();
  private steering: Promise<AdapterSteerOutcome> | null = null;
  private startupError: Error | null = null;
  private config: NativeTurnConfig | null = null;
  private backgroundActive = false;
  private terminals: NativeTerminal[] = [];
  private readonly retainedTerminals = new Map<string, NativeTerminal>();
  private backgroundTimer?: ReturnType<typeof setInterval>;
  private polling = false;
  private skillDescriptionsTruncated = false;

  constructor(private readonly options: BackendTurnOptions, host: AgentProcessHost,
    private readonly configuration: () => Promise<NativeTurnConfig>, private readonly background?: {
      retain(input: { threadId: string; lastTurnId: string; terminals: NativeTerminal[] }): Promise<void>;
      result(result: import("../../../../../../shared/ipc/agent/background-ipc").NativeBackgroundResult): Promise<void>;
      update(terminals: NativeTerminal[], output?: { itemId: string; delta: string }): void;
      ended(): void;
    }) {
    this.events = new NativeEvents(options, value => this.redact(value));
    this.rpc = new NativeConnection(host, {
      message: message => {
        this.chain = this.chain.then(() => this.message(message)).catch(cause => this.fail(cause));
      },
      failed: error => { this.startupError = error; if (this.backgroundActive) { clearInterval(this.backgroundTimer); void this.chain.finally(() => this.background?.ended()); } else if (this.started) this.fail(error); },
      trace: (direction, summary) => options.trace?.recordWire(direction, summary),
    });
    this.interactions = new NativeInteractions(this.rpc, options,
      () => !this.done && this.threadId && this.turnId ? { threadId: this.threadId, turnId: this.turnId } : null, value => this.redact(value), itemId => this.events.fileChange(itemId));
  }
  get pid() { return this.rpc.pid; }
  get steeringSupported() { return !this.done; }

  async start(signal = new AbortController().signal): Promise<StartOutcome> {
    if (this.started) throw new Error("Native turn has already started");
    this.started = true;
    const aborted = () => { this.interrupt(); this.fail(new Error("Native startup cancelled")); };
    signal.addEventListener("abort", aborted, { once: true });
    try {
      signal.throwIfAborted();
      if (this.startupError) throw this.startupError;
      await this.rpc.initialize();
      this.config = await this.configuration();
      if (this.config.contractId !== "bb-native-v1") throw new Error("Native policy contract mismatch");
      this.collectSecrets(this.config.thread.config);
      // Disable every unselected user-configured server before creating this turn's native session.
      const loaded = nativeRecord(await this.rpc.request("config/read", { cwd: this.options.workspace, includeLayers: false }));
      const inherited = nativeRecord(nativeRecord(loaded.config).mcp_servers);
      const selected = nativeRecord(this.config.thread.config?.mcp_servers);
      const servers = { ...Object.fromEntries(Object.keys(inherited).map(name => [name, { enabled: false }])), ...selected };
      const threadParams = { ...this.config.thread, config: { ...this.config.thread.config, mcp_servers: servers } };
      const resume = this.options.payload.session;
      if (resume && resume.backend !== "codex") throw new Error("Native thread belongs to a different Provider");
      let candidate = resume?.id;
      let recovered = false;
      if (!candidate && this.options.sessionRecovery?.candidate) {
        const hint = this.options.sessionRecovery.candidate;
        if (hint.backend === "codex" && await nativeHistoryMatches(this.rpc, hint).catch(cause => {
          if (this.missing(cause, hint.sessionId)) return false;
          throw cause;
        })) { candidate = hint.sessionId; recovered = true; }
      }
      let response: Record<string, unknown>;
      try {
        const continuation = this.config.continuation;
        response = nativeRecord(await this.rpc.request(continuation ? "thread/fork" : candidate ? "thread/resume" : "thread/start",
          { ...threadParams, ...(continuation ? { ...continuation, excludeTurns: true } : candidate ? { threadId: candidate, excludeTurns: true } : {}) }, { timeoutMs: 20_000 }));
      } catch (cause) {
        if (resume && this.missing(cause, resume.id)) { this.done = true; this.rpc.close(); return "resume-failed"; }
        throw cause;
      }
      const thread = nativeRecord(response.thread);
      if (typeof thread.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(thread.id) ||
        (candidate && !this.config.continuation && thread.id !== candidate) ||
        (this.config.continuation && thread.id === this.config.continuation.threadId)) throw new Error("Invalid native thread identity");
      const actual = nativeRecord(response.sandbox), expected = this.config.turn.sandboxPolicy;
      const roots = (value: unknown) => Array.isArray(value) && value.every(root => typeof root === "string")
        ? [...new Set(value.filter(root => root !== this.options.workspace))].sort() : null;
      const workspaceMatches = expected?.type !== "workspaceWrite" || (
        actual.networkAccess === expected.networkAccess && actual.excludeTmpdirEnvVar === expected.excludeTmpdirEnvVar &&
        actual.excludeSlashTmp === expected.excludeSlashTmp && JSON.stringify(roots(actual.writableRoots)) === JSON.stringify(roots(expected.writableRoots)));
      if (response.model !== this.config.thread.model || response.approvalPolicy !== this.config.thread.approvalPolicy ||
        response.approvalsReviewer !== this.config.thread.approvalsReviewer || actual.type !== expected?.type || !workspaceMatches) {
        throw Object.assign(new Error("Native CLI refused the frozen model or execution policy"), { nativeKind: "policy" });
      }
      const terminals = nativeRecord(await this.rpc.request("thread/backgroundTerminals/list", { threadId: thread.id, cursor: null, limit: 1 }, { timeoutMs: 5000 }));
      if (!Array.isArray(terminals.data) || terminals.data.length || terminals.nextCursor !== null) throw new Error("Native terminal ownership cannot be established before input");
      await this.options.callbacks.onThread({ backend: "codex", id: thread.id }, this.config.continuation ? { backend: "codex", id: this.config.continuation.threadId } : undefined);
      this.threadId = thread.id;
      if (response.serviceTier !== null && typeof response.serviceTier !== "string") throw new Error("Native CLI returned an invalid service tier");
      this.options.callbacks.onServiceTierUpdate?.(response.serviceTier);
      if (this.options.sessionRecovery && !resume) await this.options.sessionRecovery.complete(recovered ? "resumed" : "replayed");
      if (this.options.builtinMcp) await this.options.builtinMcp.waitReady(signal);
      await this.options.trustedAuthority?.validate();
      signal.throwIfAborted(); this.options.trustedAuthority?.current();
      const blocks: ProviderTurnInput[] = [];
      if (this.options.productContext) blocks.push({ type: "text", text: this.options.productContext });
      if (this.options.sensitiveContribution) {
        const validation = await this.options.sensitiveContribution.consume();
        this.options.onPromptContributionValidation?.(validation);
        if (validation.kind === "allowed") blocks.push({ type: "text", text: this.options.sensitiveContribution.text });
      }
      blocks.push(...providerInput(recovered ? this.options.input.input.filter(item => item.type !== "text" || item.text !== this.options.payload.handoff?.text) : this.options.input.input));
      const input = nativeInput(blocks);
      await this.options.onSessionPrompt?.(thread.id, input.flatMap(item => item.type === "text" ? [item.text] : []));
      signal.throwIfAborted(); this.options.trustedAuthority?.current();
      if (this.done) throw new Error("Native turn ended before input submission");
      this.submitted = true;
      const result = nativeRecord(await this.rpc.request("turn/start", { ...this.config.turn, threadId: thread.id, input }, { write: {
        pending: id => { this.handoff = { kind: "pending", transportRequestId: id }; },
        accepted: id => this.publishHandoff({ kind: "accepted", transportRequestId: id }),
        rejected: id => this.publishHandoff({ kind: "rejected", transportRequestId: id }),
      } }));
      const turn = nativeRecord(result.turn);
      if (typeof turn.id !== "string" || !turn.id || turn.id.length > 4096) throw new Error("Native turn/start returned no valid turn id");
      if (this.turnId && this.turnId !== turn.id) throw new Error("Native turn/start identity mismatch");
      this.turnId = turn.id; this.accepted = true;
      for (const message of this.earlyEvents.splice(0)) await this.message(message);
      return "started";
    } catch (cause) { this.fail(cause); throw new Error(this.redact(cause instanceof Error ? cause.message : String(cause))); }
    finally { signal.removeEventListener("abort", aborted); }
  }

  promptHandoff() {
    if (this.handoff.kind !== "pending" || this.done) return Promise.resolve(this.handoff);
    return new Promise<PromptHandoff>(resolve => this.handoffWaiters.add(resolve));
  }
  private publishHandoff(value: PromptHandoff) {
    if (this.handoff.kind === "accepted" || this.handoff.kind === "rejected") return;
    this.handoff = value;
    for (const resolve of this.handoffWaiters) resolve(value);
    this.handoffWaiters.clear();
  }

  async steer(prompt: ProviderTurnInput[]): Promise<AdapterSteerOutcome> {
    if (this.done || !this.accepted || !this.turnId || !this.threadId) return { outcome: "unconsumed", reason: "not-in-flight" };
    const run = async (): Promise<AdapterSteerOutcome> => {
      if (this.done || !this.turnId) return { outcome: "unconsumed", reason: "not-in-flight" };
      try {
        await this.rpc.request("turn/steer", { threadId: this.threadId, expectedTurnId: this.turnId, input: nativeInput(prompt) });
        return { outcome: "injected" };
      } catch (cause) {
        if (cause instanceof NativeRpcError && cause.code === -32600 && /no active turn/i.test(cause.message)) return { outcome: "unconsumed", reason: "not-in-flight" };
        return { outcome: "ambiguous", reason: "Native steering delivery could not be confirmed" };
      }
    };
    const flight = (this.steering ?? Promise.resolve()).then(run);
    this.steering = flight;
    try { return await flight; } finally { if (this.steering === flight) this.steering = null; }
  }
  respondApproval(id: string, decision: AgentApprovalDecision) { return this.interactions.respondApproval(id, decision); }
  pendingUserInput(id: string) { return this.interactions.pendingUserInput(id); }
  respondUserInput(id: string, answers: AgentUserInputAnswers) { this.interactions.respondUserInput(id, answers); }
  interrupt() { if (this.threadId && this.turnId && !this.done) void this.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }, { timeoutMs: 5000 }).catch(cause => this.fail(cause)); }
  markStopped() { this.done = true; clearInterval(this.backgroundTimer); this.interactions.close(); this.rpc.close(); for (const resolve of this.handoffWaiters) resolve(this.handoff); this.handoffWaiters.clear(); }

  async stopBackground() {
    clearInterval(this.backgroundTimer);
    try {
      for (const terminal of this.terminals) await this.rpc.request("thread/backgroundTerminals/terminate", { threadId: this.threadId, processId: terminal.processId }, { timeoutMs: 5000 });
    } finally { this.backgroundActive = false; this.rpc.close(); }
  }

  private async backgroundTerminals() {
    const terminals: NativeTerminal[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const result: { data: NativeTerminal[]; nextCursor: string | null } = await this.rpc.request("thread/backgroundTerminals/list", { threadId: this.threadId, cursor, limit: 64 }, { timeoutMs: 5000 });
      if (!Array.isArray(result.data) || terminals.length + result.data.length > 64) throw new Error("Native background list is invalid or exceeds its budget");
      for (const row of result.data) {
        if (typeof row.processId !== "string" || typeof row.itemId !== "string" || typeof row.command !== "string" || typeof row.cwd !== "string") throw new Error("Invalid native terminal identity");
        terminals.push({ processId: row.processId, itemId: row.itemId, command: this.redact(row.command), cwd: row.cwd });
      }
      cursor = result.nextCursor;
      if (cursor !== null && (typeof cursor !== "string" || seen.has(cursor))) throw new Error("Native background cursor is invalid");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return terminals;
  }

  private watchBackground() {
    this.backgroundTimer = setInterval(() => {
      if (this.polling || !this.backgroundActive) return;
      this.polling = true;
      void this.backgroundTerminals().then(async terminals => {
        await this.chain;
        if (terminals.some(row => !this.terminals.some(previous => previous.processId === row.processId))) throw new Error("Background owner observed an unowned native execution");
        this.terminals = terminals;
        this.background?.update(terminals);
        this.rpc.resetBudget();
        if (!terminals.length) { clearInterval(this.backgroundTimer); this.background?.ended(); }
      }).catch(() => { clearInterval(this.backgroundTimer); this.background?.ended(); }).finally(() => { this.polling = false; });
    }, 2000);
    this.backgroundTimer.unref();
  }

  private async message(message: NativeMessage) {
    if (this.done) {
      if (message.id !== undefined) this.rpc.reject(message.id, "Native turn has ended");
      const p = nativeRecord(message.params);
      if (this.backgroundActive && p.threadId === this.threadId && p.turnId === this.turnId) {
        if (message.method === "item/commandExecution/outputDelta" && typeof p.itemId === "string" && this.retainedTerminals.has(p.itemId) && typeof p.delta === "string") {
          if (Buffer.byteLength(p.delta) > 64 * 1024) { this.background?.ended(); return; }
          this.background?.update(this.terminals, { itemId: p.itemId, delta: this.redact(p.delta) });
        }
        if (message.method === "item/completed") {
          const item = nativeRecord(p.item), terminal = typeof item.id === "string" ? this.retainedTerminals.get(item.id) : undefined;
          if (item.type === "commandExecution" && terminal) {
            if ((item.processId !== null && item.processId !== terminal.processId) || this.redact(String(item.command)) !== terminal.command || this.redact(String(item.cwd)) !== terminal.cwd) throw new Error("Native background result identity mismatch");
            if (Number.isSafeInteger(item.exitCode)) await this.background?.result({ itemId: terminal.itemId, outcome: item.exitCode === 0 && item.status === "completed" ? "completed" : "failed", exitCode: Number(item.exitCode), output: typeof item.aggregatedOutput === "string" ? boundedResultOutput(this.redact(item.aggregatedOutput)) : "" });
          }
        }
      }
      return;
    }
    const p = nativeRecord(message.params);
    if (message.method === "warning" && (p.threadId === null || (this.threadId && p.threadId === this.threadId)) &&
      typeof p.message === "string" && /skills context budget/i.test(p.message)) {
      this.skillDescriptionsTruncated = true;
      return;
    }
    if (!this.threadId || (p.threadId !== this.threadId && !this.events.child(String(p.threadId)))) {
      if (message.id !== undefined) this.rpc.reject(message.id, "Native thread is not bound"); return;
    }
    if (message.method === "turn/started" && this.submitted && p.threadId === this.threadId) {
      const id = nativeRecord(p.turn).id;
      if (this.turnId && typeof id === "string" && id !== this.turnId) throw new Error("Native turn/started identity mismatch");
      if (typeof id === "string") this.turnId = id;
    }
    if (!this.accepted) {
      if (message.id !== undefined && this.submitted && this.turnId && p.turnId === this.turnId) { this.interactions.receive(message); return; }
      if (this.earlyEvents.length >= 1024) throw new Error("Native pre-acceptance event budget exceeded");
      this.earlyEvents.push(message); return;
    }
    if (p.threadId === this.threadId && p.turnId && p.turnId !== this.turnId) {
      if (message.id !== undefined) this.rpc.reject(message.id, "Native turn mismatch"); return;
    }
    if (message.id !== undefined) { this.interactions.receive(message); return; }
    const child = p.threadId !== this.threadId ? String(p.threadId) : undefined;
    switch (message.method) {
      case "item/started": case "item/completed": this.events.update(p.item as ThreadItem, message.method === "item/completed", child); break;
      case "item/agentMessage/delta": case "item/reasoning/summaryTextDelta": case "item/plan/delta":
        if (typeof p.itemId !== "string" || typeof p.delta !== "string") throw new Error("Invalid native text delta");
        this.events.delta(p.itemId, p.delta, message.method === "item/agentMessage/delta" ? "agent-message" : message.method === "item/plan/delta" ? "plan" : "reasoning", child, p.summaryIndex === undefined ? 0 : Number(p.summaryIndex)); break;
      case "item/reasoning/textDelta": break;
      case "item/commandExecution/outputDelta": if (typeof p.itemId === "string" && typeof p.delta === "string") this.events.delta(p.itemId, p.delta, "command", child); break;
      case "turn/plan/updated": this.events.plan(String(this.turnId), p.plan); break;
      case "item/autoApprovalReview/completed": {
        const review = nativeRecord(p.review);
        this.options.callbacks.onItem({ itemId: `native-review-${String(p.reviewId ?? p.itemId ?? this.turnId)}`, kind: "other", title: "Automatic review",
          detail: this.redact(String(review.rationale ?? review.reason ?? review.status ?? "")), status: review.status === "denied" ? "failed" : "completed" }); break;
      }
      case "turn/completed": {
        if (child) return;
        const turn = nativeRecord(p.turn);
        if (turn.id !== this.turnId) return;
        if (this.steering) await this.steering;
        const status = turn.status;
        if (status !== "completed" && status !== "interrupted" && status !== "failed") throw new Error("Unknown native turn terminal status");
        this.interactions.close();
        if (status === "completed") {
          this.terminals = await this.backgroundTerminals();
          if (this.terminals.length) {
            if (!this.background) throw new Error("Native commands require a Chat background owner");
            for (const terminal of this.terminals) { this.events.backgroundCommand(terminal); this.retainedTerminals.set(terminal.itemId, terminal); }
            await this.background.retain({ threadId: this.threadId!, lastTurnId: this.turnId!, terminals: this.terminals });
            this.backgroundActive = true;
          }
        }
        this.events.finish(status === "failed"); this.done = true;
        const failure = status === "failed" ? nativeFailure(turn.error, value => this.redact(value)) : null;
        this.options.callbacks.onTerminal({ type: status === "completed" ? "done" : status === "interrupted" ? "cancelled" : "error",
          ...this.turnFacts(),
          ...(failure ? { message: failure.message, failureKind: failure.kind, failure: failure.failure,
            ...(failure.kind === "usage-limit" ? { usageLimit: failure.limit } : {}) } : {}) });
        if (this.backgroundActive) { this.rpc.resetBudget(); this.watchBackground(); } else this.rpc.close(); break;
      }
    }
  }

  private fail(cause: unknown) {
    if (this.done) { if (this.backgroundActive) { this.backgroundActive = false; clearInterval(this.backgroundTimer); this.background?.ended(); } return; }
    this.done = true; this.interactions.close(); this.events.finish(true);
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.options.callbacks.onProcessError({ ...nativeFailure(error, value => this.redact(value)), ...this.turnFacts() });
    this.rpc.close(); for (const resolve of this.handoffWaiters) resolve(this.handoff); this.handoffWaiters.clear();
  }

  private turnFacts() { return this.skillDescriptionsTruncated ? { facts: { skillDescriptionsTruncated: true as const } } : {}; }
  private missing(cause: unknown, id: string) { return codexSessionMissing(id, cause); }
  private collectSecrets(value: unknown, sensitive = false) {
    if (typeof value === "string") { if (sensitive && value) this.secrets.add(value); return; }
    if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) this.collectSecrets(item, sensitive || key === "env" || key === "http_headers");
  }
  private redact(value: string) { return [...this.secrets].reduce((text, secret) => text.split(secret).join("[REDACTED]"), value); }
}
