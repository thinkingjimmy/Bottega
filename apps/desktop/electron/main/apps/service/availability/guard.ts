/**
 * [INPUT]: Depends on the App record's independent enabled flag and typed product failures.
 * [OUTPUT]: Provides the shared App execution guard and a synchronous fence during durable disable.
 * [POS]: Every App launch and turn admission uses this main-owned availability boundary.
 */
import { agentRuntimeFailure, ProductFailureError } from "@ai-chat/cloud-protocol/chats/content/failure";
const closing = new Set<string>();
type App = { id?: string; enabled?: boolean };
export function isAppEnabled(app: App | null | undefined): boolean {
  return Boolean(app && app.enabled !== false && (!app.id || !closing.has(app.id)));
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
