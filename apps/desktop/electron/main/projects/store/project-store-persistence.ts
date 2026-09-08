/**
 * [INPUT]: Depends on Node fs/path, durable-json replacement and errno predicate, errors, and the current v8 Project store schema
 * [OUTPUT]: Provides independently validated dual-mirror selection, publication, sentinel, and isolation; any non-v8 file is corruption
 * [POS]: Persistence owner beneath ProjectStore; it decides which durable generation is authoritative while ProjectStore owns domain mutations
 */

import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../../errors";
import { durableReplaceFile } from "../../persistence/durable-json";
import {
  PROJECT_STORE_SCHEMA_VERSION,
  projectFileSchema,
  type ProjectFile,
} from "./project-store-schema";
import { isErrnoCode } from "../../persistence/durable-json";

type ProjectStorePersistenceDependencies = {
  atomicWrite?: (filePath: string, content: string) => Promise<void>;
  readText?: (filePath: string) => Promise<string>;
  now?: () => number;
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

type Candidate = Readonly<{
  file?: ProjectFile;
  missing: boolean;
  cause?: unknown;
}>;

type ProjectStoreSelection = Readonly<{
  file: ProjectFile;
  source: "main" | "backup";
}>;

export class ProjectStorePersistence {
  readonly filePath: string;
  readonly backupPath: string;
  readonly failurePath: string;
  private readonly readText: (filePath: string) => Promise<string>;
  private readonly now: () => number;

  constructor(userData: string, private readonly dependencies: ProjectStorePersistenceDependencies) {
    this.filePath = join(userData, "projects.json");
    this.backupPath = `${this.filePath}.bak`;
    this.failurePath = `${this.filePath}.failed`;
    this.readText = dependencies.readText ?? ((path) => readFile(path, "utf8"));
    this.now = dependencies.now ?? Date.now;
  }

  async assertNoFailureSentinel() {
    try {
      await this.readText(this.failurePath);
      throw new Error(
        "ProjectStore corruption sentinel 存在，必须人工恢复 authority 后才能启动"
      );
    } catch (cause) {
      if (!isErrnoCode(cause, "ENOENT")) throw cause;
    }
  }

  async candidates() {
    const [main, backup] = await Promise.all([
      this.readCandidate(this.filePath),
      this.readCandidate(this.backupPath),
    ]);
    return { main, backup };
  }

  select(main: Candidate, backup: Candidate) {
    return selectAuthoritativeProjectFile(main.file, backup.file);
  }

  async isolateInvalid(main: Candidate, backup: Candidate) {
    if (!main.file && !main.missing) await this.isolate(this.filePath);
    if (!backup.file && !backup.missing) await this.isolate(this.backupPath);
  }

  async publishMirror(state: ProjectFile) {
    const content = `${JSON.stringify(state, null, 2)}\n`;
    await this.atomicWrite(this.backupPath, content);
    await this.atomicWrite(this.filePath, content);
  }

  async writeFailureSentinel(cause: unknown) {
    await this.atomicWrite(
      this.failurePath,
      `ProjectStore authority failure at ${this.now()}: ${errorMessage(cause)}\n`
    );
  }

  private async readCandidate(filePath: string): Promise<Candidate> {
    try {
      const file = projectFileSchema.parse(
        JSON.parse(await this.readText(filePath))
      );
      return { file, missing: false };
    } catch (cause) {
      return { missing: isErrnoCode(cause, "ENOENT"), cause };
    }
  }

  private async atomicWrite(filePath: string, content: string) {
    await (this.dependencies.atomicWrite?.(filePath, content) ??
      durableReplaceFile(filePath, content));
  }

  private async isolate(filePath: string) {
    try {
      await rename(filePath, `${filePath}.corrupt-${this.now()}`);
    } catch (cause) {
      if (!isErrnoCode(cause, "ENOENT")) throw cause;
    }
  }
}

function selectAuthoritativeProjectFile(
  main: ProjectFile | undefined,
  backup: ProjectFile | undefined
): ProjectStoreSelection | undefined {
  if (!main) return backup ? { file: backup, source: "backup" } : undefined;
  if (!backup) return { file: main, source: "main" };
  if (main.commitGeneration === backup.commitGeneration) {
    if (JSON.stringify(main) !== JSON.stringify(backup)) {
      throw new Error("Projects 主档与镜像同代内容不一致，拒绝猜测 authority");
    }
    return { file: main, source: "main" };
  }
  return main.commitGeneration > backup.commitGeneration
    ? { file: main, source: "main" }
    : { file: backup, source: "backup" };
}
