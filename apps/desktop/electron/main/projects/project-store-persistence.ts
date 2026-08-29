/**
 * [INPUT]: Depends on Node fs/path, durable-json replacement, errors, and Project store v4/v5 schemas
 * [OUTPUT]: Provides mirrored Project authority loading, v4 cutover, durable publication, corruption sentinel, and isolation
 * [POS]: Persistence owner beneath ProjectStore; it decides which durable generation is authoritative while ProjectStore owns domain mutations
 */

import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../errors";
import { durableReplaceFile } from "../persistence/durable-json";
import {
  PROJECT_STORE_SCHEMA_VERSION,
  projectFileSchema,
  projectFileV4Schema,
  type ProjectFile,
} from "./project-store-schema";

export type ProjectStorePersistenceDependencies = {
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
  migrated: boolean;
  missing: boolean;
  cause?: unknown;
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
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
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
    if (main.file && main.migrated) {
      return this.migrated(main.file, "main");
    }
    if (!main.file && backup.file && backup.migrated) {
      return this.migrated(backup.file, "backup");
    }
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

  private migrated(file: ProjectFile, source: "main" | "backup") {
    return {
      file: projectFileSchema.parse({ ...file, commitGeneration: 1 }),
      source,
    } as const;
  }

  private async readValidated(filePath: string) {
    const raw = JSON.parse(await this.readText(filePath));
    const current = projectFileSchema.safeParse(raw);
    if (current.success) return { file: current.data, migrated: false };
    const legacy = projectFileV4Schema.parse(raw);
    const revisions = new Map(
      [...legacy.projects]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((project, index) => [project.id, index + 1])
    );
    return {
      file: projectFileSchema.parse({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        commitGeneration: 0,
        lifecycleSequence: legacy.projects.length,
        sortMode: legacy.sortMode,
        projects: legacy.projects.map((project) => ({
          ...project,
          projectLifecycleRevision: revisions.get(project.id),
        })),
        deletionReceipts: [],
        workspaceCapabilities: legacy.workspaceCapabilities,
      }),
      migrated: true,
    };
  }

  private async readCandidate(filePath: string): Promise<Candidate> {
    try {
      const value = await this.readValidated(filePath);
      return { ...value, missing: false };
    } catch (cause) {
      return {
        migrated: false,
        missing: (cause as NodeJS.ErrnoException).code === "ENOENT",
        cause,
      };
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
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
}

function selectAuthoritativeProjectFile(
  main: ProjectFile | undefined,
  backup: ProjectFile | undefined
): { file: ProjectFile; source: "main" | "backup" } | undefined {
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
