/**
 * [INPUT]: Depends on the pinned Convex SDK/socket factory, Zod validation, public registry and main-only session token provider.
 * [OUTPUT]: Provides bounded socket-first calls, JWT-refreshing HTTP fallback and fenced authenticated subscriptions.
 * [POS]: Main cloud transport; private generated code and credentials never cross IPC.
 */
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { ZodError } from "zod";
import { assertHandshake, cloudFunctions, protocolHeader, type AccountAccess, type CloudBuildConfig,
  type CloudFunctionArgs, type CloudFunctionName, type CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { AuthTransportError } from "../account/session-client";
import type { ChatQueryName } from "@ai-chat/chat-ui/read-source";
type Names<K extends "query" | "mutation"> = { [N in CloudFunctionName]: (typeof cloudFunctions)[N]["kind"] extends K ? N : never }[CloudFunctionName];
type RemoteQueryName = "remote/workspace:inbox" | "remote/queue:awaiting" | "config:get" | "remote/commands:inbox" | "remote/chats:preparations" | "remote/capabilities:targets" | "remote/commands:get" | "remote/commands:page";
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
  close(): void;
}
export class CloudTransport implements AccountTransport {
  private verifiedConfig: CloudFunctionResult<"config:get"> | null = null;
  configuration() { return this.verifiedConfig; }
  private generation = 0;
  private socket: ConvexClient | null = null;
  private authenticated = false;
  private connected = false;
  private pending = new Set<() => void>();
  constructor(private readonly config: CloudBuildConfig, private readonly token: (force?: boolean) => Promise<string | null>,
    private readonly request: typeof fetch = fetch,
    private readonly createSocket = () => new ConvexClient(config.convexUrl, { logger: false })) {}
  private fetch: typeof fetch = async (url, options) => {
    try {
      const response = await this.request(url, { ...options, redirect: "error", credentials: "omit",
        signal: AbortSignal.timeout(15_000) });
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
      const socket = this.socket;
      return new Promise<unknown>((resolve, reject) => {
        const cancel = () => { cleanup(); reject(new Error("cloud-request-superseded")); };
        // Socket mutations share the SDK's ordered queue, including time behind earlier uploads.
        const timeout = setTimeout(() => { cleanup(); reject(new AuthTransportError("temporarily-offline")); }, kind === "mutation" ? 120_000 : 15_000);
        const cleanup = () => { clearTimeout(timeout); this.pending.delete(cancel); };
        this.pending.add(cancel);
        try {
          const result = kind === "query" ? socket.query(query, args) : socket.mutation(mutation, args);
          void result.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
        } catch (error) { cleanup(); reject(error); }
      });
    }
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
  watchSkillsCatalog(input: CloudFunctionArgs<"skills/sync:catalog">, changed: (value: CloudFunctionResult<"skills/sync:catalog">) => void, failure: (error: unknown) => void) {
    if (!this.socket) throw new Error("cloud-connection-unavailable");
    const generation = this.generation, contract = cloudFunctions["skills/sync:catalog"];
    return this.socket.onUpdate(reference("skills/sync:catalog"), contract.args.parse(input),
      value => { if (generation === this.generation) { try { changed(contract.result.parse(value)); } catch (error) { failure(error); } } },
      error => { if (generation === this.generation) failure(error); });
  }
  watchBase(input: CloudFunctionArgs<"bases/api:readSnapshot">, changed: () => void, failure: (error: unknown) => void) {
    if (!this.socket) throw new Error("cloud-connection-unavailable");
    const generation = this.generation;
    const args = cloudFunctions["bases/api:readSnapshot"].args.parse(input);
    const { operationIds: _operationIds, ...head } = args;
    const releaseHead = this.socket.onUpdate(reference("bases/pages:head"), head,
      () => { if (generation === this.generation) changed(); }, error => { if (generation === this.generation) failure(error); });
    const releaseCandidates = this.socket.onUpdate(reference("bases/conflicts:head"), head,
      () => { if (generation === this.generation) changed(); }, error => { if (generation === this.generation) failure(error); });
    return () => { releaseHead(); releaseCandidates(); };
  }
  watchProject(input: CloudFunctionArgs<"projects/sync:head">, changed: () => void, failure: (error: unknown) => void) {
    if (!this.socket) throw new Error("cloud-connection-unavailable");
    const generation = this.generation, contract = cloudFunctions["projects/sync:head"];
    return this.socket.onUpdate(reference("projects/sync:head"), contract.args.parse(input),
      () => { if (generation === this.generation) changed(); }, error => { if (generation === this.generation) failure(error); });
  }
  watchChatCatalog(input: CloudFunctionArgs<"chats/metadata:catalog">, changed: () => void, failure: (error: unknown) => void) {
    if (!this.socket) throw new Error("cloud-connection-unavailable");
    const generation = this.generation, contract = cloudFunctions["chats/metadata:catalog"];
    return this.socket.onUpdate(reference("chats/metadata:catalog"), contract.args.parse(input),
      () => { if (generation === this.generation) changed(); }, error => { if (generation === this.generation) failure(error); });
  }
  watchChatRead<N extends ChatQueryName>(name: N, input: CloudFunctionArgs<N>, changed: (value: CloudFunctionResult<N>) => void, failure: (error: unknown) => void) {
    if (!this.socket) throw new Error("cloud-connection-unavailable");
    const generation = this.generation, contract = cloudFunctions[name];
    const args: Record<string, Value> = contract.args.parse(input);
    return this.socket.onUpdate(makeFunctionReference<"query", Record<string, Value>, unknown>(name), args,
      value => { if (generation === this.generation) changed(contract.result.parse(value) as CloudFunctionResult<N>); },
      error => { if (generation === this.generation) failure(error); });
  }
  watchRemote<N extends RemoteQueryName>(name: N, input: CloudFunctionArgs<N>, changed: (value: CloudFunctionResult<N>) => void, failure: (error: unknown) => void) {
    if (!this.socket) throw new Error("cloud-connection-unavailable");
    const generation = this.generation, contract = cloudFunctions[name];
    const args: Record<string, Value> = contract.args.parse(input);
    return this.socket.onUpdate(makeFunctionReference<"query", Record<string, Value>, unknown>(name), args,
      value => { if (generation === this.generation) { try { changed(contract.result.parse(value) as CloudFunctionResult<N>); } catch (error) { failure(error); } } },
      error => { if (generation === this.generation) failure(error); });
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
    const client = this.createSocket(); this.socket = client;
    client.setAuth(async ({ forceRefreshToken }) => {
      try {
        const token = await this.token(forceRefreshToken);
        if (!current()) return null;
        if (!token) authenticationFailed(new AuthTransportError("temporarily-offline"));
        return token;
      } catch (error) { authenticationFailed(error); return null; }
    }, value => {
      if (!current()) return;
      this.authenticated = value;
      // Socket JWT rejection does not prove that the original HTTP session ended.
      if (!value) authenticationFailed(new AuthTransportError("temporarily-offline"));
    });
    client.onUpdate(reference("account:getAccessState"), protocolHeader(this.config), value => {
      if (!current() || !this.authenticated) return;
      try { changed(cloudFunctions["account:getAccessState"].result.parse(value)); }
      catch (error) { failed(error); }
    }, failed);
    let previous: boolean | undefined;
    client.subscribeToConnectionState(state => {
      if (current() && state.isWebSocketConnected !== previous) { previous = state.isWebSocketConnected; this.connected = previous; connected(previous); }
    });
  }
  close() {
    this.verifiedConfig = null;
    this.generation++; this.authenticated = false; this.connected = false;
    for (const cancel of this.pending) cancel();
    const client = this.socket; this.socket = null; if (client) void client.close();
  }
}
