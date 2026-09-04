/**
 * [INPUT]: Depends on AppStore, node:fs atomic replacement, and the Project/Base name projection port
 * [OUTPUT]: Provides BaseAppRenamer: rewrite the source app.json atomically, seal a new generation through AppStore, then sync the Project/Base name best-effort
 * [POS]: The Base App rename layer of the apps module; source package and sealed manifest always agree, and a failed derived Project/Base projection never revokes the committed rename
 */

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppRecord,
  RenameAppInput,
} from "../../../../shared/apps-ipc";
import { SerialQueue } from "../../persistence/serial-queue";
import type { AppStore } from "../store/app-store";

type BaseAppRenameDependencies = {
  store: AppStore;
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

    /* 改名已经提交；派生投影失败只值一条 warning,不能回头撤销既成事实。 */
    await this.dependencies.syncBase(saved, name).catch((cause: unknown) => {
      this.dependencies.warn?.(
        `Base App ${saved.id} 改名已提交，Project/Base 名称投影同步失败`,
        cause
      );
    });
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
