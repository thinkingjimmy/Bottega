/**
 * [INPUT]: Depends on the pinned Convex SDK/socket factory, Zod validation, public registry and main-only session token provider.
 * [OUTPUT]: Provides bounded socket-first calls, JWT-refreshing HTTP fallback and authenticated subscriptions that are re-attached to each new socket within one account/device scope (a scope change fails them), a socket token retry on a 1/2/5/15/30/60 s ladder that networkOnline cuts short and invalid-session ends (T20-2), a separately authenticated bulk socket with the same token retry and bounded readiness, one call at a time, closed with the primary, a queued one settling unsent once close() moves the generation (T20-4, review 0929 R05), per-command hop traces with queue and execution time (traceCommand/commandTrace, T20-5), a server-time offset from HTTP Date headers (T20-9b), including the account's computer list, the account-config revision, per-computer Memory control intent and the Agent-configuration directory.
 * [POS]: apps/desktop/electron/main/cloud/runtime/transport; Main cloud transport; private generated code and credentials never cross IPC.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { ServerTimeOffset } from "@ai-chat/chat-ui/server-time";
import { makeFunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { ZodError } from "zod";
import { assertHandshake, cloudFunctions, protocolHeader, type AccountAccess, type CloudBuildConfig,
  type CloudFunctionArgs, type CloudFunctionName, type CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { AuthTransportError } from "../../account/session-client";
import { SocketAuthentication, tokenRetryDelay } from "./socket-auth";
import type { ChatQueryName } from "@ai-chat/chat-ui/read-source";
type Names<K extends "query" | "mutation"> = { [N in CloudFunctionName]: (typeof cloudFunctions)[N]["kind"] extends K ? N : never }[CloudFunctionName];
type RemoteQueryName = "remote/workspace:inbox" | "remote/queue:awaiting" | "config:get" | "remote/commands:inbox" | "remote/chats:preparations" | "remote/chats:reservations" | "remote/capabilities:targets" | "remote/commands:receipts" | "remote/commands:page";
class JwtRejected extends Error {}
function reference<N extends CloudFunctionName>(name: N) {
  return makeFunctionReference<(typeof cloudFunctions)[N]["kind"], CloudFunctionArgs<N>, CloudFunctionResult<N>>(name);
}
export interface AccountTransport {
  handshake(): Promise<void>;
  query<N extends Names<"query">>(name: N, input: CloudFunctionArgs<N>): Promise<CloudFunctionResult<N>>;
  mutate<N extends Names<"mutation">>(name: N, input: CloudFunctionArgs<N>): Promise<CloudFunctionResult<N>>;
  watch(changed: (access: AccountAccess) => void, connected: (value: boolean) => void, failure: (error: unknown) => void): void;
  watchSkillsCatalog?(input: CloudFunctionArgs<"skills/sync:catalog">, changed: (value: CloudFunctionResult<"skills/sync:catalog">) => void,
    failure: (error: unknown) => void): () => void;
  watchComputers?(input: CloudFunctionArgs<"devices:computers">, changed: (value: CloudFunctionResult<"devices:computers">) => void,
    failure: (error: unknown) => void): () => void;
  watchAccountConfig?(input: CloudFunctionArgs<"accountConfig/sync:revision">, changed: (value: CloudFunctionResult<"accountConfig/sync:revision">) => void,
    failure: (error: unknown) => void): () => void;
  watchAgentConfigDirectory?(input: CloudFunctionArgs<"agentConfigs/sync:directory">, changed: (value: CloudFunctionResult<"agentConfigs/sync:directory">) => void,
    failure: (error: unknown) => void): () => void;
  watchResourceInbox?(input: CloudFunctionArgs<"resources/commands:inbox">, changed: (value: CloudFunctionResult<"resources/commands:inbox">) => void,
    failure: (error: unknown) => void): () => void;
  watchMemoryControl?(input: CloudFunctionArgs<"remote/memory/control:get">, changed: (value: CloudFunctionResult<"remote/memory/control:get">) => void,
    failure: (error: unknown) => void): () => void;
  /** The account and device the live subscriptions belong to; a change ends them all (T20-1b). */
  bindScope?(key: string | null): void;
  /** T20-9b: the server-clock offset its HTTP responses measured, or null before any trusted sample. */
  serverTimeOffset?(): number | null;
  /** T20-2: the network came back; a token retry waiting on its ladder goes now. */
  networkOnline?(): void;
  /** T20-2: no socket, or an unauthenticated one: only a reconnect helps. */
  needsReconnect?(): boolean;
  /** The independently owned upload lane is recovering, even when control remains available. */
  uploadRecovering?(): boolean;
  close(): void;
}
/** TASK-20 T20-2: a socket token fetch that failed transiently retries on this ladder (±20 %) instead of closing the socket. */
/* TASK-20 T20-4 (R-08, client transport, no wire): Convex orders mutations per client, so these large, slow calls get their
   own socket and run one at a time; the primary socket carries only control (commands, claims, reports, time, heartbeats,
   watches). Initial sync's lanes share this bound because they all stage through it. */
const BULK_CALLS = new Set(["chats/body/api:stageBlocks", "blobs/api:begin", "blobs/api:status", "blobs/api:finalize"]);
/* TASK-20 T20-5: per-command hop traces. A remote command runs inside traceCommand, and every call it makes through this
   transport is one hop, with the time it waited in its lane's queue (startedAt → sentAt) kept apart from the time it took once
   sent (sentAt → endedAt). Bounded: the newest 50 commands, 32 hops each. */
export type TraceHop = { hop: string; lane: "control" | "bulk" | "http"; startedAt: number; sentAt: number; endedAt: number; failed: boolean };
const TRACE_COMMANDS = 50, TRACE_HOPS = 32;
const traces = new Map<string, TraceHop[]>();
const traceScope = new AsyncLocalStorage<TraceHop[]>();
export function traceCommand<T>(commandId: string, run: () => Promise<T>): Promise<T> {
  let hops = traces.get(commandId);
  if (!hops) { hops = []; traces.set(commandId, hops); while (traces.size > TRACE_COMMANDS) traces.delete(traces.keys().next().value!); }
  const trace = hops;
  return traceScope.run(trace, run).finally(() => { if (process.env.BOTTEGA_SYNC_DIAGNOSTICS === "1") console.debug("[remote-trace]", commandId, trace); });
}
export const commandTrace = (commandId: string): TraceHop[] | undefined => traces.get(commandId)?.map(hop => ({ ...hop }));
function traced<T>(name: string, lane: TraceHop["lane"], run: (sent: () => void) => Promise<T>): Promise<T> {
  const hops = traceScope.getStore(), startedAt = Date.now();
  if (!hops) return run(() => {});
  let sentAt = startedAt;
  const record = (failed: boolean) => { if (hops.length < TRACE_HOPS) hops.push({ hop: name, lane, startedAt, sentAt, endedAt: Date.now(), failed }); };
  return run(() => { sentAt = Date.now(); }).then(value => { record(false); return value; }, error => { record(true); throw error; });
}
type TransportTiming = { wait(milliseconds: number, signal: AbortSignal): Promise<void>; random(): number };
const realTiming: TransportTiming = { wait: (milliseconds, signal) => delay(milliseconds, undefined, { signal }).catch(() => undefined), random: Math.random };
type LiveSubscription = { name: string; args: Record<string, Value>; changed(value: unknown): void; failed(error: unknown): void;
  release: (() => void) | null; attachment: object | null };
export class CloudTransport implements AccountTransport {
  private verifiedConfig: CloudFunctionResult<"config:get"> | null = null;
  configuration() { return this.verifiedConfig; }
  private generation = 0;
  private socket: ConvexClient | null = null;
  private authenticated = false;
  private connected = false;
  private pending = new Map<() => void, ConvexClient>();
  private live = new Set<LiveSubscription>();
  private scopeKey: string | null = null;
  private primaryAuth: SocketAuthentication | null = null;
  private primaryFailure: ((error: unknown) => void) | null = null;
  private bulkAuth: SocketAuthentication | null = null;
  private bulkUnready = false;
  private bulk: ConvexClient | null = null;
  private bulkTail: Promise<unknown> = Promise.resolve();
  constructor(private readonly config: CloudBuildConfig, private readonly token: (force?: boolean) => Promise<string | null>,
    private readonly request: typeof fetch = fetch,
    private readonly createSocket = () => new ConvexClient(config.convexUrl, { logger: false }),
    private readonly timing: TransportTiming = realTiming) {}
  static tokenRetryDelay(attempt: number, random: number) {
    return tokenRetryDelay(attempt, random);
  }
  /** The network came back (or the machine woke): a token retry waiting on the ladder goes now. */
  networkOnline() { this.primaryAuth?.networkOnline(); this.bulkAuth?.networkOnline(); }
  /** No socket, or one that is not authenticated: only a reconnect helps, not the SDK's own retry. */
  needsReconnect() { return !this.socket || !this.authenticated; }
  uploadRecovering() { return this.bulkUnready; }
  /* T20-9b: every HTTP response main reads (the handshake at least) is a server-time sample for account-level presence. */
  private readonly serverTime = new ServerTimeOffset();
  serverTimeOffset() { return this.serverTime.offset(); }
  private fetch: typeof fetch = async (url, options) => {
    try {
      const sentAt = Date.now();
      const response = await this.request(url, { ...options, redirect: "error", credentials: "omit",
        signal: AbortSignal.timeout(15_000) });
      this.serverTime.record(response.headers.get("date"), sentAt, Date.now());
      if (response.status === 401) throw new JwtRejected();
      if ((response.status >= 500 && response.status !== 560) || [408, 429].includes(response.status)) throw new AuthTransportError("temporarily-offline");
      return response;
    } catch (error) { throw error instanceof AuthTransportError || error instanceof JwtRejected ? error : new AuthTransportError("temporarily-offline"); }
  };
  async handshake() {
    const generation = this.generation;
    const client = new ConvexHttpClient(this.config.convexUrl, { fetch: this.fetch, logger: false });
    const result = await this.fenced(generation, () => client.query(reference("config:get"), protocolHeader(this.config))
      .catch(error => { throw error instanceof JwtRejected ? new AuthTransportError("temporarily-offline") : error; }));
    if (generation !== this.generation) throw new Error("cloud-request-superseded");
    try { this.verifiedConfig = assertHandshake(this.config, result); }
    catch (error) { throw error instanceof ZodError ? new Error("client-outdated") : error; }
  }
  private async client(force = false) {
    const generation = this.generation;
    const token = await this.token(force);
    if (generation !== this.generation) throw new Error("cloud-request-superseded");
    if (!token) throw new AuthTransportError("invalid-session");
    return new ConvexHttpClient(this.config.convexUrl, { auth: token, fetch: this.fetch, logger: false });
  }
  private async call(kind: "query" | "mutation", name: string, args: Record<string, Value>) {
    const query = makeFunctionReference<"query", Record<string, Value>, unknown>(name);
    const mutation = makeFunctionReference<"mutation", Record<string, Value>, unknown>(name);
    if (this.socket && this.authenticated && this.connected) {
      if (BULK_CALLS.has(name)) return traced(name, "bulk", sent => {
        /* A queued call belongs to the generation that queued it: once close() moved on, it settles here, before a bulk socket
           of the new generation could open for it and carry its old arguments. */
        const generation = this.generation;
        const run = this.bulkTail.catch(() => undefined).then(async () => {
          if (generation !== this.generation) throw new Error("cloud-request-superseded");
          const socket = await this.bulkSocket();
          if (generation !== this.generation) throw new Error("cloud-request-superseded");
          sent(); return this.socketCall(socket, kind, name, args);
        });
        this.bulkTail = run; return run;
      });
      const socket = this.socket;
      return traced(name, "control", sent => { sent(); return this.socketCall(socket, kind, name, args); });
    }
    return traced(name, "http", sent => { sent(); return this.httpCall(kind, name, args, query, mutation); });
  }
  private async httpCall(kind: "query" | "mutation", name: string, args: Record<string, Value>,
    query: ReturnType<typeof makeFunctionReference<"query", Record<string, Value>, unknown>>, mutation: ReturnType<typeof makeFunctionReference<"mutation", Record<string, Value>, unknown>>) {
    const generation = this.generation;
    for (const force of [false, true]) {
      const client = await this.client(force);
      if (generation !== this.generation) throw new Error("cloud-request-superseded");
      try { return await (kind === "query" ? client.query(query, args) : client.mutation(mutation, args)); }
      catch (error) {
        if (generation !== this.generation) throw new Error("cloud-request-superseded");
        if (!(error instanceof JwtRejected)) throw error;
        // A rejected JWT does not revoke the original bearer. Only the token endpoint can prove that.
        if (force) throw new AuthTransportError("temporarily-offline");
      }
    }
    throw new AuthTransportError("temporarily-offline");
  }
  /** Each bulk owner must authenticate before accepting work. Failed owners are never cached for reuse. */
  private async bulkSocket() {
    if (!this.bulk) {
      const client = this.createSocket(), generation = this.generation;
      this.bulk = client; this.bulkUnready = true;
      const current = () => generation === this.generation && this.bulk === client;
      const auth = new SocketAuthentication(this.token, this.timing, ready => { if (current()) this.bulkUnready = !ready; }, error => {
        if (!current()) return;
        this.bulkUnready = true;
        if (error instanceof AuthTransportError && error.kind === "invalid-session") { this.primaryFailure?.(error); return; }
        this.closeBulk();
      }, "bulk-auth");
      this.bulkAuth = auth; client.setAuth(auth.fetch, auth.accept);
    }
    const client = this.bulk, auth = this.bulkAuth;
    if (!client || !auth) throw new AuthTransportError("temporarily-offline");
    await auth.waitUntilReady();
    if (client !== this.bulk || !auth.ready()) throw new Error("cloud-request-superseded");
    return client;
  }
  private closeBulk() {
    const client = this.bulk; this.bulk = null;
    this.bulkAuth?.close(); this.bulkAuth = null;
    for (const [cancel, owner] of this.pending) if (owner === client) cancel();
    if (client) void client.close();
  }
  private socketCall(socket: ConvexClient, kind: "query" | "mutation", name: string, args: Record<string, Value>) {
    const query = makeFunctionReference<"query", Record<string, Value>, unknown>(name);
    const mutation = makeFunctionReference<"mutation", Record<string, Value>, unknown>(name);
    return new Promise<unknown>((resolve, reject) => {
      const cancel = () => { cleanup(); reject(new Error("cloud-request-superseded")); };
      // Socket mutations share the SDK's ordered queue per client, which is why bulk calls have their own socket.
      const timeout = setTimeout(() => { cleanup(); reject(new AuthTransportError("temporarily-offline")); }, kind === "mutation" ? 120_000 : 15_000);
      const cleanup = () => { clearTimeout(timeout); this.pending.delete(cancel); };
      this.pending.set(cancel, socket);
      try {
        const result = kind === "query" ? socket.query(query, args) : socket.mutation(mutation, args);
        void result.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      } catch (error) { cleanup(); reject(error); }
    });
  }
  async query<N extends Names<"query">>(name: N, input: CloudFunctionArgs<N>): Promise<CloudFunctionResult<N>> {
    const generation = this.generation;
    if (process.env.BOTTEGA_SYNC_DIAGNOSTICS === "1") console.debug("[cloud-request]", name);
    const args: Record<string, Value> = cloudFunctions[name].args.parse(input);
    const result = await this.fenced(generation, () => this.call("query", name, args));
    if (generation !== this.generation) throw new Error("cloud-request-superseded");
    return cloudFunctions[name].result.parse(result) as CloudFunctionResult<N>;
  }
  async mutate<N extends Names<"mutation">>(name: N, input: CloudFunctionArgs<N>): Promise<CloudFunctionResult<N>> {
    const generation = this.generation;
    if (process.env.BOTTEGA_SYNC_DIAGNOSTICS === "1") console.debug("[cloud-request]", name);
    const args: Record<string, Value> = cloudFunctions[name].args.parse(input);
    const result = await this.fenced(generation, () => this.call("mutation", name, args));
    if (generation !== this.generation) throw new Error("cloud-request-superseded");
    return cloudFunctions[name].result.parse(result) as CloudFunctionResult<N>;
  }
  private async fenced<T>(generation: number, operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { if (generation !== this.generation) throw new Error("cloud-request-superseded"); throw error; }
  }
  /* A parsed subscription: a value that fails its contract is reported through failure, like a transport error. */
  private parsed<N extends CloudFunctionName>(name: N, input: CloudFunctionArgs<N>, changed: (value: CloudFunctionResult<N>) => void, failure: (error: unknown) => void) {
    this.requireSocket(); const contract = cloudFunctions[name];
    return this.subscribe(name, contract.args.parse(input), value => { try { changed(contract.result.parse(value) as CloudFunctionResult<N>); } catch (error) { failure(error); } }, failure);
  }
  watchSkillsCatalog(input: CloudFunctionArgs<"skills/sync:catalog">, changed: (value: CloudFunctionResult<"skills/sync:catalog">) => void, failure: (error: unknown) => void) {
    return this.parsed("skills/sync:catalog", input, changed, failure);
  }
  watchComputers(input: CloudFunctionArgs<"devices:computers">, changed: (value: CloudFunctionResult<"devices:computers">) => void, failure: (error: unknown) => void) {
    return this.parsed("devices:computers", input, changed, failure);
  }
  /* Only the revision integer is subscribed; the coordinator reads the ciphertext head when the revision moves. */
  watchAccountConfig(input: CloudFunctionArgs<"accountConfig/sync:revision">, changed: (value: CloudFunctionResult<"accountConfig/sync:revision">) => void, failure: (error: unknown) => void) {
    return this.parsed("accountConfig/sync:revision", input, changed, failure);
  }
  /** One small row per account: a change costs one read, and the heads page is fetched only when its revision moved. */
  watchAgentConfigDirectory(input: CloudFunctionArgs<"agentConfigs/sync:directory">, changed: (value: CloudFunctionResult<"agentConfigs/sync:directory">) => void, failure: (error: unknown) => void) {
    return this.parsed("agentConfigs/sync:directory", input, changed, failure);
  }
  /** This desktop's pending and accepted resource commands (P13 R-24): a phone's confirm reaches it as soon as it is sent. */
  watchResourceInbox(input: CloudFunctionArgs<"resources/commands:inbox">, changed: (value: CloudFunctionResult<"resources/commands:inbox">) => void, failure: (error: unknown) => void) {
    return this.parsed("resources/commands:inbox", input, changed, failure);
  }
  watchMemoryControl(input: CloudFunctionArgs<"remote/memory/control:get">, changed: (value: CloudFunctionResult<"remote/memory/control:get">) => void, failure: (error: unknown) => void) {
    return this.parsed("remote/memory/control:get", input, changed, failure);
  }
  watchPluginSurface(input: CloudFunctionArgs<"surfaces/plugins:head">, changed: (value: CloudFunctionResult<"surfaces/plugins:head">) => void, failure: (error: unknown) => void) {
    return this.parsed("surfaces/plugins:head", input, changed, failure);
  }
  watchBase(input: CloudFunctionArgs<"bases/api:readSnapshot">, changed: () => void, failure: (error: unknown) => void) {
    this.requireSocket(); const args = cloudFunctions["bases/api:readSnapshot"].args.parse(input);
    const { operationIds: _operationIds, ...head } = args;
    const releaseHead = this.subscribe("bases/pages:head", head, () => changed(), failure);
    const releaseCandidates = this.subscribe("bases/conflicts:head", head, () => changed(), failure);
    return () => { releaseHead(); releaseCandidates(); };
  }
  watchProject(input: CloudFunctionArgs<"projects/sync:head">, changed: () => void, failure: (error: unknown) => void) {
    this.requireSocket();
    return this.subscribe("projects/sync:head", cloudFunctions["projects/sync:head"].args.parse(input), () => changed(), failure);
  }
  watchChatCatalog(input: CloudFunctionArgs<"chats/metadata:catalog">, changed: () => void, failure: (error: unknown) => void) {
    this.requireSocket();
    return this.subscribe("chats/metadata:catalog", cloudFunctions["chats/metadata:catalog"].args.parse(input), () => changed(), failure);
  }
  watchChatRead<N extends ChatQueryName>(name: N, input: CloudFunctionArgs<N>, changed: (value: CloudFunctionResult<N>) => void, failure: (error: unknown) => void) {
    this.requireSocket(); const contract = cloudFunctions[name];
    return this.subscribe(name, contract.args.parse(input), value => changed(contract.result.parse(value) as CloudFunctionResult<N>), failure);
  }
  watchRemote<N extends RemoteQueryName>(name: N, input: CloudFunctionArgs<N>, changed: (value: CloudFunctionResult<N>) => void, failure: (error: unknown) => void) {
    return this.parsed(name, input, changed, failure);
  }
  /**
   * TASK-20 T20-1b: every subscription outlives its socket. close() releases it from the old socket and the next watch()
   * re-attaches it, so a wake or a token failure never leaves a handle silently dead; the new socket's first full result
   * arrives on the same handle, which Convex query consumers already treat as an ordinary update. A new account or device
   * scope (bindScope) ends every handle through its failure instead; only the handle's own unsubscribe removes it.
   */
  private requireSocket() { if (!this.socket) throw new Error("cloud-connection-unavailable"); }
  private subscribe(name: string, args: Record<string, Value>, changed: (value: unknown) => void, failed: (error: unknown) => void) {
    this.requireSocket();
    const entry: LiveSubscription = { name, args, changed, failed, release: null, attachment: null };
    this.live.add(entry); this.attach(entry);
    return () => { if (this.live.delete(entry)) this.detach(entry); };
  }
  private attach(entry: LiveSubscription) {
    const attachment = {}; entry.attachment = attachment;
    entry.release = this.socket!.onUpdate(makeFunctionReference<"query", Record<string, Value>, unknown>(entry.name), entry.args,
      value => { if (entry.attachment === attachment) entry.changed(value); },
      error => { if (entry.attachment === attachment) entry.failed(error); });
  }
  private detach(entry: LiveSubscription) { entry.attachment = null; const release = entry.release; entry.release = null; release?.(); }
  bindScope(key: string | null) {
    if (key === this.scopeKey) return;
    this.scopeKey = key;
    const ended = [...this.live]; this.live.clear();
    for (const entry of ended) { this.detach(entry); entry.failed(new Error("cloud-account-changed")); }
  }
  watch(changed: (access: AccountAccess) => void, connected: (value: boolean) => void, failure: (error: unknown) => void) {
    if (this.socket) return;
    const generation = this.generation;
    const current = () => generation === this.generation;
    const failed = (error: unknown) => { if (current()) failure(error); };
    const authenticationFailed = (error: unknown) => {
      if (!current()) return;
      this.authenticated = false;
      // Returning null tells Convex to continue anonymously. Fence that socket before
      // its signed-out query result can discard a still-valid persistent bearer.
      this.close(); failure(error);
    };
    let previous: boolean | undefined, reported: boolean | undefined;
    const reportConnection = () => {
      if (!current() || previous === undefined) return;
      const ready = previous && !this.primaryAuth?.isRetrying();
      if (ready !== reported) { reported = ready; connected(ready); }
    };
    const client = this.createSocket(); this.socket = client;
    this.primaryFailure = authenticationFailed;
    for (const entry of this.live) this.attach(entry);
    const auth = new SocketAuthentication(this.token, this.timing, ready => {
      if (!current()) return;
      this.authenticated = ready; reportConnection();
    }, authenticationFailed);
    this.primaryAuth = auth; client.setAuth(auth.fetch, auth.accept);
    client.onUpdate(reference("account:getAccessState"), protocolHeader(this.config), value => {
      if (!current() || !this.authenticated) return;
      try { changed(cloudFunctions["account:getAccessState"].result.parse(value)); }
      catch (error) { failed(error); }
    }, failed);
    client.subscribeToConnectionState(state => {
      if (current() && state.isWebSocketConnected !== previous) { previous = state.isWebSocketConnected; this.connected = previous; reportConnection(); }
    });
  }
  close() {
    this.verifiedConfig = null;
    this.generation++; this.authenticated = false; this.connected = false;
    for (const cancel of this.pending.keys()) cancel();
    this.primaryAuth?.close(); this.primaryAuth = null; this.primaryFailure = null;
    this.closeBulk(); this.bulkUnready = false; this.bulkTail = Promise.resolve();
    for (const entry of this.live) this.detach(entry);
    const client = this.socket; this.socket = null; if (client) void client.close();
  }
}
