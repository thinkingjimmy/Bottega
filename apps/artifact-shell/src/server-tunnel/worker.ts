/**
 * [INPUT]: One-time trusted wrapper channels, dormant grant contracts and the pinned WASM primitive.
 * [OUTPUT]: Ephemeral HTTP/WS relay, authenticated terminal notifications and complete worker/port/key cleanup.
 * [POS]: Service Worker secret boundary; no key, cookie, plaintext response or grant is persisted.
 */
import { installTunnelWebSocket } from "./websocket";
import { createServiceWorkerTunnelPrimitive as createTunnelPrimitive } from "@ai-chat/cloud-crypto/tunnel/service-worker";
import { TunnelCodec, type TunnelKind } from "@ai-chat/cloud-protocol/apps/tunnel/codec";
import { tunnelGrantSchema, TUNNEL_LIMITS } from "@ai-chat/cloud-protocol/apps/tunnel/model";
import { readTunnelEnd, type TunnelEndReason } from "@ai-chat/cloud-protocol/apps/tunnel/terminal";
import { packHttp, unpackHttp, tunnelPath, type TunnelHttp } from "@ai-chat/cloud-protocol/apps/tunnel/policy";
type FetchEvent = { request: Request; respondWith(promise: Promise<Response>): void };
type ExtendEvent = { waitUntil(promise: Promise<unknown>): void };
type WorkerEvents = { install: ExtendEvent; activate: ExtendEvent; message: MessageEvent; fetch: FetchEvent };
const scope = globalThis as unknown as { addEventListener<K extends keyof WorkerEvents>(type: K, listener: (event: WorkerEvents[K]) => void): void; location: Location;
  registration: { unregister(): Promise<boolean> }; clients: { claim(): Promise<void> }; skipWaiting(): Promise<void> };
let ended = false, control: MessagePort | null = null, expiry: ReturnType<typeof setTimeout> | undefined;
let cancelConnect: ((reason: TunnelEndReason) => void) | null = null;
let claimed = false, codec: TunnelCodec | null = null, socket: WebSocket | null = null;
const pending = new Map<string, { resolve(value: TunnelHttp): void; reject(): void; timer: ReturnType<typeof setTimeout> }>();
const streams = new Map<string, MessagePort>(), cookies = new Map<string, { value: string; path: string; expires: number }>();
const applicationPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'";
function close(reason: TunnelEndReason = "tunnel-connect-failed") {
  if (ended) return; ended = true; clearTimeout(expiry);
  codec?.close(); codec = null; socket?.close(); socket = null; cookies.clear();
  cancelConnect?.(reason); cancelConnect = null;
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(); } pending.clear();
  for (const port of streams.values()) { port.postMessage({ type: "close" }); port.close(); } streams.clear();
  control?.postMessage({ type: "ended", reason }); control?.close(); control = null;
  void scope.registration.unregister().catch(() => undefined);
}
function send(kind: TunnelKind, value: TunnelHttp) {
  if (!codec || socket?.readyState !== WebSocket.OPEN) throw new Error("tunnel-closed");
  const bytes = packHttp(value); try { socket.send(codec.seal(kind, bytes)); } finally { bytes.fill(0); value.body.fill(0); }
}
scope.addEventListener("install", (event: ExtendEvent) => event.waitUntil(scope.skipWaiting()));
scope.addEventListener("activate", (event: ExtendEvent) => event.waitUntil(scope.clients.claim()));
scope.addEventListener("message", (event: MessageEvent) => {
  if (event.data?.type === "bottega:tunnel:ws" && !ended && codec && event.ports[0]) {
    const port = event.ports[0], channel = crypto.randomUUID();
    if (streams.size >= TUNNEL_LIMITS.connections) { port.postMessage({ type: "close" }); return; }
    try { const path = tunnelPath(String(event.data.path)); streams.set(channel, port);
      send("ws-open", { path, headers: { "x-tunnel-channel": channel, "x-tunnel-protocols": JSON.stringify(event.data.protocols ?? []) }, body: new Uint8Array() });
      port.onmessage = message => {
        try { if (message.data?.type === "close") { send("ws-close", { headers: { "x-tunnel-channel": channel }, body: new Uint8Array() }); streams.delete(channel); port.close(); }
          else if (message.data?.type === "send") { const bytes = new Uint8Array(message.data.bytes);
            if (bytes.length > TUNNEL_LIMITS.frame) throw new Error("tunnel-frame-limit");
            send("ws-frame", { headers: { "x-tunnel-channel": channel, "x-tunnel-binary": String(message.data.binary) }, body: bytes }); } }
        catch { close(); }
      };
    } catch { port.postMessage({ type: "close" }); }
    return;
  }
  if (event.data?.type !== "bottega:tunnel:bind" || claimed || !event.ports[0] || !event.ports[1]) return;
  claimed = true;
  const port = event.ports[0], nonce = event.data.nonce;
  port.onmessage = command => { if (command.data?.type === "close") close(); };
  control = event.ports[1];
  control.onmessage = command => { if (command.data?.type === "close") close(); };
  void (async () => {
    const grant = tunnelGrantSchema.parse(event.data.grant);
    if (grant.expiresAt <= Date.now()) throw new Error("tunnel-expired");
    const raw = atob(grant.sessionKey.replace(/-/g, "+").replace(/_/g, "/") + "="), key = Uint8Array.from(raw, c => c.charCodeAt(0));
    try {
      const primitive = await createTunnelPrimitive();
      if (ended) throw new Error("tunnel-closed");
      codec = new TunnelCodec(primitive, grant.grantId, key, "controller", close);
    } finally { key.fill(0); grant.sessionKey = ""; event.data.grant.sessionKey = ""; }
    socket = new WebSocket(grant.tunnelUrl.replace("https:", "wss:") + "/w/" + grant.grantId); socket.binaryType = "arraybuffer";
    socket.onmessage = incoming => {
      try {
        const frame = codec!.open(new Uint8Array(incoming.data));
        try { const value = unpackHttp(frame.bytes), channel = value.headers["x-tunnel-channel"];
          if (frame.kind === "response") {
            const reason = readTunnelEnd(value);
            if (reason) { close(reason); return; }
            const request = pending.get(channel!); if (!request) throw new Error("tunnel-response-invalid");
            pending.delete(channel!); clearTimeout(request.timer); request.resolve(value);
          } else { const stream = streams.get(channel!); if (!stream) return;
            stream.postMessage({ type: frame.kind === "ws-open" ? "open" : frame.kind === "ws-close" ? "close" : "message",
              bytes: value.body, binary: value.headers["x-tunnel-binary"] === "true", protocol: value.headers["x-tunnel-protocol"] ?? "" }, [value.body.buffer]);
            if (frame.kind === "ws-close") { stream.close(); streams.delete(channel!); }
          }
        } finally { frame.bytes.fill(0); }
      } catch { close(); }
    };
    socket.onclose = () => close(); socket.onerror = () => close();
    await new Promise<void>((resolve, reject) => {
      const transport = socket!;
      const cleanup = () => { clearTimeout(timer); cancelConnect = null; transport.removeEventListener("error", fail); transport.removeEventListener("close", fail); };
      const fail = () => { cleanup(); reject(new Error("tunnel-connect-failed")); };
      const timer = setTimeout(() => { cleanup(); reject(new Error("tunnel-connect-timeout")); }, 35_000);
      cancelConnect = reason => { cleanup(); reject(new Error(reason)); };
      transport.onopen = () => { cleanup(); resolve(); };
      transport.addEventListener("error", fail, { once: true }); transport.addEventListener("close", fail, { once: true });
    });
    if (ended) throw new Error("tunnel-closed");
    expiry = setTimeout(() => close("tunnel-expired"), Math.max(0, grant.expiresAt - Date.now()));
    port.postMessage({ nonce, ok: true }); port.close();
    control?.postMessage({ type: "ready" });
  })().catch(cause => {
    const reason = cause instanceof Error && cause.message === "tunnel-expired" ? "tunnel-expired" : "tunnel-connect-failed";
    close(reason); port.postMessage({ nonce, ok: false, reason }); port.close();
  });
});
function jar(path: string) {
  const values: string[] = [];
  const pathname = path.split("?")[0]!;
  for (const [name, cookie] of cookies) { if (cookie.expires <= Date.now()) cookies.delete(name); else if (pathname === cookie.path || pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : cookie.path + "/")) values.push(name + "=" + cookie.value); }
  return values.join("; ");
}
function remember(raw: string | undefined) {
  let values: unknown; try { values = JSON.parse(raw ?? "[]"); } catch { return; }
  if (!Array.isArray(values)) return;
  for (const value of values.slice(0, 32)) {
    if (typeof value !== "string" || value.length > 4096) continue;
    const [pair, ...attributes] = value.split(";"), separator = pair!.indexOf("=");
    const name = pair!.slice(0, separator).trim(), content = pair!.slice(separator + 1).trim();
    if (separator < 1 || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)) continue;
    let path = "/", expires = Infinity;
    for (const attribute of attributes) { const [key, ...parts] = attribute.trim().split("="), data = parts.join("=");
      if (key?.toLowerCase() === "path" && data.startsWith("/")) path = data;
      if (key?.toLowerCase() === "max-age" && /^-?\d+$/.test(data)) expires = Date.now() + Number(data) * 1000;
      if (key?.toLowerCase() === "expires" && expires === Infinity && Number.isFinite(Date.parse(data))) expires = Date.parse(data);
    }
    if (cookies.size < 64 || cookies.has(name)) cookies.set(name, { value: content, path, expires });
  }
}
scope.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (url.origin !== scope.location.origin) { event.respondWith(Promise.resolve(new Response("External requests are unavailable.", { status: 403 }))); return; }
  event.respondWith((async () => {
    try {
      const channel = crypto.randomUUID(), path = tunnelPath((url.pathname.startsWith("/app/") ? "/" + url.pathname.slice(5) : url.pathname) + url.search);
      const body = new Uint8Array(await event.request.arrayBuffer()); if (body.length > TUNNEL_LIMITS.request || pending.size >= 8) throw new Error("tunnel-request-limit");
      const headers: Record<string, string> = { "x-tunnel-channel": channel, "x-tunnel-cookie": jar(path) };
      for (const [name, value] of event.request.headers) if (["accept", "accept-language", "content-type", "if-none-match", "if-modified-since"].includes(name)) headers[name] = value;
      if (!codec || socket?.readyState !== WebSocket.OPEN) throw new Error("tunnel-closed");
      const response = new Promise<TunnelHttp>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(channel); reject(new Error("tunnel-timeout")); }, TUNNEL_LIMITS.requestMs);
        pending.set(channel, { resolve, reject: () => reject(new Error("tunnel-closed")), timer });
        try { send("request", { method: event.request.method, path, headers, body }); }
        catch (error) { clearTimeout(timer); pending.delete(channel); reject(error); }
      });
      const result = await response; remember(result.headers["x-tunnel-cookies"]);
      delete result.headers["x-tunnel-cookies"]; delete result.headers["x-tunnel-channel"];
      result.headers["content-security-policy"] = applicationPolicy; result.headers["cache-control"] = "no-store";
      if (result.headers.location) result.headers.location = "/app" + tunnelPath(result.headers.location);
      if ((result.headers["content-type"] ?? "").includes("text/html")) {
        const html = new TextDecoder().decode(result.body), shim = "<script>(" + installTunnelWebSocket.toString() + ")();</script>";
        result.body.fill(0); result.body = new TextEncoder().encode(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => match + shim) : shim + html);
      }
      return new Response([204, 304].includes(result.status!) || event.request.method === "HEAD" ? null : result.body as BodyInit, { status: result.status, headers: result.headers });
    } catch { return new Response("The server surface is unavailable. Reopen it from Bottega. Streaming and long polling are not supported.", { status: 502, headers: { "content-type": "text/plain", "cache-control": "no-store" } }); }
  })());
});
