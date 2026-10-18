/**
 * [INPUT]: Depends on the utility host's HostApi, the relayed process host, the bridge-safe quota session streams (readers/protocol.ts) and the Provider's own quota exchange from its pinned module (bridgeQuotaExchange).
 * [OUTPUT]: Provides quotaBridge(api): `open` (launch main's sealed quota plan, then initialize: Claude's control session is guarded and stays open), `read` (one exchange, answered as a result or a finite reason) and `close` (ends the session's input; main ends the process through host custody).
 * Initializing channels await custody delivery, reject cancelled control waits and cannot register again after close.
 * [POS]: The Provider half of a bridged quota read (TASK-11 D9), loaded by the bridge entry on its first quota operation so the entry's static closure stays flat. Main keeps admission, the lease, warm-channel parking, the identity and the launch; the process is main's, in host custody.
 */
import type { HostApi } from "../../host/entry";
import { quotaError, type QuotaReadResult } from "../../usage-limits/readers/common";
import { sessionStreams } from "../../usage-limits/readers/protocol";
import type { BridgeQuotaAnswer } from "../host/protocol";
import { bridgeProcessHost } from "./process-host";
import { normalizeCodex, quotaLabel } from "../../usage-limits/normalization";
import { object, QuotaReadError } from "../../usage-limits/readers/wire";
import { bridgeProtocol, bridgeQuotaExchange } from "./turn-values";

type Channel = { read(signal: AbortSignal): Promise<QuotaReadResult>; end(): void };
const refused = (cause: unknown): BridgeQuotaAnswer => {
  const error = quotaError(cause);
  return { ok: false, reason: error.reason, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) };
};

export function quotaBridge(api: HostApi) {
  const channels = new Map<string, Channel>();
  return {
    async open({ turnKey, backend }: { turnKey: string; backend: string }, refs: string[]): Promise<BridgeQuotaAnswer> {
      if (channels.has(turnKey)) return { ok: false, reason: "unavailable" };
      let ended = false, stop = () => {};
      const channel: Channel = { read: async () => { throw new QuotaReadError("unavailable"); },
        end: () => { if (!ended) { ended = true; stop(); } } };
      channels.set(turnKey, channel);
      try {
        if (bridgeProtocol(backend) === "codex-app-server") {
          const { NativeConnection } = await import("../codex/native/transport/connection");
          if (ended) throw new QuotaReadError("unavailable");
          const rpc = new NativeConnection(bridgeProcessHost(api, refs[0]!, true));
          stop = () => rpc.close();
          await rpc.initialize();
          if (ended) throw new QuotaReadError("unavailable");
          channel.read = async signal => {
            signal.throwIfAborted();
            const result = object(await rpc.request("account/read", { refreshToken: false }));
            if (result.account == null) throw new QuotaReadError("needs-auth");
            const account = object(result.account);
            if (account.type !== "chatgpt") throw new QuotaReadError("unsupported");
            return normalizeCodex(await rpc.request("account/rateLimits/read"), Date.now(), quotaLabel(account.planType));
          };
          return { ok: true };
        }
        /* The pinned Provider owns the exchange; an absent exchange cannot read quota. */
        let exchange: ReturnType<typeof bridgeQuotaExchange>;
        try { exchange = bridgeQuotaExchange(backend); } catch { throw new QuotaReadError("unsupported"); }
        const processHost = bridgeProcessHost(api, refs[0]!);
        const child = processHost.launch({ command: "sealed-plan", args: [], cwd: "/", env: {} } as never);
        const session = sessionStreams(child);
        stop = () => { session.fail(new QuotaReadError("unavailable")); session.closing(); child.stdin.end(); };
        await processHost.delivered;
        if (ended) throw new QuotaReadError("unavailable");
        const opened = await exchange(session);
        if (ended) throw new QuotaReadError("unavailable");
        channel.read = opened.read;
        return { ok: true };
      } catch (cause) {
        channel.end();
        if (channels.get(turnKey) === channel) channels.delete(turnKey);
        return refused(cause);
      }
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
