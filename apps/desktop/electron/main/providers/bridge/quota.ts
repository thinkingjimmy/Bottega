/**
 * [INPUT]: Depends on the utility host's HostApi, the relayed process host, the bridge-safe quota session streams (readers/protocol.ts) and the Provider's own quota exchange from its pinned module (bridgeQuotaExchange).
 * [OUTPUT]: Provides quotaBridge(api): `open` (launch main's sealed quota plan, then initialize: Claude's control session is guarded and stays open), `read` (one exchange, answered as a result or a finite reason) and `close` (ends the session's input; main ends the process through host custody).
 * [POS]: The Provider half of a bridged quota read (TASK-11 D9), loaded by the bridge entry on its first quota operation so the entry's static closure stays flat. Main keeps admission, the lease, warm-channel parking, the identity and the launch; the process is main's, in host custody.
 */
import type { HostApi } from "../../host/entry";
import { quotaError, type QuotaReadResult } from "../../usage-limits/readers/common";
import { sessionStreams } from "../../usage-limits/readers/protocol";
import type { BridgeQuotaAnswer } from "../host/protocol";
import { bridgeProcessHost } from "./process-host";
import { bridgeQuotaExchange } from "./turn-values";

type Channel = { read(signal: AbortSignal): Promise<QuotaReadResult>; end(): void };
const refused = (cause: unknown): BridgeQuotaAnswer => {
  const error = quotaError(cause);
  return { ok: false, reason: error.reason, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) };
};

export function quotaBridge(api: HostApi) {
  const channels = new Map<string, Channel>();
  return {
    async open({ turnKey, backend }: { turnKey: string; backend: string }, refs: string[]): Promise<BridgeQuotaAnswer> {
      /* The exchange is the Provider's own, from its pinned module; one without it cannot read quota (as before: unsupported). */
      let exchange: ReturnType<typeof bridgeQuotaExchange>;
      try { exchange = bridgeQuotaExchange(backend); } catch { return { ok: false, reason: "unsupported" }; }
      const child = bridgeProcessHost(api, refs[0]!).launch({ command: "sealed-plan", args: [], cwd: "/", env: {} } as never);
      const session = sessionStreams(child);
      const end = () => { session.closing(); child.stdin.end(); };
      try {
        const opened = await exchange(session);
        channels.set(turnKey, { read: opened.read, end });
        return { ok: true };
      } catch (cause) { end(); return refused(cause); }
    },
    async read({ turnKey }: { turnKey: string }): Promise<BridgeQuotaAnswer> {
      const channel = channels.get(turnKey);
      if (!channel) return { ok: false, reason: "unavailable" };
      try { return { ok: true, result: await channel.read(new AbortController().signal) }; }
      catch (cause) { return refused(cause); }
    },
    close({ turnKey }: { turnKey: string }) {
      channels.get(turnKey)?.end();
      channels.delete(turnKey);
      return null;
    },
  };
}
