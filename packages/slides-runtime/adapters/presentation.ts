/**
 * [INPUT]: Main-issued native token/role, original app/player callbacks and the module-private local/encrypted HTTP transport.
 * [OUTPUT]: Original Present menu delegation, exact-session audience controls, actual page reports and source page/focus recovery.
 * [POS]: Trusted original Slides host seam; authored embeds have no token, callback or window authority.
 */
import { nativeFetch, nativeBase } from "../../canvas-runtime/build/transport";
import type { NativePresentationState, NativePresentationRole } from "@ai-chat/cloud-protocol/artifacts/design/native/presentation/model";
type Handlers = { start(slideId: string): void; returnTo(slideId: string): void; index(slideId: string): number };
let token: string | undefined, role: NativePresentationRole | undefined, handlers: Handlers | undefined, go: ((index: number) => void) | undefined;
const fullscreenReplies = new Map<string, (value: boolean) => void>();
let current: string | undefined, shown: NativePresentationState | undefined, timer: ReturnType<typeof setInterval> | undefined, polling = false;
const post = async (body: Record<string, unknown>, unique = false): Promise<NativePresentationState> => {
  if (!token) throw new Error("The original presentation host is unavailable");
  const data = JSON.stringify(body), sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)))].map(value => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
  const id = unique ? crypto.randomUUID() : [sha.slice(0, 8), sha.slice(8, 12), sha.slice(12, 16), sha.slice(16, 20), sha.slice(20)].join("-");
  const response = await nativeFetch(nativeBase() + "__deck/presentation", { method: "POST", headers: { "Content-Type": "application/json", "X-Bottega-Native": token, "X-Bottega-Request": "native-" + id }, body: data });
  const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "The presentation host is unavailable"); return result;
};
export function nativePresentationHandlers(value: Handlers) { handlers = value; }
export function nativePresentationPlayer(value: (index: number) => void) { go = value; }
export function nativePresentationIndex(slideId: string | undefined) {
  if (!slideId) return; current = slideId;
  const sessionId = role?.sessionId ?? (shown?.mode === "inline" ? shown.sessionId : undefined);
  if (token && sessionId) void post({ action: "changed", sessionId, slideId }).catch(() => {});
}
export function nativePresentationExit() {
  if (token && window.parent !== window) window.parent.postMessage({ type: "bottega:native:presentation-exit", token }, "*");
  const sessionId = role?.sessionId ?? shown?.sessionId;
  if (token && sessionId) void post({ action: "exit", sessionId }).catch(() => {});
}
export async function nativeMainPresentation(slideId: string | undefined, notes: boolean) {
  if (!token || role || !slideId) return undefined;
  const browserFullscreen = new Promise<boolean>(resolve => {
    const browser = (window as Window & { __bottegaNativeTransport?: unknown }).__bottegaNativeTransport;
    if (!browser || window.parent === window || !navigator.userActivation?.isActive) { resolve(false); return; }
    const requestId = crypto.randomUUID(), timeout = setTimeout(() => { fullscreenReplies.delete(requestId); resolve(false); }, 2000);
    fullscreenReplies.set(requestId, value => { clearTimeout(timeout); fullscreenReplies.delete(requestId); resolve(value); });
    window.parent.postMessage({ type: "bottega:native:presentation-fullscreen", token, requestId }, "*");
  });
  const flush = (window as Window & { __bottegaNativeBeforeExport?: () => Promise<void> }).__bottegaNativeBeforeExport;
  await flush?.();
  const state = await post({ action: "start", slideId, notes }, true); shown = state;
  clearInterval(timer);
  if (state.mode === "desktop") timer = setInterval(() => { void (async () => {
    if (polling || shown?.sessionId !== state.sessionId) return; polling = true;
    try { const next = await post({ action: "status", sessionId: state.sessionId }); if (next.closed) { clearInterval(timer); handlers?.returnTo(next.slideId); shown = undefined; } }
    catch { clearInterval(timer); } finally { polling = false; }
  })(); }, 500);
  const fullscreen = await browserFullscreen;
  if (state.mode === "inline") { shown = { ...state, fullscreen, reason: fullscreen ? undefined : "Fullscreen is not available in this browser. Use the inline presentation and speaker notes panel." }; return shown; }
  return state;
}
export function installNativePresentationRuntime() {
  token = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content;
  const metadata = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-presentation"]');
  if (metadata?.content) { role = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(metadata.content), char => char.charCodeAt(0)))); metadata.remove(); }
  if (!token) return;
  window.addEventListener("message", event => {
    if (!event.isTrusted || event.source !== window.parent || event.data?.token !== token) return;
    if (event.data.type === "bottega:native:presentation-fullscreen-result" && typeof event.data.fullscreen === "boolean") fullscreenReplies.get(event.data.requestId)?.(event.data.fullscreen);
    if (event.data.type === "bottega:native:presentation-ended" && shown?.mode === "inline") { nativePresentationExit(); handlers?.returnTo(current ?? shown.slideId); shown = undefined; }
  });
  if (!role) return;
  Object.defineProperty(window, "__bottegaNativePresentationCurrent", { value: (proof: string, sessionId: string) => proof === token && sessionId === role?.sessionId ? current : undefined });
  Object.defineProperty(window, "__bottegaNativePresentationControl", { value: async (proof: string, input: { action: "start" | "navigate"; sessionId: string; slideId: string }) => {
    if (proof !== token || input.sessionId !== role?.sessionId) throw new Error("The original player belongs to another presentation");
    const until = Date.now() + 10000;
    while ((!handlers || handlers.index(input.slideId) < 0 || input.action === "navigate" && !go) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 40));
    if (!handlers || handlers.index(input.slideId) < 0) throw new Error("The original presentation page is unavailable");
    if (input.action === "start") {
      handlers.start(input.slideId);
      while (!document.querySelector('[role="dialog"][aria-label="Slide presentation"]') && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 40));
      if (!document.querySelector('[role="dialog"][aria-label="Slide presentation"]')) throw new Error("The original presentation surface did not mount");
    }
    else if (input.action === "navigate" && go) go(handlers.index(input.slideId));
    else throw new Error("The original presentation control is unavailable");
    current = input.slideId;
  } });
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
}

export const nativePresentationFallback = () => shown?.mode === "inline" && !shown.fullscreen ? shown.reason : undefined;
