/**
 * [INPUT]: Depends on Node fs/path and AppManifest/ExtensionPlan/supervise process type
 * [OUTPUT]: Provides RepairJournalStore and RepairPhase/RepairJournal phase types
 * [POS]: The collapse consistency log of install/repair, with all the stages of change replaced by atomic perpetuation; The swapping matrix is determined at site.ts
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppManifest } from "../../../../../shared/apps-ipc";
import type { ExtensionDecision, ExtensionPlan } from "../extension";
import type { ActiveRepairProcess } from "./supervisor";

export type RepairPhase =
  | "preparing"
  | "running"
  | "finalizing"
  | "swapping"
  | "swapped"
  | "configuring"
  | "committed";

export type RepairJournal = {
  appId: string;
  runId: string;
  site: "staging" | "copy";
  phase: RepairPhase;
  workspace: string;
  trash?: string;
  activeProcesses: ActiveRepairProcess[];
  s1TreeSha256?: string;
  extensionDecision?: ExtensionDecision;
  extensionPlan?: ExtensionPlan | null;
  finalManifest?: AppManifest;
  baselineFingerprint?: string;
};

export class RepairJournalStore {
  readonly root: string;

  constructor(userData: string) {
    this.root = join(userData, "apps-state");
  }

  path(appId: string) {
    return join(this.root, `${appId}.repair-journal`);
  }

  async write(journal: RepairJournal) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(journal.appId);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, path);
  }

  async read(appId: string) {
    return readFile(this.path(appId), "utf8")
      .then((value) => JSON.parse(value) as RepairJournal)
      .catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return null;
        throw cause;
      });
  }

  async list() {
    return readdir(this.root).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return [];
      throw cause;
    });
  }

  async remove(appId: string) {
    await rm(this.path(appId), { force: true });
  }
}
