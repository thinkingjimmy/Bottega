/**
 * [INPUT]: Depends on Zod, durable JSON replacement, custody's probeProcessBirth (to record a birth) and observeProcessBirth (to prove ownership before cleanup: an unverified read is never absent) and the birth-verified cleanOwnedProcessGroup
 * [OUTPUT]: Provides DescendantRegistry (record/forget/cleanHost — keeping a newer host life's processes out, B2-03 — /reconcile over a durable journal of host-owned process groups) and DescendantRecord
 * [POS]: The registry-side owner of every process a utility host asked main to start; a record is durable before the spawn is acknowledged, so a main `kill -9` leaves a list the next start can clean by PGID + birth
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { durableReplaceFile, ensureDurableDirectory, isErrnoCode } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";
import { observeProcessBirth, probeProcessBirth, type BirthObservation, type ProcessBirth } from "../../custody/identity";
import { cleanOwnedProcessGroup, cleanProcessGroup, type CleanupResult, type OwnedCleanupResult } from "../../agent/process/process-group";

const recordSchema = z.object({ hostId: z.string().min(1).max(64), processId: z.string().min(1).max(80), pid: z.number().int().positive(),
  birthIdentity: z.string().min(1).max(128), command: z.string().max(4096), recordedAt: z.number().int().nonnegative() }).strict();
const journalSchema = z.object({ version: z.literal(1), records: z.array(recordSchema).max(4096) }).strict();
export type DescendantRecord = z.infer<typeof recordSchema>;

export type DescendantPorts = Readonly<{
  probe: (pid: number) => ProcessBirth | null;
  /** Ownership before a signal: only a read that proved the leader absent counts as absent (B2-02). */
  observe: (pid: number) => BirthObservation;
  clean: (pid: number) => Promise<CleanupResult>;
  now: () => number;
}>;

export class DescendantRegistry {
  private readonly records = new Map<string, DescendantRecord>();
  private readonly queue = new SerialQueue();
  private readonly path: string;

  constructor(userData: string, private readonly ports: DescendantPorts = { probe: probeProcessBirth, observe: observeProcessBirth, clean: cleanProcessGroup, now: Date.now }) {
    this.path = join(userData, "host", "descendants.json");
  }

  /** Loads the journal left by the previous life and cleans every group that is still provably ours. */
  async reconcile(): Promise<OwnedCleanupResult[]> {
    return this.queue.enqueue(async () => {
      let previous: DescendantRecord[] = [];
      try { previous = journalSchema.parse(JSON.parse(await readFile(this.path, "utf8"))).records; } catch (cause) {
        if (!isErrnoCode(cause, "ENOENT")) console.warn("[host] descendant journal unreadable; starting empty", cause);
      }
      const results = await Promise.all(previous.map(record => this.cleanRecord(record)));
      /* A record whose cleanup failed stays in the journal: dropping it would forget a live process. */
      this.records.clear();
      previous.forEach((record, index) => { if (!results[index]!.ok) this.records.set(record.processId, record); });
      await this.persist();
      return results;
    });
  }

  /** Durable before the caller acknowledges the spawn; a process whose birth cannot be read is refused and cleaned. */
  async record(input: { hostId: string; processId: string; pid: number; command: string }): Promise<DescendantRecord> {
    return this.queue.enqueue(async () => {
      const birth = this.ports.probe(input.pid);
      if (!birth || birth.processGroupId !== input.pid) {
        await this.ports.clean(input.pid);
        throw new Error(`host descendant ${input.pid} is not a verifiable group leader`);
      }
      const record = recordSchema.parse({ ...input, birthIdentity: birth.birthIdentity, recordedAt: this.ports.now() });
      this.records.set(record.processId, record);
      await this.persist();
      return record;
    });
  }

  /** The leader exited: its group may still hold members, so the record stays until the group is gone too. */
  async forget(processId: string): Promise<void> {
    return this.queue.enqueue(async () => {
      const record = this.records.get(processId);
      if (!record) return;
      const result = await this.cleanRecord(record);
      if (result.ok) this.records.delete(processId);
      await this.persist();
    });
  }

  /** Every record of the host except the processes a newer life of it owns (B2-03). */
  async cleanHost(hostId: string, keep: ReadonlySet<string> = new Set()): Promise<OwnedCleanupResult[]> {
    return this.queue.enqueue(async () => {
      const owned = [...this.records.values()].filter(record => record.hostId === hostId && !keep.has(record.processId));
      const results = await Promise.all(owned.map(record => this.cleanRecord(record)));
      owned.forEach((record, index) => { if (results[index]!.ok) this.records.delete(record.processId); });
      await this.persist();
      return results;
    });
  }

  list(hostId?: string) { return [...this.records.values()].filter(record => !hostId || record.hostId === hostId).map(record => ({ ...record })); }

  private cleanRecord(record: DescendantRecord) {
    return cleanOwnedProcessGroup({ pid: record.pid, birthIdentity: record.birthIdentity }, this.ports.observe, this.ports.clean);
  }

  private async persist() {
    await ensureDurableDirectory(dirname(this.path));
    await durableReplaceFile(this.path, `${JSON.stringify({ version: 1, records: [...this.records.values()] })}\n`);
  }
}
