/**
 * [INPUT]: Depends on the current v9 Project store schema and the folder Project publication.
 * [OUTPUT]: Provides the empty ProjectFile, the single folder-backed read/publish pair ProjectStore commits through, and the machine-keyed directory hint write.
 * [POS]: Persistence owner beneath ProjectStore; the selected folder is the only generation, so nothing here chooses between mirrors
 */

import {
  PROJECT_STORE_SCHEMA_VERSION,
  type ProjectFile,
} from "./project-store-schema";
import { ProjectFolder } from "./project-folder";

export type ProjectStorePersistenceDependencies = {
  /** The selected folder. Null only before the first selection, where the folder reads as empty. */
  libraryRoot: () => string | null;
  folderCheckpoint?: (phase: "intent" | "content" | "commit") => Promise<void>;
  /** This computer's key; absent disables same-machine directory hints entirely. */
  machineIdHash?: () => Promise<string | null>;
};

export const emptyProjectFile = (): ProjectFile => ({
  schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
  commitGeneration: 0,
  lifecycleSequence: 0,
  sortMode: "manual",
  projects: [],
  deletionReceipts: [],
  workspaceCapabilities: {},
});

export class ProjectStorePersistence {
  private readonly folder: ProjectFolder;
  /** This profile's local authority beside the folder content; the folder owns the portable half. */
  readonly filePath: string;

  constructor(userData: string, dependencies: ProjectStorePersistenceDependencies) {
    this.folder = new ProjectFolder(userData, dependencies.libraryRoot, dependencies.folderCheckpoint, dependencies.machineIdHash);
    this.filePath = this.folder.path;
  }

  read() {
    return this.folder.read(emptyProjectFile());
  }

  publish(state: ProjectFile) {
    return this.folder.write(state);
  }

  rememberHint(projectId: string, dir: string) {
    return this.folder.rememberHint(projectId, dir);
  }
}
