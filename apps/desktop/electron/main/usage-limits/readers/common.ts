/**
 * [INPUT]: Depends on quota DTOs, runtime identity and temporary-directory primitives.
 * [OUTPUT]: Provides reader ports, finite errors and disposable query workspaces.
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
export async function inQuotaWorkspace<T>(action: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "bottega-quota-"));
  try { return await action(cwd); }
  finally { await rm(cwd, { recursive: true, force: true }); }
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
