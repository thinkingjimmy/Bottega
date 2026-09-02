/**
 * [INPUT]: Depends on Node fs/path, durable-json replacement, errors, frozen Project store v4/v5/v6/v7 schemas, and current v8 schema
 * [OUTPUT]: Provides independently normalized dual-mirror selection, raw legacy backup, generation-preserving v4/v5/v6/v7-to-v8 migration, publication, sentinel, and isolation
 * [POS]: Persistence owner beneath ProjectStore; it decides which durable generation is authoritative while ProjectStore owns domain mutations
 */

import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../../errors";
import { durableReplaceFile } from "../../persistence/durable-json";
import {
  PROJECT_STORE_SCHEMA_VERSION,
  projectFileSchema,
  projectFileV4Schema,
  projectFileV5Schema,
  projectFileV6Schema,
  projectFileV7Schema,
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
  sourceVersion?: 4 | 5 | 6 | 7;
  rawContent?: string;
}>;

type ProjectStoreSelection = Readonly<{
  file: ProjectFile;
  source: "main" | "backup";
  migrationBackup?: Readonly<{ version: 4 | 5 | 6 | 7; content: string }>;
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
    const selected = selectAuthoritativeProjectFile(main.file, backup.file);
    if (!selected) return undefined;
    const candidate = selected.source === "main" ? main : backup;
    return candidate.migrated
      ? this.migrated(selected.file, selected.source, candidate)
      : selected;
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

  async backupMigration(selection: ProjectStoreSelection) {
    const backup = selection.migrationBackup;
    if (!backup) return;
    await this.atomicWrite(
      `${this.filePath}.v${backup.version}.bak`,
      backup.content
    );
  }

  async writeFailureSentinel(cause: unknown) {
    await this.atomicWrite(
      this.failurePath,
      `ProjectStore authority failure at ${this.now()}: ${errorMessage(cause)}\n`
    );
  }

  private migrated(
    file: ProjectFile,
    source: "main" | "backup",
    candidate: Candidate
  ): ProjectStoreSelection {
    return {
      file: projectFileSchema.parse({
        ...file,
        commitGeneration: file.commitGeneration + 1,
      }),
      source,
      ...(candidate.sourceVersion && candidate.rawContent
        ? {
            migrationBackup: {
              version: candidate.sourceVersion,
              content: candidate.rawContent,
            },
          }
        : {}),
    } as const;
  }

  private async readValidated(filePath: string) {
    const rawContent = await this.readText(filePath);
    const raw = JSON.parse(rawContent);
    const current = projectFileSchema.safeParse(raw);
    if (current.success) return { file: current.data, migrated: false };
    const v7 = projectFileV7Schema.safeParse(raw);
    if (v7.success) {
      return {
        file: projectFileSchema.parse({
          ...v7.data,
          schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
          projects: v7.data.projects.map((project) => {
            const granted = new Set(
              project.grants
                .filter((grant) => !("state" in grant))
                .map((grant) => grant.appId)
            );
            return {
              ...project,
              appPlacements: project.appPlacements.filter((placement) =>
                granted.has(placement.appId)
              ),
            };
          }),
        }),
        migrated: true,
        sourceVersion: 7 as const,
        rawContent,
      };
    }
    const v6 = projectFileV6Schema.safeParse(raw);
    if (v6.success) {
      return {
        file: projectFileSchema.parse({
          ...v6.data,
          schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
          projects: v6.data.projects.map((project) => ({
            ...project,
            appPlacements: [],
          })),
        }),
        migrated: true,
        sourceVersion: 6 as const,
        rawContent,
      };
    }
    const v5 = projectFileV5Schema.safeParse(raw);
    if (v5.success) {
      return {
        file: projectFileSchema.parse({
          ...v5.data,
          schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
          projects: v5.data.projects.map((project) => ({
            ...project,
            role: "workspace",
            nameSource:
              project.workspaceBinding.kind === "app" ? "app" : "user",
            appPlacements: [],
          })),
        }),
        migrated: true,
        sourceVersion: 5 as const,
        rawContent,
      };
    }
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
          role: "workspace",
          nameSource:
            project.workspaceBinding.kind === "app" ? "app" : "user",
          appPlacements: [],
        })),
        deletionReceipts: [],
        workspaceCapabilities: legacy.workspaceCapabilities,
      }),
      migrated: true,
      sourceVersion: 4 as const,
      rawContent,
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
