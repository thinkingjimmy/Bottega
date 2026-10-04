/**
 * [INPUT]: PreviewGate, an exact listener-identity checker, Node HTTP and bounded ws relays.
 * [OUTPUT]: createPreviewProxy with typed HTTP/WS refusals, immediate identity invalidation, bounded drainage, replaceable one-time entry navigation and development recovery hints.
 * [POS]: Sole tunnel ingress; no request chooses an upstream host or port.
 */
import { createServer, request, STATUS_CODES, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { PreviewGate, PREVIEW_COOKIE } from "./gate";
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const pathAllowed = (path: string) => path.startsWith("/") && !path.startsWith("//") && !/[\r\n\\]/.test(path);
const landing = `<!doctype html><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title>Opening preview</title><p>Opening preview…</p><script>
let attempt=0;
const enter=()=>{
  const current=++attempt,code=location.hash.slice(1);
  history.replaceState(null,"",location.pathname);
  document.querySelector("p").textContent="Opening preview…";
  fetch("/__bottega/exchange",{method:"POST",headers:{"content-type":"text/plain"},body:code}).then(r=>{
    if(current!==attempt)return;
    if(r.ok)location.replace("/");else document.querySelector("p").textContent="This link has expired. Open a new link from Bottega.";
  }).catch(()=>{if(current===attempt)document.querySelector("p").textContent="Preview is unavailable. Return to Bottega.";});
};
addEventListener("hashchange",enter);enter();
</script>`;
type Refusal = 401 | 403 | 503;
const refusalBody = (status: Refusal) => status === 503 ? "Preview service is unavailable." : "Preview closed or access expired.";
function refuseUpgrade(socket: Socket, status: Refusal) {
  const body = refusalBody(status);
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
function headers(input: IncomingHttpHeaders, port: number) {
  const output: IncomingHttpHeaders = {};
  const named = new Set(String(input.connection ?? "").toLowerCase().split(",").map(s => s.trim()));
  for (const [key, value] of Object.entries(input)) if (!HOP.has(key) && !named.has(key) && key !== "host" && key !== "cookie" && !key.startsWith("sec-websocket-")) output[key] = value;
  const cookies = String(input.cookie ?? "").split(";").filter(c => !c.trim().startsWith(PREVIEW_COOKIE + "=")).join(";");
  if (cookies) output.cookie = cookies;
  output.host = `localhost:${port}`; return output;
}
export async function createPreviewProxy(input: { port: number; identity(): Promise<unknown>; streaming(): void; slowLoad?(): void; devOriginBlocked?(blocked: boolean): void; invalid(): void }) {
  const gate = new PreviewGate(), challenge = randomBytes(24).toString("base64url"), sockets = new Set<Socket>();
  const responses = new Set<ServerResponse>();
  let draining = false, navigationStarted = 0, navigationUntil = 0;
  const stopped = new AbortController();
  const relays = new Set<WebSocket>(), websocket = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  const invalidate = () => {
    draining = true; gate.close(); stopped.abort();
    for (const relay of relays) relay.terminate();
    for (const response of responses) response.destroy();
  };
  const host = (req: IncomingMessage) => typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"] : undefined;
  const admitted = async (req: IncomingMessage, upgrade = false): Promise<Refusal | null> => {
    if (draining) return 503;
    if (!pathAllowed(req.url ?? "")) return 403;
    if (!gate.active() || !gate.matchesHost(host(req))) return 401;
    const originRequired = upgrade || !["GET", "HEAD"].includes(req.method ?? "");
    if (originRequired && req.headers.origin !== gate.origin()) return 403;
    if (!gate.authorize(req.headers.cookie, req.headers.origin, originRequired)) return 401;
    let cancel!: () => void;
    const canceled = new Promise<void>(resolve => { cancel = resolve; stopped.signal.addEventListener("abort", cancel, { once: true }); });
    try {
      await Promise.race([input.identity(), canceled]);
      return draining ? 503 : gate.active() && !stopped.signal.aborted ? null : 401;
    } catch {
      if (!draining && gate.active()) { invalidate(); input.invalid(); }
      return draining ? 503 : 401;
    } finally { stopped.signal.removeEventListener("abort", cancel); }
  };
  const server = createServer(async (req, res) => {
    res.setHeader("referrer-policy", "no-referrer");
    const refuse = (status: Refusal) => { res.writeHead(status, { "cache-control": "no-store", connection: "close", "content-type": "text/plain; charset=utf-8" }); res.end(refusalBody(status)); };
    if (draining) { refuse(503); return; }
    if (req.url === "/__bottega/ready") { res.writeHead(200, { "cache-control": "no-store", "content-type": "text/plain" }); res.end(challenge); return; }
    if (req.url === "/__bottega/enter" && req.method === "GET" && gate.active() && gate.matchesHost(host(req))) {
      res.writeHead(200, { "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY" }); res.end(landing); return;
    }
    if (req.url === "/__bottega/exchange" && req.method === "POST" && gate.matchesHost(host(req))) {
      let body = "", oversized = false;
      req.on("data", chunk => { body += chunk.toString("utf8"); if (body.length > 128) { oversized = true; req.destroy(); } });
      req.on("end", () => {
        if (draining) { refuse(503); return; }
        if (!gate.active()) { refuse(401); return; }
        const originAllowed = req.headers.origin === gate.origin(), cookie = !oversized && gate.exchange(body, req.headers.origin);
        if (!cookie) { refuse(originAllowed ? 401 : 403); return; }
        res.writeHead(204, { "cache-control": "no-store", "set-cookie": cookie }); res.end();
      }); return;
    }
    const refusal = await admitted(req);
    if (refusal || req.url?.startsWith("/__bottega/")) { refuse(refusal ?? 403); return; }
    if (res.destroyed) return;
    responses.add(res);
    if (req.headers["sec-fetch-dest"] === "document" || String(req.headers.accept).includes("text/html")) {
      navigationStarted = Date.now(); navigationUntil = navigationStarted + 30000;
    }
    res.once("close", () => responses.delete(res));
    res.once("finish", () => {
      const now = Date.now();
      if (navigationStarted && now <= navigationUntil && now - navigationStarted > 3000) input.slowLoad?.();
      // A quiet resource burst ends the navigation measurement; HMR cannot trigger the hint later.
      if (responses.size <= 1) navigationUntil = Math.min(navigationUntil, now + 750);
    });
    const upstream = request({ host: "127.0.0.1", port: input.port, path: req.url, method: req.method, headers: headers(req.headers, input.port), agent: false }, response => {
      if (response.statusCode === 403 && req.url?.startsWith("/_next/")) input.devOriginBlocked?.(true);
      const type = String(response.headers["content-type"] ?? "");
      if (type.includes("text/event-stream") || type.startsWith("text/") && !response.headers["content-length"] && response.headers["transfer-encoding"]) input.streaming();
      const next: IncomingHttpHeaders = {};
      for (const [name, value] of Object.entries(response.headers)) if (!HOP.has(name)) next[name] = value;
      // An application cannot replace the gate's reserved authorization cookie.
      if (next["set-cookie"]) next["set-cookie"] = next["set-cookie"].filter(c => !c.startsWith(PREVIEW_COOKIE + "="));
      res.writeHead(response.statusCode ?? 502, next); response.pipe(res);
    });
    upstream.setTimeout(60_000, () => upstream.destroy());
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on("aborted", () => upstream.destroy()); res.on("close", () => upstream.destroy()); req.pipe(upstream);
  });
  server.headersTimeout = 10_000; server.requestTimeout = 60_000; server.maxHeadersCount = 100;
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      const refusal = await admitted(req, true);
      if (refusal) { refuseUpgrade(socket as Socket, refusal); return; }
      if (socket.destroyed) return;
      const protocols = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map(s => s.trim()).filter(Boolean);
      const upstream = new WebSocket(`ws://127.0.0.1:${input.port}${req.url}`, protocols, {
        headers: headers(req.headers, input.port) as Record<string, string>, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false, handshakeTimeout: 10_000 });
      relays.add(upstream);
      upstream.once("error", error => {
        // Next can reject an upgrade with bare Unauthorized bytes instead of an HTTP response.
        const handshake = error as Error & { code?: string; rawPacket?: Buffer };
        if (req.url?.split("?")[0] === "/_next/webpack-hmr" &&
          (error.message === "Unexpected server response: 403" || handshake.code === "HPE_INVALID_CONSTANT" && handshake.rawPacket?.toString().startsWith("Unauthorized"))) input.devOriginBlocked?.(true);
        socket.destroy();
      });
      upstream.once("open", () => {
        if (!gate.active()) { upstream.terminate(); socket.destroy(); return; }
        if (req.url?.split("?")[0] === "/_next/webpack-hmr") input.devOriginBlocked?.(false);
        websocket.handleUpgrade(req, socket, head, browser => {
          relays.add(browser);
          const ping = setInterval(() => { if (browser.readyState === WebSocket.OPEN) browser.ping(); }, 30_000); ping.unref();
          browser.on("message", (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
          upstream.on("message", (data, binary) => { if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary }); });
          browser.on("error", () => upstream.terminate()); upstream.on("error", () => browser.terminate());
          browser.on("close", () => { clearInterval(ping); upstream.terminate(); relays.delete(browser); });
          upstream.on("close", () => browser.close());
        });
      });
      upstream.once("close", () => relays.delete(upstream));
    })().catch(() => socket.destroy());
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const revoke = () => { gate.close(); stopped.abort(); for (const relay of relays) relay.terminate(); for (const socket of sockets) socket.destroy(); };
  return { port: (server.address() as { port: number }).port, challenge, gate, revoke, invalidate,
    async drain() {
      draining = true; gate.close(); stopped.abort();
      for (const relay of relays) if (relay.readyState === WebSocket.OPEN) relay.close(1001);
      const deadline = Date.now() + 30000;
      while (responses.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      revoke();
    },
    async close() {
      if (!draining) revoke();
      websocket.close();
      // Identity invalidation already killed every application relay. Let only refusal responses flush.
      const cutoff = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 1000); cutoff.unref();
      try { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
      finally { clearTimeout(cutoff); }
    } };
}
