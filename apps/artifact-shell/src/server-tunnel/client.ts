/**
 * [INPUT]: One decrypted grant from the authenticated parent and a fresh isolated surface lease origin.
 * [OUTPUT]: mountServerTunnel, early keyless lifetime handoff and exact-host worker response headers.
 * [POS]: The wrapper gives keys only to the worker; the parent owns cleanup before connection and after navigation.
 */
import { tunnelGrantSchema, type TunnelGrant } from "@ai-chat/cloud-protocol/apps/tunnel/model";
export function serverWorkerHeaders(grant: TunnelGrant) {
  const value = tunnelGrantSchema.parse(grant);
  return { "content-security-policy": `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src ${value.tunnelUrl} ${value.tunnelUrl.replace("https:", "wss:")}`,
    "cache-control": "no-store", "service-worker-allowed": "/", "referrer-policy": "no-referrer" };
}
export async function mountServerTunnel(input: TunnelGrant, workerUrl: string, signal: AbortSignal, handoff: (control: MessagePort) => void) {
  const grant = tunnelGrantSchema.parse(input), url = new URL(workerUrl, location.href);
  let registration: ServiceWorkerRegistration | undefined, navigated = false;
  const channel = new MessageChannel(), lifetime = new MessageChannel(), controller = new AbortController();
  const abort = () => {
    controller.abort(); input.sessionKey = ""; grant.sessionKey = "";
    channel.port1.postMessage({ type: "close" });
    void registration?.unregister().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true }); addEventListener("pagehide", abort, { once: true });
  try {
    signal.throwIfAborted();
    lifetime.port2.onmessage = event => { if (event.data?.type === "close") abort(); };
    handoff(lifetime.port1);
    if (url.origin !== location.origin) throw new Error("tunnel-worker-origin");
    url.searchParams.set("tunnel", new URL(grant.tunnelUrl).hostname);
    if (await navigator.serviceWorker.getRegistration("/")) throw new Error("tunnel-lease-reused");
    controller.signal.throwIfAborted();
    registration = await navigator.serviceWorker.register(url.href, { type: "module", scope: "/", updateViaCache: "none" });
    controller.signal.throwIfAborted();
    await workerReady(controller.signal);
    controller.signal.throwIfAborted();
    const worker = registration.active; if (!worker) throw new Error("tunnel-worker-unavailable");
    const nonce = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); controller.signal.removeEventListener("abort", failed); if (error) reject(error); else resolve(); };
      const failed = () => finish(new Error("tunnel-closed"));
      const timer = setTimeout(() => finish(new Error("tunnel-worker-timeout")), 10_000);
      controller.signal.addEventListener("abort", failed, { once: true });
      channel.port1.onmessage = event => {
        if (event.data?.nonce !== nonce) return;
        finish(event.data?.ok ? undefined : new Error(event.data?.reason ?? "tunnel-worker-failed"));
      };
      worker.postMessage({ type: "bottega:tunnel:bind", nonce, grant }, [channel.port2, lifetime.port2]);
      input.sessionKey = ""; grant.sessionKey = "";
    });
    controller.signal.throwIfAborted();
    navigated = true;
    location.replace("/app/");
  } finally {
    input.sessionKey = ""; grant.sessionKey = "";
    if (!navigated) channel.port1.postMessage({ type: "close" });
    channel.port1.close(); signal.removeEventListener("abort", abort); removeEventListener("pagehide", abort);
    if (!navigated) {
      // Before binding, this end still belongs to the trusted wrapper and can report registration failure.
      lifetime.port2.postMessage({ type: "ended", reason: Date.now() >= grant.expiresAt ? "tunnel-expired" : "tunnel-connect-failed" });
      lifetime.port1.close(); lifetime.port2.close(); await registration?.unregister();
    }
  }
}

async function workerReady(signal: AbortSignal) {
  let abort: () => void = () => {};
  try {
    await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error("tunnel-closed")); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}
