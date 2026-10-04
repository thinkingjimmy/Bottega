/**
 * [INPUT]: Depends on a quota session's streams, the bounded JSON-RPC and Claude control clients with the control-only input guard, and quota normalization — all pure (wire.ts, protocol.ts, ../normalization.ts): no Node built-in, no zod.
 * [OUTPUT]: Provides codexQuotaExchange (initialize, account/read, account/rateLimits/read, normalized) and codexQuotaSession, openClaudeQuotaControl (a guarded, initialized control session whose every read is one `get_usage`), and the QuotaExchange type the bridge modules export.
 * [POS]: The Provider half of the Codex and Claude quota readers (no launch, no admission, no process): it runs on the Provider bridge over the relayed child main started in host custody, carried by that Provider's pinned bridge module (quotaExchange), so it must stay pure.
 */
import { normalizeClaude, normalizeCodex, quotaLabel } from "../normalization";
import { object, QuotaReadError, whenAborted, type QuotaReadResult } from "./wire";
import { claudeControl, guardClaudeControlInput, jsonRpc, type QuotaStreams } from "./protocol";

export async function codexQuotaExchange(session: QuotaStreams): Promise<QuotaReadResult> {
  const rpc = jsonRpc(session);
  await rpc.request("initialize", { clientInfo: { name: "bottega_usage", version: "1.0.0" } });
  rpc.initialized();
  const result = object(await rpc.request("account/read", { refreshToken: false }));
  if (result.account === null) throw new QuotaReadError("needs-auth");
  const account = object(result.account);
  if (account.type !== "chatgpt") throw new QuotaReadError("unsupported");
  return normalizeCodex(await rpc.request("account/rateLimits/read"), Date.now(), quotaLabel(account.planType));
}

/* The input guard admits only control requests, so no model prompt can reach this process wherever it runs. */
export async function openClaudeQuotaControl(session: QuotaStreams, signal?: AbortSignal) {
  guardClaudeControlInput(session.child);
  const control = claudeControl(session);
  const initialize = control.request({ subtype: "initialize", systemPrompt: [""] });
  await (signal ? Promise.race([initialize, whenAborted(signal)]) : initialize);
  return {
    async read(readSignal: AbortSignal): Promise<QuotaReadResult> {
      return normalizeClaude(await session.race(Promise.race([control.request({ subtype: "get_usage" }), whenAborted(readSignal)])), Date.now());
    },
  };
}

/** A Provider's quota exchange on its bridge: open one session, then read it (TASK-13 B2). Each Provider's pinned bridge module
    exports its own as `quotaExchange` (providers/bridge/modules/<id>.ts); no table here names a Provider. */
export type QuotaExchange = (session: QuotaStreams) => Promise<{ read(signal: AbortSignal): Promise<QuotaReadResult> }>;
/** Codex answers once per session. */
export const codexQuotaSession: QuotaExchange = async (session) => ({ read: () => codexQuotaExchange(session) });
