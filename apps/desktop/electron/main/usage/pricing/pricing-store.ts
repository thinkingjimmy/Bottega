/**
 * [INPUT]: Depends on Node fs/path, catalog, conversion/overlay, built-in seed and pricing
 * [OUTPUT]: Provides PricingStore: synchronous reading tables, local seed, migration, 24h network refresh, double abstract persistence, revision, push and epoch drain
 * [POS]: The only IO/lifecycle owner of usage/pricing; Failure to maintain, close and reopen strict isolation
 */

import { readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  catalogDigest,
  convertModelsDev,
  overlayCatalog,
  parsePricingCatalog,
  seedWinsOverlay,
  stableDigest,
  tableDigest,
  type PricingCatalog,
} from "./catalog";
import { seedCatalog, seedSourceDigest } from "./model-pricing.data";
import { buildTable, type PricingTable } from "./pricing";

const CACHE_VERSION = 1;
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_RETRY_MS = 60 * 60_000;
const API_URL = "https://models.dev/api.json";

type CacheFile = {
  version: 1;
  seedDigest: string;
  catalogDigest: string;
  sourceDigest: string;
  fetchedAt: number;
  catalog: PricingCatalog;
};

export type PricingStoreOptions = {
  fetchJson?: () => Promise<unknown>;
  now?: () => number;
  ttlMs?: number;
  retryMs?: number;
  refreshEnabled?: () => boolean;
  onTableChanged?: (update: {
    table: PricingTable;
    revision: number;
  }) => void;
};

function seedDigest() {
  return stableDigest({ seedCatalog, seedSourceDigest });
}

function validCache(value: unknown): CacheFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<CacheFile>;
  if (
    item.version !== CACHE_VERSION ||
    typeof item.seedDigest !== "string" ||
    typeof item.catalogDigest !== "string" ||
    typeof item.sourceDigest !== "string" ||
    typeof item.fetchedAt !== "number" ||
    !Number.isFinite(item.fetchedAt) ||
    !item.catalog
  ) {
    return null;
  }
  try {
    const catalog = parsePricingCatalog(item.catalog);
    if (catalogDigest(catalog, item.sourceDigest) !== item.catalogDigest) {
      return null;
    }
    return { ...item, catalog } as CacheFile;
  } catch {
    return null;
  }
}

async function defaultFetchJson() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(API_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export class PricingStore {
  private readonly path: string;
  private readonly fetchJson: () => Promise<unknown>;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly retryMs: number;
  private readonly refreshEnabled: () => boolean;
  private readonly onTableChanged?: PricingStoreOptions["onTableChanged"];
  private catalog: PricingCatalog;
  private table: PricingTable;
  private tableHash: string;
  private catalogHash: string;
  private sourceHash: string;
  private fetchedAt = 0;
  private pricingRevision = 0;
  private lifecycleEpoch = 0;
  private accepting = true;
  private inFlight: { epoch: number; promise: Promise<void> } | null = null;
  private writeFlight: Promise<void> = Promise.resolve();
  private writeId = 0;
  private lastFailureAt = Number.NEGATIVE_INFINITY;
  private needsPersist = false;

  constructor(userData: string, options: PricingStoreOptions = {}) {
    this.path = join(userData, "model-pricing-cache.json");
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    this.refreshEnabled = options.refreshEnabled ?? (() => true);
    this.onTableChanged = options.onTableChanged;

    const builtInDigest = seedDigest();
    const cached = this.readCache();
    this.catalog = !cached
      ? structuredClone(seedCatalog)
      : cached.seedDigest === builtInDigest
        ? overlayCatalog(seedCatalog, cached.catalog)
        : seedWinsOverlay(seedCatalog, cached.catalog);
    this.fetchedAt = cached?.fetchedAt ?? 0;
    this.sourceHash = cached?.sourceDigest ?? seedSourceDigest;
    this.catalogHash = catalogDigest(this.catalog, this.sourceHash);
    this.tableHash = tableDigest(this.catalog);
    this.table = buildTable(this.catalog);
    this.needsPersist = Boolean(cached && cached.seedDigest !== builtInDigest);
  }

  current() {
    return this.table;
  }

  revision() {
    return this.pricingRevision;
  }

  refreshIfNeeded(): Promise<void> {
    if (!this.accepting) return Promise.resolve();
    const fetchEnabled = this.refreshEnabled();
    const now = this.now();
    if (!this.needsPersist) {
      if (!fetchEnabled) return Promise.resolve();
      if (this.fetchedAt > 0 && now - this.fetchedAt < this.ttlMs) {
        return Promise.resolve();
      }
      if (now - this.lastFailureAt < this.retryMs) return Promise.resolve();
    }
    if (this.inFlight?.epoch === this.lifecycleEpoch) return this.inFlight.promise;

    const epoch = this.lifecycleEpoch;
    const promise = this.refresh(epoch, fetchEnabled)
      .catch(() => undefined)
      .finally(() => {
        if (this.inFlight?.epoch === epoch) this.inFlight = null;
      });
    this.inFlight = { epoch, promise };
    return promise;
  }

  async closeAndDrain() {
    this.accepting = false;
    this.lifecycleEpoch += 1;
    this.inFlight = null;
    await this.writeFlight.catch(() => undefined);
  }

  reopen() {
    this.lifecycleEpoch += 1;
    this.accepting = true;
  }

  private readCache() {
    try {
      return validCache(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      return null;
    }
  }

  private async refresh(epoch: number, fetchEnabled: boolean) {
    try {
      if (this.needsPersist) {
        await this.persist(
          {
            version: CACHE_VERSION,
            seedDigest: seedDigest(),
            catalogDigest: this.catalogHash,
            sourceDigest: this.sourceHash,
            fetchedAt: this.fetchedAt,
            catalog: this.catalog,
          },
          epoch
        );
        if (!this.live(epoch)) return;
        this.needsPersist = false;
      }
      if (!fetchEnabled) return;
      const raw = await this.fetchJson();
      if (!this.live(epoch)) return;
      const fresh = convertModelsDev(raw, "runtime");
      const nextCatalog = overlayCatalog(this.catalog, fresh.catalog);
      const nextSourceHash = fresh.catalogDigest;
      const nextCatalogHash = catalogDigest(nextCatalog, nextSourceHash);
      const nextTableHash = tableDigest(nextCatalog);
      const fetchedAt = this.now();
      const cache: CacheFile = {
        version: CACHE_VERSION,
        seedDigest: seedDigest(),
        catalogDigest: nextCatalogHash,
        sourceDigest: nextSourceHash,
        fetchedAt,
        catalog: nextCatalog,
      };
      await this.persist(cache, epoch);
      if (!this.live(epoch)) return;

      const tableChanged = nextTableHash !== this.tableHash;
      this.catalog = nextCatalog;
      this.catalogHash = nextCatalogHash;
      this.sourceHash = nextSourceHash;
      this.fetchedAt = fetchedAt;
      this.needsPersist = false;
      this.lastFailureAt = Number.NEGATIVE_INFINITY;
      if (!tableChanged) return;
      this.tableHash = nextTableHash;
      this.table = buildTable(nextCatalog);
      this.pricingRevision += 1;
      if (this.live(epoch)) {
        this.onTableChanged?.({
          table: this.table,
          revision: this.pricingRevision,
        });
      }
    } catch {
      if (this.live(epoch)) this.lastFailureAt = this.now();
    }
  }

  private live(epoch: number) {
    return this.accepting && epoch === this.lifecycleEpoch;
  }

  private persist(cache: CacheFile, epoch: number) {
    const write = async () => {
      if (!this.live(epoch)) return;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp-${process.pid}-${++this.writeId}`;
      try {
        await writeFile(temporary, `${JSON.stringify(cache)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        if (!this.live(epoch)) {
          await unlink(temporary).catch(() => undefined);
          return;
        }
        await rename(temporary, this.path);
      } catch (cause) {
        await unlink(temporary).catch(() => undefined);
        throw cause;
      }
    };
    const promise = this.writeFlight.then(write, write);
    this.writeFlight = promise.catch(() => undefined);
    return promise;
  }
}
