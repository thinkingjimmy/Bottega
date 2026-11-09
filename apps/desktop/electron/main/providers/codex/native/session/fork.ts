/**
 * [INPUT]: Native thread RPC, frozen current policy and main-sealed member or background continuation source.
 * [OUTPUT]: openNativeThread with independent member identity and definite-unsupported-only canonical fallback.
 * [POS]: Native session opening; member history copy and same-Chat background replacement remain separate authorities.
 */
import type { NativeConnection } from "../transport/connection";
import type { NativeTurnConfig } from "../policy/parameters";
import { nativeRecord } from "../transport/record";
export async function openNativeThread(rpc: Pick<NativeConnection, "request">,
  thread: Omit<NativeTurnConfig["thread"], "config"> & { config?: Record<string, unknown> | null },
  candidate?: string, continuation?: NativeTurnConfig["continuation"]) {
  const response = nativeRecord(await rpc.request(continuation ? "thread/fork" : candidate ? "thread/resume" : "thread/start",
    { ...thread, ...(continuation ? { ...continuation, excludeTurns: true } : candidate ? { threadId: candidate, excludeTurns: true } : {}) },
    { timeoutMs: 20_000 }));
  const id = nativeRecord(response.thread).id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
    (candidate && !continuation && id !== candidate) || id === continuation?.threadId)
    throw new Error("Invalid native thread identity");
  return response;
}
