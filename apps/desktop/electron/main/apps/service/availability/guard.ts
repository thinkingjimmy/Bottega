/**
 * [INPUT]: App enabled/preset identity and typed product failures.
 * [OUTPUT]: Shared execution refusal, synchronous durable-disable fence and explicit retired Design preset exclusion.
 * [POS]: Every App launch and turn admission uses this main-owned availability boundary.
 */
import { agentRuntimeFailure, ProductFailureError } from "@ai-chat/cloud-protocol/chats/content/failure";
const closing = new Set<string>();
type App = { id?: string; enabled?: boolean; presetId?: string };
export const isRetiredApp = (app: App | null | undefined) => app?.presetId === "design-canvas";
export function isAppEnabled(app: App | null | undefined): boolean {
  return Boolean(app && !isRetiredApp(app) && app.enabled !== false && (!app.id || !closing.has(app.id)));
}
export function assertAppEnabled(app: App | null | undefined) {
  if (!app) throw Object.assign(new Error("app-not-found"), { code: "app-not-found", status: 404 });
  if (!isAppEnabled(app)) throw Object.assign(new ProductFailureError(agentRuntimeFailure("app-disabled")), { code: "app-disabled", message: "app-disabled", status: 423 });
}
/** Held from confirmation validation until all cancellation effects settle; a failed write releases it. */
export function fenceAppDisable(appId: string) {
  if (closing.has(appId)) throw new Error("app-transitioning");
  closing.add(appId);
  return () => { closing.delete(appId); };
}
