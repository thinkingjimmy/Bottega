/**
 * [INPUT]: Depends on AppStore, shared migration strict schema with Node only read file interface
 * [OUTPUT]: Provides AppDataMigrations; reads `migrations/base.json` The new platform is designed to provide live Base and port fuels
 * [POS]: The main purpose of the app is to provide a general migration link to apps→basesOnly sort by the descriptor in the package, no presetId
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appBaseDataMigrationFileSchema,
  type AppBaseDataMigrationFile,
} from "../../../shared/app-data-migration";
import type { AppStore } from "./app-store";

const DESCRIPTOR = join("migrations", "base.json");
const MAX_DESCRIPTOR_BYTES = 512 * 1024;

export type AppDataMigrationPort = {
  apply(appId: string, file: AppBaseDataMigrationFile): Promise<void>;
};

export class AppDataMigrations {
  private port: AppDataMigrationPort | null = null;
  private readonly flights = new Map<string, Promise<void>>();

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

  async reconcileAll() {
    const failures: Array<{ appId: string; message: string }> = [];
    for (const record of this.store.list()) {
      if (record.manifest?.kind !== "base") continue;
      await this.reconcile(record.id).catch((cause) =>
        failures.push({
          appId: record.id,
          message: cause instanceof Error ? cause.message : String(cause),
        })
      );
    }
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
    const file = appBaseDataMigrationFileSchema.parse(
      JSON.parse(bytes.toString("utf8"))
    );
    await this.port.apply(appId, file);
  }
}
