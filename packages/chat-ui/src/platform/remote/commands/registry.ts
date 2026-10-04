/**
 * [INPUT]: Account-fenced remote ports and immutable command sessions.
 * [OUTPUT]: Retains one command session per Chat incarnation for creation/detail handoff, dropping settled closed ones beyond the newest eight.
 * [POS]: The command folder's registry over session.ts; account changes and key disposal erase custody.
 */
import type { ChatPlatform } from "../../contracts";
import { RemoteCommandSession } from "./session";
type RetainedScope = { sessions: Map<string, RemoteCommandSession> };
const retained = new WeakMap<object, RetainedScope>();
const RETAINED_SESSIONS = 8;
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
  if (current) scope.sessions.delete(key);
  else current = new RemoteCommandSession(port, chatId);
  scope.sessions.set(key, current);
  /* Every visited Chat used to keep its session for the whole key lifetime (C-24); only settled ones beyond the newest eight go,
     so a command still waiting for its outcome stays reachable. */
  for (const [other, session] of scope.sessions) {
    if (scope.sessions.size <= RETAINED_SESSIONS) break;
    if (other !== key && session.settled()) { session.forget(); scope.sessions.delete(other); }
  }
  return current;
}
