/**
 * [INPUT]: Depends on AppStore, Node Atomic file replacement projecting port synchronization with Project/Base name
 * [OUTPUT]: Provides BaseAppRenamer, first atomic rewrite source app.json, then new generation and best-effort synchronized Project/Base name by AppStore seal
 * [POS]: The Base App layer of the apps module is renamed; Source packages and sealed manifests are identical, derived Project/Base projection fails canonical submission
 */

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppRecord,
  RenameAppInput,
} from "../../../shared/apps-ipc";
import { SerialQueue } from "../persistence/serial-queue";
import type { AppStore } from "./app-store";

type BaseAppRenameDependencies = {
  store: AppStore;
  publish(record: AppRecord): void;
  syncBase(record: AppRecord, name: string): Promise<void>;
  warn?(message: string, cause: unknown): void;
};

export class BaseAppRenamer {
  private readonly queue = new SerialQueue();

  constructor(private readonly dependencies: BaseAppRenameDependencies) {}

  rename(input: RenameAppInput) {
    return this.queue.enqueue(() => this.renameLocked(input));
  }

  private async renameLocked(input: RenameAppInput) {
    const record = this.dependencies.store.get(input.appId);
    if (!record) throw new Error("App 不存在");
    const name = input.name.trim();
    if (!name || name.length > 120) throw new Error("App 名称无效");
    if (record.manifest?.kind !== "base") {
      throw new Error("当前只支持 Base App 改名");
    }
    const manifest = { ...record.manifest, name };
    await writeManifestProjection({ ...record, manifest });
    const saved = await this.dependencies.store.publishGeneration(
      record.id,
      (current) => ({
        ...current,
        displayName: name,
        manifest,
      })
    );
    this.dependencies.publish(saved);

    const projections = await Promise.allSettled([
      this.dependencies.syncBase(saved, name),
    ]);
    for (const result of projections) {
      if (result.status === "fulfilled") continue;
      this.dependencies.warn?.(
        `Base App ${saved.id} 改名已提交，Project/Base 名称投影同步失败`,
        result.reason
      );
    }
    return saved;
  }
}

async function writeManifestProjection(record: AppRecord) {
  const temporary = join(
    record.dir,
    `.app.json.rename-${randomUUID()}.tmp`
  );
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(record.manifest, null, 2)}\n`,
      { mode: 0o600 }
    );
    await rename(temporary, join(record.dir, "app.json"));
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
