/**
 * [INPUT]: Uses HostApi, pinned protocol declarations, lazily loaded ACP/native drivers and ordered process/event ports and live names-only MCP consent queries.
 * [OUTPUT]: Exports activate for protocol-specific readiness, native catalogs, turns, retained background Stop/results, headless parsing and quota.
 * [POS]: Provider utility-process dispatcher; main alone freezes launch policy, grants tool authority and owns custody.
 */
import type { HostApi } from "../../host/entry";
import type { AgentTurn, AgentTurnCallbacks, BackendTurnOptions } from "../../backends/contracts/types";
import type { McpServer } from "@agentclientprotocol/sdk";
import { bridgeHeadlessParser, bridgeTurnValues, bridgeProtocol } from "./turn-values";
import { HeadlessOutputReader } from "../../backends/jobs/output";
import { SubagentRegistry } from "../../../../shared/tools/subagent-registry";
import type { SessionRef } from "../../../../shared/ipc/agent/agent-ipc";
import { NOTIFY_CALLBACKS, PROVIDER_TURN_OPERATIONS, type BridgeHeadlessOutcome, type BridgeHeadlessStart, type BridgeTurnEvent,
  type BridgeTurnRequest, type BridgeTurnStart } from "../host/protocol";
import { bridgeProcessHost, killProcessHost } from "./process-host";

import type { CodexNativeTurn } from "../codex/native/session/turn";
import type { NativeTurnConfig } from "../codex/native/policy/parameters";

const json = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

/** One ordered lane per turn: nothing reaches main out of the order the turn produced it (C5). */
class Outbox {
  private chain: Promise<unknown> = Promise.resolve();
  private batch: BridgeTurnEvent[] = [];
  private scheduled = false;
  broken: Error | null = null;
  constructor(private readonly api: HostApi, private readonly ref: string, private readonly turnKey: string) {}

  event(event: BridgeTurnEvent) {
    this.batch.push(json(event));
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.chain = this.chain.then(() => this.flush()); });
  }

  request(request: BridgeTurnRequest): Promise<unknown> {
    const next = this.chain.then(() => this.flush()).then(() =>
      this.api.call(PROVIDER_TURN_OPERATIONS.request, { turnKey: this.turnKey, request: json(request) }, [this.ref]));
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Settles once everything queued so far has been delivered. */
  drain() { this.chain = this.chain.then(() => this.flush()); return this.chain; }

  private async flush() {
    const events = this.batch.splice(0);
    if (!events.length) return;
    try { await this.api.call(PROVIDER_TURN_OPERATIONS.events, { turnKey: this.turnKey, events }, [this.ref]); }
    catch (cause) { this.broken ??= cause as Error; }
  }
}

/** The MCP tokens this turn's sessions were given, only to keep them out of the wire lines it forwards; gone with the turn. */
type Secrets = Set<string>;
type Live = { turn: AgentTurn; outbox: Outbox; host: ReturnType<typeof bridgeProcessHost>; abort: AbortController; secrets: Secrets; native?: CodexNativeTurn };

const withoutSecrets = (line: string, secrets: Secrets) => [...secrets].reduce((text, secret) => text.split(secret).join("[REDACTED]"), line);

export function activate(api: HostApi) {
  const turns = new Map<string, Live>();
  let nativeHalf: Promise<ReturnType<typeof import("../codex/native/session/control").nativeControl>> | undefined;
  const native = () => nativeHalf ??= import("../codex/native/session/control").then(module => module.nativeControl(api));
  let quotaHalf: Promise<ReturnType<typeof import("./quota").quotaBridge>> | undefined;
  const quota = () => quotaHalf ??= import("./quota").then(module => module.quotaBridge(api));
  const live = (turnKey: string) => {
    const entry = turns.get(turnKey);
    if (!entry) throw new Error(`no live turn ${turnKey}`);
    return entry;
  };

  const optionsFor = (start: BridgeTurnStart, outbox: Outbox, host: Live["host"], secrets: Secrets): BackendTurnOptions => {
    const callbacks = Object.fromEntries(NOTIFY_CALLBACKS.map(name => [name, (...args: unknown[]) => outbox.event({ k: "cb", name, args })]));
    const registry = new SubagentRegistry(start.subagents);
    const subagents = new Proxy(registry, { get(target, property, receiver) {
      if (property === "upsertMeta") return (input: Parameters<SubagentRegistry["upsertMeta"]>[0]) => {
        outbox.event({ k: "subagent-meta", input }); return target.upsertMeta(input);
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    return {
      chatIncarnationId: start.chatIncarnationId,
      payload: start.payload,
      input: { input: start.input, commit() {}, rollback() {}, release() {} } as unknown as BackendTurnOptions["input"],
      callbacks: { ...callbacks, onThread: (session: SessionRef, previous?: SessionRef) => outbox.request({ k: "thread", session, ...(previous ? { previous } : {}) }) as Promise<void> } as unknown as AgentTurnCallbacks,
      runtime: start.runtime,
      workspace: start.workspace,
      processHost: host,
      subagents,
      ...(start.trace ? { trace: { recordWire: (direction: string, line: string) => outbox.event({ k: "trace-wire", direction, line: withoutSecrets(line, secrets) }),
        recordMapped: (event: unknown) => outbox.event({ k: "trace-mapped", event }) } as unknown as BackendTurnOptions["trace"] } : {}),
      ...(start.builtinMcp ? { builtinMcp: { server: start.builtinMcp.server, lease: {} as never,
        waitReady: () => outbox.request({ k: "builtin-ready" }) as Promise<void> } as unknown as BackendTurnOptions["builtinMcp"] } : {}),
      ...(start.thirdPartyMcpPlan ? { thirdPartyMcpPlan: start.thirdPartyMcpPlan as BackendTurnOptions["thirdPartyMcpPlan"] } : {}),
      ...(start.serverFactBinding ? { serverFactBinding: start.serverFactBinding as BackendTurnOptions["serverFactBinding"] } : {}),
      ...(start.artifactDirectory ? { artifactDirectory: start.artifactDirectory } : {}),
      ...(start.productContext ? { productContext: start.productContext } : {}),
      /* Consuming the contribution is main's lease: the prompt asks main and waits for the validation (G9). */
      ...(start.sensitive ? { sensitiveContribution: { ...start.sensitive,
        consume: () => outbox.request({ k: "contribution-consume" }) as Promise<ReturnType<NonNullable<BackendTurnOptions["sensitiveContribution"]>["consume"]>> } } : {}),
      ...(start.hooks.sessionPrompt ? { onSessionPrompt: (sessionId: string, texts: string[]) =>
        outbox.request({ k: "session-prompt", sessionId, texts }) as Promise<void> } : {}),
      ...(start.recovery ? { sessionRecovery: { candidate: start.recovery.candidate,
        complete: (outcome: "resumed" | "replayed") => outbox.request({ k: "recovery-complete", outcome }) as Promise<void> } } : {}),
      /* validate() is awaited; the synchronous current() checks are repeated by main inside the next awaited request. */
      ...(start.hooks.authority ? { trustedAuthority: { validate: () => outbox.request({ k: "authority" }) as Promise<void>, current: () => undefined } } : {}),
    } as BackendTurnOptions;
  };

  return {
    async "native.models"({ turnKey, backend }: { turnKey: string; backend: string }, refs: string[]) {
      if (bridgeProtocol(backend) !== "codex-app-server") throw new Error("Model query requires the pinned native driver");
      return (await native()).models(turnKey, refs);
    },
    "native.models.cancel": async ({ turnKey }: { turnKey: string }) => { (await native()).cancel(turnKey); return null; },
    /** Readiness (step 1): initialize and session/list on a process main started through the guardian. */
    async readiness(params: unknown, refs: string[]) {
      /* The Provider being proven selects the initialize capability policy; one this bridge cannot run is refused. */
      const backend = (params as { backend?: string } | null)?.backend ?? "";
      const protocol = bridgeProtocol(backend);
      const host = bridgeProcessHost(api, refs[0]!);
      if (protocol === "codex-app-server") return (await native()).readiness(refs);
      await bridgeTurnValues(backend);
      const [{ AcpConnection }, { AcpStartupTracker }] = await Promise.all([import("./acp/connection/acp-connection"), import("../../backends/acp/startup/budget")]);
      const connection = AcpConnection.spawn({ command: "sealed-plan", args: [], cwd: "/", env: {} }, host,
        { backend: backend as never, cleanProcessGroup: killProcessHost(host) });
      try {
        await connection.handshake(new AcpStartupTracker(connection.evidence.waitForExit()));
        const listed = await connection.request<{ sessions?: unknown[] }>("session/list", {});
        return { ok: true, pid: connection.pid ?? null, sessions: Array.isArray(listed?.sessions) ? listed.sessions.length : 0,
          steering: connection.supportsSteering };
      } finally {
        await connection.close("readiness");
      }
    },

    async "turn.start"(params: unknown, refs: string[]) {
      const start = params as BridgeTurnStart;
      const protocol = bridgeProtocol(start.payload.turnOptions.backend);
      if (protocol !== start.protocol) throw new Error("Sealed turn plan and pinned protocol driver do not match");
      const values = protocol === "acp" ? await bridgeTurnValues(start.payload.turnOptions.backend) : null;
      const outbox = new Outbox(api, refs[0]!, start.turnKey);
      const host = bridgeProcessHost(api, refs[0]!, protocol === "codex-app-server"), secrets: Secrets = new Set();
      /* acp MCP transport: the servers (tokens included) are asked of main at each session creation and never kept (D2 1). */
      const acpServers = values?.builtinMcpTransport !== "backend-config" || values?.thirdPartyMcpTransport !== "backend-config";
      const resolveMcpServers = async () => {
        const servers = await outbox.request({ k: "mcp-servers" }) as McpServer[];
        for (const server of servers) for (const { value } of "env" in server ? server.env : "headers" in server ? server.headers : []) if (value) secrets.add(value);
        return servers;
      };
      const options = optionsFor(start, outbox, host, secrets);
      const Acp = protocol === "acp" ? (await import("./acp/acp-turn")).AcpTurn : null;
      const NativeTurn = protocol === "codex-app-server" ? (await import("../codex/native/session/turn")).CodexNativeTurn : null;
      const turn: AgentTurn = NativeTurn
        ? new NativeTurn(options, host, async () => {
          const config = await outbox.request({ k: "native-config" }) as NativeTurnConfig;
          return config;
        }, {
          retain: input => outbox.request({ k: "native-background", ...input }).then(() => undefined),
          result: result => outbox.request({ k: "native-background-result", result }).then(() => undefined),
          update: (terminals, output) => outbox.event({ k: "native-background-update", terminals, output }),
          ended: () => outbox.event({ k: "native-background-ended" }),
        }, (serverName, toolName) => outbox.request({ k: "native-mcp-consent", serverName, toolName }).then(value => value === true, () => false))
        : new Acp!(options,
        { ...values!, command: "sealed-plan", args: [], env: {}, ...(acpServers ? { resolveMcpServers } : {}),
          /* Main's fence, carried unchanged: the bridge never builds a sandbox or a launch (D1, P2). */
          ...(start.sessionMeta ? { sessionMeta: () => start.sessionMeta! } : {}) }, host);
      const entry: Live = { turn, outbox, host, abort: new AbortController(), secrets, ...(NativeTurn ? { native: turn as CodexNativeTurn } : {}) };
      turns.set(start.turnKey, entry);
      void host.delivered.then(() => outbox.event({ k: "process", pid: turn.pid ?? null, steering: Boolean(turn.steeringSupported) }), () => undefined);
      try { return await turn.start(entry.abort.signal); }
      finally { await outbox.drain(); }
    },
    /* A headless job (TASK-11 D8): main sealed the launch and keeps admission, fence and release; the bridge launches that plan,
       feeds stdin when main says the process is recorded, and reads the output with the shared reader and the Provider's parser. */
    async "headless.run"(params: unknown, refs: string[]): Promise<BridgeHeadlessOutcome> {
      const start = params as BridgeHeadlessStart;
      const parse = await bridgeHeadlessParser(start.backend);
      const outbox = new Outbox(api, refs[0]!, start.turnKey);
      const reader = new HeadlessOutputReader((line, state) => parse(line, state, start.wantsJson), event => outbox.event({ k: "headless-event", event }));
      const host = bridgeProcessHost(api, refs[0]!);
      const child = host.launch({ command: "sealed-plan", args: [], cwd: "/", env: {} } as never);
      let spawnError: string | null = null;
      const closed = new Promise<{ code: number | null; signal: string | null }>(resolve => {
        child.once("error", cause => { spawnError = (cause as Error).message; });
        child.once("close", (code: number | null, signal: string | null) => resolve({ code, signal }));
      });
      child.stdout.on("data", (chunk: Buffer) => { if (!reader.stdout(chunk)) child.kill(); });
      child.stderr.on("data", (chunk: Buffer) => reader.stderr(chunk));
      /* Only a delivered process asks for its prompt: a refused spawn has no owner for main to record, so the request would never settle. */
      void host.delivered.then(() => outbox.request({ k: "headless-stdin" })).then(stdin => child.stdin.end(String(stdin ?? "")), () => child.stdin.end());
      const { code, signal } = await closed;
      reader.flush();
      await outbox.drain();
      return { state: { text: reader.state.text, ...(reader.state.json === undefined ? {} : { json: reader.state.json }),
        ...(reader.state.error === undefined ? {} : { error: reader.state.error }) },
        limitError: reader.limitError?.message ?? null, stderrTail: reader.stderrTail(), code, signal, spawnError };
    },
    /* Quota reads (TASK-11 D9) load their half on first use, so the entry's static closure stays flat. */
    "quota.open": async (params: { turnKey: string; backend: string }, refs: string[]) => (await quota()).open(params, refs),
    "quota.read": async (params: { turnKey: string }) => (await quota()).read(params),
    "quota.close": async (params: { turnKey: string }) => (await quota()).close(params),
    "turn.abortStart": ({ turnKey }: { turnKey: string }) => { turns.get(turnKey)?.abort.abort(new Error("startup aborted by main")); return null; },
    "turn.respondApproval": async ({ turnKey, approvalId, decision }: { turnKey: string; approvalId: string; decision: never }) => {
      await live(turnKey).turn.respondApproval(approvalId, decision); return null;
    },
    "turn.respondUserInput": ({ turnKey, userInputId, answers }: { turnKey: string; userInputId: string; answers: never }) => {
      live(turnKey).turn.respondUserInput?.(userInputId, answers); return null;
    },
    "turn.steer": ({ turnKey, prompt }: { turnKey: string; prompt: never }) => live(turnKey).turn.steer?.(prompt) ?? { outcome: "unconsumed", reason: "unsupported" },
    "turn.promptHandoff": ({ turnKey }: { turnKey: string }) => live(turnKey).turn.promptHandoff(),
    "turn.interrupt": ({ turnKey }: { turnKey: string }) => { turns.get(turnKey)?.turn.interrupt(); return null; },
    "turn.markStopped": ({ turnKey }: { turnKey: string }) => { turns.get(turnKey)?.turn.markStopped(); return null; },
    "turn.background.stop": async ({ turnKey }: { turnKey: string }) => {
      const turn = live(turnKey).native;
      if (!turn) throw new Error("Turn has no native background owner");
      await turn.stopBackground(); return null;
    },
    "turn.release": async ({ turnKey }: { turnKey: string }) => {
      const entry = turns.get(turnKey);
      turns.delete(turnKey);
      await entry?.outbox.drain();
      entry?.secrets.clear();
      return null;
    },
  };
}
