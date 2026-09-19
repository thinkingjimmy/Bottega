/**
 * [INPUT]: Depends on quota DTOs, runtime identity and temporary-directory primitives.
 * [OUTPUT]: Provides reader ports, channel ports and their one-shot adapter, finite errors and disposable query workspaces.
 * [POS]: Shared reader boundary; provider diagnostics never cross IPC.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentQuotaPool, QuotaReason, QuotaSource } from "../../../../shared/usage-limits/types";
import type { ResolvedRuntime } from "../../backends/types";
export type QuotaReadResult = { source: QuotaSource; pools: AgentQuotaPool[]; planLabel: string | null; receivedAt: number };
export type QuotaReader = (runtime: ResolvedRuntime, signal: AbortSignal) => Promise<QuotaReadResult>;
export class QuotaReadError extends Error {
  constructor(readonly reason: QuotaReason, readonly retryAfterMs?: number) { super(reason); }
}
export function quotaError(cause: unknown): QuotaReadError {
  if (cause instanceof QuotaReadError) return cause;
  return new QuotaReadError("unavailable");
}
/* A channel is the same reader process kept open across reads: opening it is the slow part
   (Kimi 4.3s, Claude 2.5s), reading it is one HTTP round trip. Its lifetime belongs to the
   pool in ../channel.ts, never to a single read. */
export type QuotaChannel = { read(signal: AbortSignal): Promise<QuotaReadResult>; close(): Promise<void> };
export type QuotaChannelOpener = (runtime: ResolvedRuntime, signal: AbortSignal) => Promise<QuotaChannel>;
/** The cold path of a channel-backed reader: one read, then the process goes. */
export function readOnce(open: QuotaChannelOpener): QuotaReader {
  return async (runtime, signal) => {
    const channel = await open(runtime, signal);
    try { return await channel.read(signal); }
    finally { await channel.close(); }
  };
}
export async function openQuotaWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), "bottega-quota-"));
  return { cwd, release: () => rm(cwd, { recursive: true, force: true }) };
}
export async function inQuotaWorkspace<T>(action: (cwd: string) => Promise<T>): Promise<T> {
  const workspace = await openQuotaWorkspace();
  try { return await action(workspace.cwd); }
  finally { await workspace.release(); }
}
/* A read may be cancelled without the channel being closed, so the caller's signal is raced
   rather than wired into the process: only the pool decides that the process goes. */
export function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QuotaReadError("invalid-response");
  return value as Record<string, unknown>;
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
