/**
 * [INPUT]: Depends on Node fs/promises and the shared BackendModelInfo/AgentBackendId vocabulary
 * [OUTPUT]: Provides ModelCatalogPersistence, PersistedModelCatalog and ModelCatalogStore — one bounded JSON file, atomic writes, exact and newest-of-prefix reads, corrupt content ignored
 * [POS]: The durable half of backends/model-catalog; the catalog owns freshness policy, this file owns bytes and nothing else
 */

import { rename, readFile, unlink, writeFile } from "node:fs/promises";
import type {
  AgentBackendId,
  BackendModelInfo,
} from "../../../shared/agent-ipc";

export type PersistedModelCatalog = {
  models: BackendModelInfo[];
  savedAt: number;
};

export type ModelCatalogPersistence = {
  read(
    backend: AgentBackendId,
    key: string
  ): Promise<PersistedModelCatalog | null>;
  /** Newest entry of this backend whose key starts with the prefix; the catalog owns the age rule. */
  readNewest(
    backend: AgentBackendId,
    keyPrefix: string
  ): Promise<PersistedModelCatalog | null>;
  write(
    backend: AgentBackendId,
    key: string,
    entry: PersistedModelCatalog
  ): Promise<void>;
  /** Recheck/login return must force a real read: the whole backend goes, not one key. */
  clear(backend: AgentBackendId): Promise<void>;
};

/* Four backends times a handful of workspaces: 32 covers the projects a user
   actually switches between while capping what a cold start has to parse. */
const ENTRY_LIMIT = 32;
const FILE_BYTE_LIMIT = 4 * 1024 * 1024;
const MODEL_LIMIT = 512;
const STORE_VERSION = 1;

type StoredEntry = PersistedModelCatalog & {
  backend: string;
  key: string;
};

const identity = (backend: string, key: string) => `${backend}\u0000${key}`;

function readModel(value: unknown): BackendModelInfo | null {
  const model = value as Partial<BackendModelInfo> | null;
  if (
    !model ||
    typeof model !== "object" ||
    typeof model.slug !== "string" ||
    !model.slug ||
    typeof model.displayName !== "string" ||
    typeof model.isDefault !== "boolean"
  ) {
    return null;
  }
  return model as BackendModelInfo;
}

/* The cache file is ordinary user-writable state, so it is parsed like any
   other foreign input: a malformed entry is dropped instead of reaching the
   model selector, and it never takes the healthy entries down with it. */
function readEntry(value: unknown): StoredEntry | null {
  const entry = value as Partial<StoredEntry> | null;
  if (
    !entry ||
    typeof entry !== "object" ||
    typeof entry.backend !== "string" ||
    typeof entry.key !== "string" ||
    typeof entry.savedAt !== "number" ||
    !Number.isFinite(entry.savedAt) ||
    !Array.isArray(entry.models) ||
    entry.models.length === 0 ||
    entry.models.length > MODEL_LIMIT
  ) {
    return null;
  }
  const models: BackendModelInfo[] = [];
  for (const raw of entry.models) {
    const model = readModel(raw);
    if (!model) return null;
    models.push(model);
  }
  return {
    backend: entry.backend,
    key: entry.key,
    savedAt: entry.savedAt,
    models,
  };
}

export class ModelCatalogStore implements ModelCatalogPersistence {
  private entries: Promise<Map<string, StoredEntry>> | null = null;
  /* Every catalog writes into the same file, so mutations queue: a later write
     can never render on a map an earlier one already replaced on disk. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly limit = ENTRY_LIMIT
  ) {}

  async read(backend: AgentBackendId, key: string) {
    const entry = (await this.load()).get(identity(backend, key));
    return entry ? { models: entry.models, savedAt: entry.savedAt } : null;
  }

  async readNewest(backend: AgentBackendId, keyPrefix: string) {
    let newest: StoredEntry | undefined;
    for (const entry of (await this.load()).values()) {
      if (entry.backend !== backend || !entry.key.startsWith(keyPrefix)) {
        continue;
      }
      if (!newest || entry.savedAt > newest.savedAt) newest = entry;
    }
    return newest ? { models: newest.models, savedAt: newest.savedAt } : null;
  }

  async write(
    backend: AgentBackendId,
    key: string,
    entry: PersistedModelCatalog
  ) {
    await this.mutate((entries) => {
      entries.set(identity(backend, key), { backend, key, ...entry });
      if (entries.size <= this.limit) return true;
      /* savedAt doubles as use recency: a served stale entry always schedules
         the refresh that rewrites it, so the oldest stamp is the coldest key. */
      const evicted = [...entries.entries()]
        .sort(([, left], [, right]) => left.savedAt - right.savedAt)
        .slice(0, entries.size - this.limit);
      for (const [id] of evicted) entries.delete(id);
      return true;
    });
  }

  async clear(backend: AgentBackendId) {
    await this.mutate((entries) => {
      let changed = false;
      for (const [id, entry] of entries) {
        if (entry.backend !== backend) continue;
        entries.delete(id);
        changed = true;
      }
      return changed;
    });
  }

  private load() {
    return (this.entries ??= this.parse());
  }

  private async parse() {
    const entries = new Map<string, StoredEntry>();
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch {
      return entries;
    }
    if (Buffer.byteLength(content, "utf8") > FILE_BYTE_LIMIT) return entries;
    try {
      const parsed = JSON.parse(content) as {
        version?: number;
        entries?: unknown[];
      };
      if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.entries)) {
        return entries;
      }
      for (const raw of parsed.entries) {
        const entry = readEntry(raw);
        if (entry) entries.set(identity(entry.backend, entry.key), entry);
      }
    } catch {
      /* Corrupt bytes are the same event as a missing file: start empty and let
         the next successful read rewrite the whole thing. */
      entries.clear();
    }
    return entries;
  }

  private mutate(apply: (entries: Map<string, StoredEntry>) => boolean) {
    const task = this.queue.then(async () => {
      const entries = await this.load();
      if (!apply(entries)) return;
      await this.flush(entries);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async flush(entries: Map<string, StoredEntry>) {
    const payload = JSON.stringify({
      version: STORE_VERSION,
      entries: [...entries.values()],
    });
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
