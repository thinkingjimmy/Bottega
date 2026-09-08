/**
 * [INPUT]: Depends on AppStore metadata updates, SerialQueue, and the Project/Base name projection port
 * [OUTPUT]: Provides BaseAppRenamer: persist the installed display name, then sync the Project/Base name best-effort without publishing a generation
 * [POS]: Installed Base App naming boundary; source manifests, running generations, and grants retain their identity during rename
 */

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
    const name = input.name.trim();
    if (!name || name.length > 120) throw new Error("Invalid App name");
    const saved = await this.dependencies.store.update(
      input.appId,
      (current) => {
        if (current.manifest?.kind !== "base") {
          throw new Error("Only Base Apps support renaming");
        }
        // Names are local metadata; publishing would revoke live surface leases.
        return { ...current, displayName: name };
      }
    );

    // A derived projection failure cannot undo the committed name.
    await this.dependencies.syncBase(saved, name).catch((cause: unknown) => {
      this.dependencies.warn?.(
        `Base App ${saved.id} was renamed, but its Project/Base name projection failed`,
        cause
      );
    });
    return saved;
  }
}
