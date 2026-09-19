/**
 * [INPUT]: Depends on Node fs/promises, Zod, the closed Agent order and the shared quota DTO schema.
 * [OUTPUT]: Provides QuotaSnapshotPersistence, QuotaSnapshotRecord and QuotaSnapshotStore — one bounded JSON file, atomic writes, corrupt or expired content ignored.
 * [POS]: The durable half of usage-limits/service; the service owns freshness, identity and demand, this file owns bytes and nothing else.
 */
import { rename, readFile, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import { agentUsageLimitsSchema, quotaPoolSchema } from "@ai-chat/cloud-protocol/remote/quota";
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../shared/agent-ipc";

/* Only the numbers a selector can render survive a restart. Reason codes, identity and
   scope keys, account labels and reader diagnostics stay in memory: a cache that outlives
   the process must not be able to answer "which account" or "which CLI" after the fact. */
const recordSchema = z.object({
  backend: z.enum(AGENT_BACKEND_ORDER),
  pools: z.array(quotaPoolSchema).max(16),
  planLabel: agentUsageLimitsSchema.shape.planLabel,
  /* Unwrapped from the DTO so a renamed source or a widened time can never be read back
     as a valid cache entry. */
  source: agentUsageLimitsSchema.shape.source.unwrap(),
  receivedAt: agentUsageLimitsSchema.shape.receivedAt.unwrap(),
}).strict();
const storedSchema = recordSchema.extend({ savedAt: agentUsageLimitsSchema.shape.receivedAt.unwrap() }).strict();
const fileSchema = z.object({ version: z.literal(1), entries: z.array(z.unknown()).max(AGENT_BACKEND_ORDER.length) }).strict();
export type QuotaSnapshotRecord = z.infer<typeof recordSchema>;
type StoredRecord = z.infer<typeof storedSchema>;
export type QuotaSnapshotPersistence = {
  load(): Promise<QuotaSnapshotRecord[]>;
  save(record: QuotaSnapshotRecord): Promise<void>;
  /** Identity change or terminal failure withdraws the whole Agent, not one pool. */
  clear(backend: AgentBackendId): Promise<void>;
};
/* Four Agents with at most sixteen pools each; anything larger is not this file. */
const FILE_BYTE_LIMIT = 512 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const STORE_VERSION = 1;

export class QuotaSnapshotStore implements QuotaSnapshotPersistence {
  private entries: Promise<Map<AgentBackendId, StoredRecord>> | null = null;
  /* One file for every Agent, so mutations queue: a later write can never render a map
     an earlier one already replaced on disk. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly now: () => number = Date.now) {}

  async load() {
    return [...(await this.cache()).values()].map(({ savedAt: _savedAt, ...record }) => record);
  }

  async save(record: QuotaSnapshotRecord) {
    await this.mutate((entries) => {
      entries.set(record.backend, { ...record, savedAt: this.now() });
      return true;
    });
  }

  async clear(backend: AgentBackendId) {
    await this.mutate((entries) => entries.delete(backend));
  }

  private cache() {
    return (this.entries ??= this.parse());
  }

  /* The cache file is ordinary user-writable state, so it is parsed like any other foreign
     input: a malformed or expired entry is dropped instead of reaching a selector, and it
     never takes the healthy entries down with it. */
  private async parse() {
    const entries = new Map<AgentBackendId, StoredRecord>();
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch {
      return entries;
    }
    if (Buffer.byteLength(content, "utf8") > FILE_BYTE_LIMIT) return entries;
    let parsed: z.infer<typeof fileSchema>;
    try {
      parsed = fileSchema.parse(JSON.parse(content));
    } catch {
      return entries;
    }
    for (const raw of parsed.entries) {
      const entry = storedSchema.safeParse(raw);
      if (!entry.success || this.now() - entry.data.savedAt >= MAX_AGE_MS) continue;
      entries.set(entry.data.backend, entry.data);
    }
    return entries;
  }

  private mutate(apply: (entries: Map<AgentBackendId, StoredRecord>) => boolean) {
    const task = this.queue.then(async () => {
      const entries = await this.cache();
      if (!apply(entries)) return;
      await this.flush(entries);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async flush(entries: Map<AgentBackendId, StoredRecord>) {
    const payload = JSON.stringify({ version: STORE_VERSION, entries: [...entries.values()] });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, payload, { mode: 0o600 });
      await rename(temporary, this.filePath);
    } catch (cause) {
      await unlink(temporary).catch(() => undefined);
      throw cause;
    }
  }
}
