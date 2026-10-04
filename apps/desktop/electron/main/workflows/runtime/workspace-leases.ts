/**
 * [INPUT]: Depends on DurableJson, Zod and node fs/path for the canonical workspace path.
 * [OUTPUT]: Provides WorkspaceLeases (one durable writer lease per canonical workspace: acquire for a run's writing step, holder, release, releaseRun, list) and canonicalWorkspace.
 * [POS]: review-0926 A-07 (2-design §553): two records of one Project never develop in the same workspace at once. The executor acquires before a writing step's attempt, holds through cleanup and evidence, and releases only on positive evidence; startup settles leftovers against custody.
 */
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";

const leaseSchema = z.object({ key: z.string().min(1).max(4_096), runId: z.string().min(1).max(128), stepId: z.string().min(1).max(128), since: z.number().int() }).strict();
const fileSchema = z.object({ schemaVersion: z.literal(1), leases: z.array(leaseSchema).max(1_024) }).strict();
export type WorkspaceLease = z.infer<typeof leaseSchema>;

/** The workspace as the file system names it, so two spellings of one folder share one lease. */
export function canonicalWorkspace(path: string) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

export class WorkspaceLeases {
  private readonly file: DurableJson<z.infer<typeof fileSchema>>;
  constructor(root: string) {
    this.file = new DurableJson(join(root, "workspace-leases.json"), fileSchema, () => ({ schemaVersion: 1, leases: [] }));
  }
  initialize() { return this.file.initialize(); }
  closeAndFlush() { return this.file.closeAndFlush(); }
  list(): readonly WorkspaceLease[] { return this.file.snapshot().leases; }
  holder(key: string) { return this.list().find(lease => lease.key === key)?.runId ?? null; }
  /** Durable before the writer starts. True when the workspace was free or this run already holds it; the holder otherwise. */
  acquire(key: string, runId: string, stepId: string, now: number): Promise<true | string> {
    return this.file.mutate(state => {
      const held = state.leases.find(lease => lease.key === key);
      if (held && held.runId !== runId) return held.runId;
      if (!held) state.leases.push({ key, runId, stepId, since: now });
      return true as const;
    });
  }
  /** Every lease a run holds, whatever workspace (its Project is gone). */
  releaseRun(runId: string) {
    return this.file.mutate(state => { state.leases = state.leases.filter(lease => lease.runId !== runId); });
  }
  release(key: string, runId: string) {
    return this.file.mutate(state => { state.leases = state.leases.filter(lease => lease.key !== key || lease.runId !== runId); });
  }
}
