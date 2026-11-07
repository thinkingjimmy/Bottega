/**
 * [INPUT]: Native thread RPC, frozen current policy and main-sealed member or background continuation source.
 * [OUTPUT]: openNativeThread with independent member identity and definite-unsupported-only canonical fallback.
 * [POS]: Native session opening; member history copy and same-Chat background replacement remain separate authorities.
 */
import type { NativeConnection } from "../transport/connection";
import type { NativeTurnConfig } from "../policy/parameters";
import { nativeRecord } from "../transport/record";
export async function openNativeThread(rpc: Pick<NativeConnection, "request">, thread: Omit<NativeTurnConfig["thread"], "config"> & { config?: Record<string, unknown> | null },
  candidate?: string, continuation?: NativeTurnConfig["continuation"], memberSource?: string,
  missing: (cause: unknown, id: string) => boolean = () => false) {
  if (memberSource && (candidate || continuation)) throw new Error("Member fork cannot resume or replace another session");
  let forked = Boolean(memberSource);
  let response: Record<string, unknown>;
  try {
    response = nativeRecord(await rpc.request(continuation || memberSource ? "thread/fork" : candidate ? "thread/resume" : "thread/start",
      { ...thread, ...(continuation ? { ...continuation, excludeTurns: true } : memberSource || candidate ? { threadId: memberSource ?? candidate, excludeTurns: true } : {}) }, { timeoutMs: 20_000 }));
  } catch (cause) {
    if (!memberSource || ((cause as { code?: number })?.code !== -32601 && !missing(cause, memberSource))) throw cause;
    response = nativeRecord(await rpc.request("thread/start", thread, { timeoutMs: 20_000 })); forked = false;
  }
  const id = nativeRecord(response.thread).id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
    (candidate && !continuation && id !== candidate) || id === continuation?.threadId || id === memberSource)
    throw new Error("Invalid native thread identity");
  return { response, forked };
}
