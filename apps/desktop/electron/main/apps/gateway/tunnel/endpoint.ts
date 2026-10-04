/**
 * [INPUT]: Dormant grants, native fetch body types, their strict codecs and fresh generation/lifecycle-bound upstream resolution and sealed terminal notifications.
 * [OUTPUT]: createServerTunnelEndpoint with isolated HTTP and one ordered encrypted WS transport per grant.
 * [POS]: No gateway reuse or caller-selected upstream; only decrypted policy-admitted requests reach loopback.
 */
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { packHttp, unpackHttp, requestPolicy, responsePolicy, tunnelPath, type TunnelHttp } from "@ai-chat/cloud-protocol/apps/tunnel/policy";
import { TUNNEL_LIMITS } from "@ai-chat/cloud-protocol/apps/tunnel/model";
import type { TunnelEndReason } from "@ai-chat/cloud-protocol/apps/tunnel/terminal";
import type { TunnelCodec, TunnelKind } from "@ai-chat/cloud-protocol/apps/tunnel/codec";
export type TunnelUpstream = { port: number; generation: string; lifecycleRevision: number; origin: string };
export type EndpointGrant = { grantId: string; codec: TunnelCodec; wsDeclared: boolean; current(): Promise<TunnelUpstream>; close(reason?: TunnelEndReason): void };
async function bytes(body: AsyncIterable<Uint8Array>, limit: number) {
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of body) { size += chunk.length; if (size > limit) throw new Error("tunnel-byte-limit"); chunks.push(chunk); }
  return Buffer.concat(chunks, size);
}
export async function createServerTunnelEndpoint(find: (id: string) => EndpointGrant | null, challenge: string) {
  const transports = new Map<string, WebSocket>(), sockets = new Map<string, Set<{ destroy(): void }>>();
  const websocket = new WebSocketServer({ noServer: true, maxPayload: TUNNEL_LIMITS.request + 128 * 1024, perMessageDeflate: false });
  const draining = new Set<WebSocket>(), relays = new Map<string, () => void>();
  const close = (id: string, terminal?: Uint8Array) => {
    const transport = transports.get(id); transports.delete(id);
    relays.get(id)?.(); relays.delete(id);
    for (const socket of sockets.get(id) ?? []) socket.destroy(); sockets.delete(id);
    if (!transport) return;
    if (!terminal || transport.readyState !== WebSocket.OPEN) { transport.terminate(); return; }
    // Only a sealed explanation may flush; the grant, key and upstream authority are already gone.
    draining.add(transport);
    const cutoff = setTimeout(() => transport.terminate(), 1000); cutoff.unref();
    transport.once("close", () => { clearTimeout(cutoff); draining.delete(transport); });
    transport.send(terminal, error => { if (error) transport.terminate(); else transport.close(); });
  };
  const request = async (grant: EndpointGrant, raw: TunnelHttp): Promise<TunnelHttp> => {
    const target = await grant.current(), admitted = requestPolicy(raw, target.origin);
    const controller = new AbortController(), owned = { destroy: () => controller.abort() };
    const active = sockets.get(grant.grantId) ?? new Set(); sockets.set(grant.grantId, active);
    if (active.size >= TUNNEL_LIMITS.connections) throw new Error("tunnel-connection-limit");
    active.add(owned);
    try {
      const response = await fetch(`http://127.0.0.1:${target.port}${admitted.path}`, { method: admitted.method, headers: admitted.headers,
        body: ["GET", "HEAD"].includes(admitted.method) ? undefined : admitted.body as RequestInit["body"],
        redirect: "manual", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(TUNNEL_LIMITS.requestMs)]) });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => { if (["content-type", "location", "etag", "cache-control", "last-modified"].includes(name)) headers[name] = value; });
      // Cookie values stay inside the encrypted envelope and the worker's per-lease jar.
      headers["x-tunnel-cookies"] = JSON.stringify(response.headers.getSetCookie());
      if ((headers["content-type"] ?? "").includes("text/event-stream")) { await response.body?.cancel(); throw new Error("tunnel-streaming-unsupported"); }
      const body = response.body ? await bytes(response.body as unknown as AsyncIterable<Uint8Array>, TUNNEL_LIMITS.response) : new Uint8Array();
      await grant.current();
      return responsePolicy({ status: response.status, headers, body });
    } catch (error) {
      return { status: 502, headers: { "content-type": "text/plain" }, body: new TextEncoder().encode(error instanceof Error && error.message === "tunnel-streaming-unsupported" ? "Streaming and long polling are not supported." : "Server surface request failed or timed out.") };
    } finally { active.delete(owned); }
  };
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/__bottega/ready") { res.end(challenge); return; }
    const match = /^\/t\/([0-9a-f-]{36})$/.exec(req.url ?? ""), grant = match && find(match[1]!);
    if (req.method !== "POST" || !grant || transports.has(grant.grantId)) { res.writeHead(403); res.end(); return; }
    const active = sockets.get(grant.grantId) ?? new Set(); sockets.set(grant.grantId, active);
    if (active.size >= TUNNEL_LIMITS.connections) { res.writeHead(429); res.end(); return; }
    res.once("close", () => { if (!res.writableFinished) grant.close(); });
    void (async () => {
      const frame = grant.codec.open(await bytes(req, TUNNEL_LIMITS.request + 128 * 1024));
      try {
        if (frame.kind !== "request") throw new Error("tunnel-frame-invalid");
        const answer = await request(grant, unpackHttp(frame.bytes)), packed = packHttp(answer);
        try { const cipher = grant.codec.seal("response", packed); res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" }); res.end(cipher); }
        finally { packed.fill(0); answer.body.fill(0); }
      } finally { frame.bytes.fill(0); }
    })().catch(() => { grant.close(); close(grant.grantId); res.destroy(); });
  });
  server.headersTimeout = 10_000; server.requestTimeout = TUNNEL_LIMITS.requestMs;
  server.on("upgrade", (req, socket, head) => {
    const match = /^\/w\/([0-9a-f-]{36})$/.exec(req.url ?? ""), grant = match && find(match[1]!);
    if (!grant || transports.has(grant.grantId)) { socket.destroy(); return; }
    websocket.handleUpgrade(req, socket, head, transport => {
      transports.set(grant.grantId, transport);
      const upstreams = new Map<string, WebSocket>();
      const emit = (kind: TunnelKind, payload: TunnelHttp) => {
        const packed = packHttp(payload);
        try { if (transports.get(grant.grantId) === transport && transport.readyState === WebSocket.OPEN) transport.send(grant.codec.seal(kind, packed)); } finally { packed.fill(0); payload.body.fill(0); }
      };
      let lane = Promise.resolve(), queuedBytes = 0, requests = 0;
      const ping = setInterval(() => { if (transport.readyState === WebSocket.OPEN) transport.ping(); }, 30_000); ping.unref();
      const fail = () => { grant.close(); close(grant.grantId); };
      relays.set(grant.grantId, () => { clearInterval(ping); for (const upstream of upstreams.values()) upstream.terminate(); upstreams.clear(); });
      transport.on("message", (data, binary) => {
        if (transports.get(grant.grantId) !== transport) return;
        if (!binary) { fail(); return; }
        const size = (data as Buffer).length; queuedBytes += size;
        if (queuedBytes > TUNNEL_LIMITS.request + 2 * TUNNEL_LIMITS.frame) { fail(); return; }
        // All application HTTP and WS frames share this one ordered transport, so a zero replay window is meaningful.
        lane = lane.then(async () => {
          const frame = grant.codec.open(new Uint8Array(data as Buffer));
          try {
            const payload = unpackHttp(frame.bytes), target = await grant.current(), channel = payload.headers["x-tunnel-channel"];
            if (!channel || !/^[a-zA-Z0-9_-]{1,80}$/.test(channel)) throw new Error("tunnel-channel-invalid");
            if (frame.kind === "request") {
              if (++requests + upstreams.size > TUNNEL_LIMITS.connections) throw new Error("tunnel-connection-limit");
              void request(grant, payload).then(answer => { answer.headers["x-tunnel-channel"] = channel; emit("response", answer); })
                .catch(fail).finally(() => { requests--; payload.body.fill(0); }); return;
            }
            if (!grant.wsDeclared) throw new Error("tunnel-websocket-undeclared");
            if (frame.kind === "ws-open") {
              if (requests + upstreams.size >= TUNNEL_LIMITS.connections || upstreams.has(channel) || !payload.path) throw new Error("tunnel-connection-limit");
              const protocols: unknown = JSON.parse(payload.headers["x-tunnel-protocols"] ?? "[]");
              if (!Array.isArray(protocols) || protocols.length > 8 || protocols.some(value => typeof value !== "string" || !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/i.test(value)) || new Set(protocols).size !== protocols.length) throw new Error("tunnel-protocol-invalid");
              const upstream = new WebSocket(`ws://127.0.0.1:${target.port}${tunnelPath(payload.path)}`, protocols as string[], { origin: target.origin, perMessageDeflate: false, maxPayload: TUNNEL_LIMITS.frame, handshakeTimeout: 10_000 });
              upstreams.set(channel, upstream);
              upstream.once("open", () => emit("ws-open", { headers: { "x-tunnel-channel": channel, "x-tunnel-protocol": upstream.protocol }, body: new Uint8Array() }));
              upstream.on("message", (message, isBinary) => {
                void grant.current().then(() => emit("ws-frame", { headers: { "x-tunnel-channel": channel, "x-tunnel-binary": String(isBinary) }, body: new Uint8Array(message as Buffer) })).catch(fail);
              });
              const ended = () => { upstreams.delete(channel); emit("ws-close", { headers: { "x-tunnel-channel": channel }, body: new Uint8Array() }); };
              upstream.once("close", ended); upstream.once("error", () => upstream.terminate()); return;
            }
            if (frame.kind === "ws-close") { upstreams.get(channel)?.close(); return; }
            const upstream = upstreams.get(channel);
            if (frame.kind !== "ws-frame" || !upstream || upstream.readyState !== WebSocket.OPEN || payload.body.length > TUNNEL_LIMITS.frame) throw new Error("tunnel-websocket-invalid");
            upstream.send(payload.body, { binary: payload.headers["x-tunnel-binary"] === "true" });
          } finally { frame.bytes.fill(0); }
        }).catch(fail).finally(() => { queuedBytes -= size; });
      });
      transport.once("close", () => { clearInterval(ping); for (const upstream of upstreams.values()) upstream.terminate(); upstreams.clear(); transports.delete(grant.grantId); relays.delete(grant.grantId); grant.close(); });
      transport.on("error", fail);
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { port: (server.address() as { port: number }).port, revoke: close, async close() {
    for (const id of new Set([...sockets.keys(), ...transports.keys()])) close(id);
    for (const transport of draining) transport.terminate(); draining.clear();
    websocket.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
