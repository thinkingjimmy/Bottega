/**
 * [INPUT]: Depends on AppStore, the shared strict migration schema, and Node's read-only file interface
 * [OUTPUT]: Provides AppDataMigrations: reads `migrations/base.json`, short-circuits on an unchanged descriptor digest, and hands the descriptor to the injected Base port on a per-App lane
 * [POS]: The apps→Bases migration seam; ordering comes from the descriptor shipped in the package, never from a presetId
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appBaseDataMigrationFileSchema,
  type AppBaseDataMigrationFile,
} from "../../../../shared/app-data-migration";
import type { AppStore } from "../store/app-store";

const DESCRIPTOR = join("migrations", "base.json");
const MAX_DESCRIPTOR_BYTES = 512 * 1024;

export type AppDataMigrationPort = {
  apply(appId: string, file: AppBaseDataMigrationFile): Promise<void>;
};

export class AppDataMigrations {
  private port: AppDataMigrationPort | null = null;
  private readonly flights = new Map<string, Promise<void>>();
  /* 已生效的 descriptor 摘要。同一份 base.json 没必要在每次 syncBaseGuiRoute
     与 guiInfo 上重解析重下发——迁移是幂等的，但重复解析不是免费的。 */
  private readonly applied = new Map<string, string>();

  constructor(private readonly store: AppStore) {}

  configure(port: AppDataMigrationPort) {
    if (this.port) throw new Error("App data migration 已配置");
    this.port = port;
  }

  reconcile(appId: string) {
    const active = this.flights.get(appId);
    if (active) return active;
    const flight = this.apply(appId).finally(() => {
      if (this.flights.get(appId) === flight) this.flights.delete(appId);
    });
    this.flights.set(appId, flight);
    return flight;
  }

  /** 每个 App 一条独立的 lane，彼此之间没有顺序可言，串行只是在浪费墙钟。 */
  async reconcileAll() {
    const failures: Array<{ appId: string; message: string }> = [];
    await Promise.all(
      this.store
        .list()
        .filter((record) => record.manifest?.kind === "base")
        .map((record) =>
          this.reconcile(record.id).catch((cause) =>
            failures.push({
              appId: record.id,
              message: cause instanceof Error ? cause.message : String(cause),
            })
          )
        )
    );
    return failures;
  }

  private async apply(appId: string) {
    if (!this.port) throw new Error("App data migration 尚未配置");
    const record = this.store.get(appId);
    if (!record || record.manifest?.kind !== "base") return;
    const path = join(record.dir, DESCRIPTOR);
    const bytes = await readFile(path).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return null;
      throw cause;
    });
    if (!bytes) return;
    if (bytes.byteLength > MAX_DESCRIPTOR_BYTES) {
      throw new Error(`${DESCRIPTOR} 超过 512KB`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (this.applied.get(appId) === digest) return;
    const file = appBaseDataMigrationFileSchema.parse(
      JSON.parse(bytes.toString("utf8"))
    );
    await this.port.apply(appId, file);
    this.applied.set(appId, digest);
  }
}
