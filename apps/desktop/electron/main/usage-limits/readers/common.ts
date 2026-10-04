/**
 * [INPUT]: Depends on quota DTOs, runtime identity and temporary-directory primitives.
 * [OUTPUT]: Provides reader ports and channel ports (both told which Provider they read for), QuotaHook (a Provider's quota support on its main-only BackendDescriptor, with its live route and the file that sets it), the channel's one-shot adapter, finite errors (with the origin of a verdict: the provider's read or the registry's snapshot) and disposable query workspaces.
 * [POS]: Shared reader boundary; provider diagnostics never cross IPC.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import type { ResolvedRuntime } from "../../backends/types";
import { object, QuotaReadError, type QuotaReadResult } from "./wire";
/* The pure half lives in wire.ts (a bridge module may require nothing); main's readers import it from here as before. */
export { object, QuotaReadError, quotaError, whenAborted, type QuotaReadResult, type QuotaVerdictOrigin } from "./wire";
export type QuotaReader = (backend: AgentBackendId, runtime: ResolvedRuntime, signal: AbortSignal) => Promise<QuotaReadResult>;
/* A channel is the same reader process kept open across reads: opening it is the slow part
   (Kimi 4.3s, Claude 2.5s), reading it is one HTTP round trip. Its lifetime belongs to the
   pool in ../channel.ts, never to a single read. */
export type QuotaChannel = { read(signal: AbortSignal): Promise<QuotaReadResult>; close(): Promise<void> };
export type QuotaChannelOpener = (backend: AgentBackendId, runtime: ResolvedRuntime, signal: AbortSignal) => Promise<QuotaChannel>;
/**
 * A Provider's quota support, carried by its main-only BackendDescriptor (TASK-13 B); a Provider without one has no quota.
 * The id is passed in, so the Provider's own module never names it.
 */
export type QuotaHook = Readonly<{
  /** "bridged": main launches the reader sealed for host custody and the Provider's bridge speaks the protocol. "main": the
      read carries a bearer or API key main holds, which a bridge must not (Kimi, OpenCode: the named exception). */
  kind: "bridged" | "main";
  read: QuotaReader;
  /** Only where the process itself is the cost of a read, so keeping it warm pays (Claude's CLI 2.5 s, `kimi web` 4.3 s). */
  channel?: QuotaChannelOpener;
  /** Account identity the runtime snapshot does not carry (a home directory, a credential file); part of the read's key. */
  identity?(): Promise<unknown>;
  /** The reader cannot tell "logged out" from "no limits on this plan", so a read first waits out an inconclusive sign-in check. */
  authBlind?: true;
  /** Where requests go, read now (not from the last sign-in check): a custom route has no account limits. */
  route?(runtime: ResolvedRuntime): Promise<"official" | "custom">;
  /** The file that sets a custom route, for the person to change. */
  routeConfig?(runtime: ResolvedRuntime): string;
}>;
/** The cold path of a channel-backed reader: one read, then the process goes. A close that fails has already locked the Agent
    (its cleanup reported), so it must not also replace a reading that arrived. */
export function readOnce(open: QuotaChannelOpener): QuotaReader {
  return async (backend, runtime, signal) => {
    const channel = await open(backend, runtime, signal);
    try { return await channel.read(signal); }
    finally { await channel.close().catch(() => undefined); }
  };
}
export async function openQuotaWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), "bottega-quota-"));
  return { cwd, release: () => rm(cwd, { recursive: true, force: true }) };
}
export async function boundedJson(response: Response) {
  if (!response.body) throw new QuotaReadError("invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1024 * 1024) throw new QuotaReadError("invalid-response");
      chunks.push(chunk.value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { throw new QuotaReadError("invalid-response"); }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
