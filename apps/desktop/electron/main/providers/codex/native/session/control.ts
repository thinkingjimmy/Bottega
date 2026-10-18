/**
 * [INPUT]: Uses HostApi, the sealed bridge process host and bounded native RPC.
 * [OUTPUT]: Exports nativeControl for model-free readiness, paginated catalogs and cancellation.
 * [POS]: Lazy native control lane; ACP bridge startup does not load native query code.
 */
import type { HostApi } from "../../../../host/entry";
import { bridgeProcessHost, killProcessHost } from "../../../bridge/process-host";
import { NativeConnection } from "../transport/connection";
export function nativeControl(api: HostApi) {
  const queries = new Map<string, NativeConnection>();
  return {
    async models(turnKey: string, refs: string[]) {
      const host = bridgeProcessHost(api, refs[0]!, true), rpc = new NativeConnection(host);
      queries.set(turnKey, rpc);
      try {
        await rpc.initialize();
        const result: unknown[] = [], seen = new Set<string>(); let cursor: string | null = null;
        do {
          const page: { data: unknown[]; nextCursor: string | null } = await rpc.request("model/list", { limit: 64, cursor });
          if (!Array.isArray(page.data) || result.length + page.data.length > 128) throw new Error("Native model directory exceeds its budget");
          result.push(...page.data); cursor = page.nextCursor;
          if (cursor !== null && (typeof cursor !== "string" || seen.has(cursor))) throw new Error("Invalid native model cursor");
          if (cursor) seen.add(cursor);
        } while (cursor);
        return result;
      } finally { queries.delete(turnKey); rpc.close(); await killProcessHost(host)(); }
    },
    cancel(turnKey: string) { queries.get(turnKey)?.close(); },
    async readiness(refs: string[]) {
      const host = bridgeProcessHost(api, refs[0]!, true), rpc = new NativeConnection(host);
      try {
        await rpc.initialize();
        const listed = await rpc.request<{ data: unknown[] }>("thread/list", { limit: 1 });
        if (!Array.isArray(listed.data)) throw new Error("Native readiness returned an invalid thread list");
        return { ok: true, pid: rpc.pid ?? null, sessions: listed.data.length, steering: true };
      } finally { rpc.close(); await killProcessHost(host)(); }
    },
  };
}
