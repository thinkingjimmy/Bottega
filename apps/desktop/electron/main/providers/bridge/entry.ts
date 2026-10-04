/**
 * [INPUT]: Depends on the utility host's HostApi, the unchanged AcpTurn/AcpConnection, each bridged Provider's launch-independent turn values (turn-values.ts, loaded for the Provider a turn or readiness names), the shared SubagentRegistry, the bridge protocol and the relayed process host
 * [OUTPUT]: Provides activate(api), the Provider bridge (the backend chosen per turn, per readiness proof and per headless run; `headless.run` reads a sealed headless job's output with the shared reader and asks for its prompt only once the process is delivered; for the acp MCP transport a session's servers, tokens included, are asked of main at each creation, never kept, and kept out of forwarded wire lines): `readiness` (initialize + session/list on a custody-mode process), `quota.*` (Codex/Claude quota reads over main's sealed launch, from quota.ts loaded on first use) and `turn.*` (start, respondApproval, respondUserInput, pendingUserInput, steer, interrupt, markStopped, promptHandoff, release)
 * [POS]: Built as `provider-bridge-entry.js` and loaded by the utility host; it runs the AcpTurn, with every main-process dependency replaced by an ordered message: notifications batch per microtask, awaited callbacks wait their turn behind them
 */
import type { HostApi } from "../../host/entry";
import { AcpTurn } from "./acp/acp-turn";
import { AcpConnection } from "./acp/connection/acp-connection";
import { AcpStartupTracker } from "../../backends/acp/startup/budget";
import type { AgentTurnCallbacks, BackendTurnOptions } from "../../backends/types";
import type { McpServer } from "@agentclientprotocol/sdk";
import { bridgeHeadlessParser, bridgeTurnValues } from "./turn-values";
import { HeadlessOutputReader } from "../../backends/jobs/output";
import { SubagentRegistry } from "../../../../shared/tools/subagent-registry";
import type { SessionRef } from "../../../../shared/ipc/agent/agent-ipc";
import { NOTIFY_CALLBACKS, PROVIDER_TURN_OPERATIONS, type BridgeHeadlessOutcome, type BridgeHeadlessStart, type BridgeTurnEvent,
  type BridgeTurnRequest, type BridgeTurnStart } from "../host/protocol";
import { bridgeProcessHost, killProcessHost } from "./process-host";

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
type Live = { turn: AcpTurn; outbox: Outbox; host: ReturnType<typeof bridgeProcessHost>; abort: AbortController; secrets: Secrets };

const withoutSecrets = (line: string, secrets: Secrets) => [...secrets].reduce((text, secret) => text.split(secret).join("[REDACTED]"), line);

export function activate(api: HostApi) {
  const turns = new Map<string, Live>();
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
      payload: start.payload,
      input: { input: start.input, commit() {}, rollback() {}, release() {} } as unknown as BackendTurnOptions["input"],
      callbacks: { ...callbacks, onThread: (session: SessionRef) => outbox.request({ k: "thread", session }) as Promise<void> } as unknown as AgentTurnCallbacks,
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
    /** Readiness (step 1): initialize and session/list on a process main started through the guardian. */
    async readiness(params: unknown, refs: string[]) {
      /* The Provider being proven selects the initialize capability policy; one this bridge cannot run is refused. */
      const backend = (params as { backend?: string } | null)?.backend ?? "";
      await bridgeTurnValues(backend);
      const host = bridgeProcessHost(api, refs[0]!);
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
      const values = await bridgeTurnValues(start.payload.turnOptions.backend);
      const outbox = new Outbox(api, refs[0]!, start.turnKey);
      const host = bridgeProcessHost(api, refs[0]!), secrets: Secrets = new Set();
      /* acp MCP transport: the servers (tokens included) are asked of main at each session creation and never kept (D2 1). */
      const acpServers = values.builtinMcpTransport !== "backend-config" || values.thirdPartyMcpTransport !== "backend-config";
      const resolveMcpServers = async () => {
        const servers = await outbox.request({ k: "mcp-servers" }) as McpServer[];
        for (const server of servers) for (const { value } of "env" in server ? server.env : "headers" in server ? server.headers : []) if (value) secrets.add(value);
        return servers;
      };
      const turn = new AcpTurn(optionsFor(start, outbox, host, secrets),
        { ...values, command: "sealed-plan", args: [], env: {}, ...(acpServers ? { resolveMcpServers } : {}),
          /* Main's fence, carried unchanged: the bridge never builds a sandbox or a launch (D1, P2). */
          ...(start.sessionMeta ? { sessionMeta: () => start.sessionMeta! } : {}) }, host);
      const entry: Live = { turn, outbox, host, abort: new AbortController(), secrets };
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
    "turn.release": async ({ turnKey }: { turnKey: string }) => {
      const entry = turns.get(turnKey);
      turns.delete(turnKey);
      await entry?.outbox.drain();
      entry?.secrets.clear();
      return null;
    },
  };
}
