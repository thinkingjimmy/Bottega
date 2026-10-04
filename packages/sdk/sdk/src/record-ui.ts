/**
 * [INPUT]: Depends on browser messaging and the public record operation types.
 * [OUTPUT]: Provides openRecordUi, a bounded client for an isolated record action with no session or native bridge.
 * [POS]: Author-facing browser transport shared by native opaque frames and encrypted Web surfaces.
 */
import type { RecordCall } from "@bottega/contracts/plugins/records/contract";

type CloudSurface = { call(operation: string, payload: unknown): Promise<unknown>; post(channel: string): void };
type Pending = { resolve(value: unknown): void; reject(cause: Error): void; timer: ReturnType<typeof setTimeout> };
export async function openRecordUi() {
  const bridge = (globalThis as typeof globalThis & { __bottegaSurface?: CloudSurface }).__bottegaSurface;
  const params = new URLSearchParams(location.hash.slice(1));
  const nonce = params.get("readyNonce"), hostOrigin = params.get("hostOrigin");
  if (!bridge && (!nonce || !hostOrigin || hostOrigin === "*" || parent === window)) throw new Error("RECORD_HOST_MISSING");
  const pending = new Map<string, Pending>();
  let stopped = false, heartbeat: ReturnType<typeof setInterval> | undefined;
  const settle = (id: string, value: unknown, cause?: unknown) => {
    const item = pending.get(id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(id);
    if (cause !== undefined) item.reject(cause instanceof Error ? cause : new Error(typeof cause === "string" ? cause : "RECORD_REQUEST_FAILED"));
    else item.resolve(value);
  };
  const message = (event: MessageEvent) => {
    if (event.source !== parent || event.origin !== hostOrigin || event.data?.readyNonce !== nonce) return;
    if (event.data.channel === "bottega:plugin-response") settle(event.data.requestId, event.data.result, event.data.error);
  };
  const call = (operation: string, payload: unknown = {}): Promise<unknown> => {
    if (stopped) return Promise.reject(new Error("RECORD_UI_CLOSED"));
    if (pending.size >= 32 || new TextEncoder().encode(JSON.stringify(payload)).length > 6000) return Promise.reject(new Error("RECORD_REQUEST_BUDGET"));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve, reject, timer: setTimeout(() => settle(id, undefined, new Error("RECORD_REQUEST_TIMEOUT")), 30_000) });
      if (bridge) void Promise.resolve().then(() => bridge.call(operation, payload)).then(value => settle(id, value), cause => settle(id, undefined, cause));
      else { try { parent.postMessage({ channel: "bottega:plugin-request", requestId: id, readyNonce: nonce, operation, payload }, hostOrigin === "null" ? "*" : hostOrigin!); }
        catch (cause) { settle(id, undefined, cause); } }
    });
  };
  const dispose = () => {
    stopped = true; clearInterval(heartbeat); removeEventListener("message", message); removeEventListener("pagehide", dispose);
    for (const id of pending.keys()) settle(id, undefined, new Error("RECORD_UI_CLOSED"));
  };
  addEventListener("message", message); addEventListener("pagehide", dispose, { once: true });
  try {
    const context = await call("plugin.open");
    heartbeat = setInterval(() => { if (document.visibilityState === "visible") void call("plugin.heartbeat").catch(dispose); }, 3000);
    if (bridge) bridge.post("bottega:surface:ready");
    else parent.postMessage({ channel: "bottega:plugin-ready", readyNonce: nonce }, hostOrigin === "null" ? "*" : hostOrigin!);
    return Object.freeze({
      context,
      request: (input: RecordCall) => call(input.operation, input.payload),
      close: async () => { try { await call("plugin.close"); } finally { dispose(); } },
      dispose,
    });
  } catch (cause) { dispose(); throw cause; }
}
