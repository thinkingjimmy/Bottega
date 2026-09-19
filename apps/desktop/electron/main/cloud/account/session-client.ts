/**
 * [INPUT]: Depends on fixed cloud configuration, closed auth schemas and a main-owned credential reader.
 * [OUTPUT]: Provides bounded auth transport with return-mode/version enforcement, server failure codes, deletion notice lookup and cache-first deduplicated JWT renewal.
 * [POS]: Main HTTP boundary; endpoint/origin selection never comes from renderer input.
 */
import { desktopAuth, DESKTOP_AUTH_CONTRACT_HEADER, DESKTOP_AUTH_CONTRACT_VERSION, type DesktopAuthName, type DesktopAuthArgs, type DesktopAuthResult, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { accountDeletionAuth } from "@ai-chat/cloud-protocol/auth/deletion";
import { protocolHeader } from "@ai-chat/cloud-protocol";
export class AuthTransportError extends Error {
  constructor(readonly kind: "temporarily-offline" | "invalid-session" | "request-rejected" | "server-outdated",
    readonly status?: number, readonly code?: string) { super(kind); }
}
export class SessionClient {
  private generation = 0;
  private token: { value: string; expiresAt: number; sessionId: string } | null = null;
  private refresh: Promise<string | null> | null = null;
  constructor(private readonly config: CloudBuildConfig, private readonly credentials: () => Promise<{ bearer: string; sessionId: string } | null>,
    private readonly send: typeof fetch = fetch) {}
  clear() { this.generation++; this.token = null; this.refresh = null; }
  private async json(path: string, method: "GET" | "POST", body?: unknown, bearer?: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.send(this.config.authOrigin + path, { method, redirect: "error", credentials: "omit",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer " + bearer } : {}) },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new AuthTransportError("temporarily-offline"); }
    if (path === desktopAuth.start.path && response.status < 500 && ![401, 408, 429].includes(response.status) &&
      response.headers.get(DESKTOP_AUTH_CONTRACT_HEADER) !== DESKTOP_AUTH_CONTRACT_VERSION) throw new AuthTransportError("server-outdated", response.status);
    if (!response.ok) throw new AuthTransportError(response.status === 401 ? "invalid-session" :
      response.status >= 500 || [408, 429].includes(response.status) ? "temporarily-offline" : "request-rejected",
      response.status, await this.failureCode(response));
    return this.payload(response);
  }
  private async payload(response: Response): Promise<unknown> {
    const reader = response.body?.getReader(); if (!reader) throw new AuthTransportError("request-rejected");
    const pieces: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 65_536) { await reader.cancel(); throw new AuthTransportError("request-rejected"); }
        pieces.push(chunk.value);
      }
    } catch (error) { throw error instanceof AuthTransportError ? error : new AuthTransportError("temporarily-offline"); }
    try { return JSON.parse(Buffer.concat(pieces).toString("utf8")); } catch { throw new AuthTransportError("request-rejected"); }
  }
  // The bridge reports the delivery failure as a code; an unreadable body simply leaves the caller with the HTTP class.
  private async failureCode(response: Response) {
    try {
      const code = (await this.payload(response) as { code?: unknown }).code;
      return typeof code === "string" && code.length <= 64 ? code : undefined;
    } catch { return undefined; }
  }
  async request<N extends Exclude<DesktopAuthName, "metadata" | "approve" | "reject" | "token">>(name: N, input: DesktopAuthArgs<N>,
    options: { bearer?: string; signal?: AbortSignal } = {}): Promise<DesktopAuthResult<N>> {
    const endpoint = desktopAuth[name]; const body = endpoint.args.parse(input);
    const value = await this.json(endpoint.path, endpoint.method, body, options.bearer, options.signal);
    const parsed = endpoint.result.safeParse(value);
    if (name === "start" && (!parsed.success || !("returnMode" in parsed.data) ||
      parsed.data.returnMode !== (body as DesktopAuthArgs<"start">).returnMode)) throw new AuthTransportError("server-outdated");
    if (!parsed.success) throw new AuthTransportError("request-rejected");
    return parsed.data as DesktopAuthResult<N>;
  }
  getToken(force = false): Promise<string | null> {
    // Every authenticated call asks for this token; consulting the cache first keeps the
    // steady state free of credential decryption, since clear() runs on every session change.
    if (!force && this.token && this.token.expiresAt > Date.now() + 30_000) return Promise.resolve(this.token.value);
    if (this.refresh) return this.refresh;
    const generation = this.generation;
    const request = (async () => {
      const session = await this.credentials(); if (!session || generation !== this.generation) return null;
      if (!force && this.token?.sessionId === session.sessionId && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
      const value = desktopAuth.token.result.parse(await this.json(desktopAuth.token.path, "GET", undefined, session.bearer));
      const payload = JSON.parse(Buffer.from(value.token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
      if (!Number.isFinite(payload.exp) || payload.exp! * 1000 <= Date.now()) throw new AuthTransportError("invalid-session");
      if (generation !== this.generation) return null;
      this.token = { value: value.token, expiresAt: payload.exp! * 1000, sessionId: session.sessionId }; return value.token;
    })().catch(error => { if (generation !== this.generation) return null; throw error; });
    this.refresh = request;
    void request.finally(() => { if (this.refresh === request) this.refresh = null; }).catch(() => undefined);
    return request;
  }
  async signOut(bearer: string) { await this.json("/api/auth/sign-out", "POST", {}, bearer); this.clear(); }
  async accountDeleted(bearer: string) {
    return accountDeletionAuth.notice.result.parse(await this.json(accountDeletionAuth.notice.path, "POST", protocolHeader(this.config), bearer)).deleted;
  }
}
