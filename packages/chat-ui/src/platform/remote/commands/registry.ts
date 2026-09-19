/**
 * [INPUT]: Account-fenced remote ports and immutable command sessions.
 * [OUTPUT]: Retains one command session per Chat incarnation for creation/detail handoff.
 * [POS]: The command folder's registry over session.ts; account changes and key disposal erase custody.
 */
import type { ChatPlatform } from "../../contracts";
import { RemoteCommandSession } from "./session";
type RetainedScope = { sessions: Map<string, RemoteCommandSession> };
const retained = new WeakMap<object, RetainedScope>();
export function remoteCommandSession(platform: Pick<ChatPlatform, "account" | "commands">, chatId: string, incarnationId: string) {
  const port = platform.commands.remote;
  if (!port || port.lifetime?.aborted) return null;
  const cacheScope = port.cacheScope ?? port;
  let scope = retained.get(cacheScope);
  if (!scope) {
    const owner = platform.account.snapshot();
    scope = { sessions: new Map() };
    const currentScope = scope;
    let stopAccount = () => {};
    const clear = () => {
      for (const session of currentScope.sessions.values()) session.forget();
      currentScope.sessions.clear();
      if (retained.get(cacheScope) === currentScope) retained.delete(cacheScope);
      stopAccount();
      port.lifetime?.removeEventListener("abort", clear);
    };
    stopAccount = platform.account.subscribe(() => {
      const current = platform.account.snapshot();
      if (current.state === "signed-out" || current.profile?.userId !== owner.profile?.userId || current.deviceId !== owner.deviceId) clear();
    });
    port.lifetime?.addEventListener("abort", clear, { once: true });
    retained.set(cacheScope, scope);
  }
  const key = `${chatId}/${incarnationId}`;
  let current = scope.sessions.get(key);
  if (!current) {
    current = new RemoteCommandSession(port, chatId);
    scope.sessions.set(key, current);
  }
  return current;
}
