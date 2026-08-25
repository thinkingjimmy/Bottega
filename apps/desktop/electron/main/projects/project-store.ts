/**
 * [INPUT]: Depends on Node fs/path, nanoid, zod, shared/projects-ipc, main/errors and persistence/serial-queue
 * [OUTPUT]: Provides ProjectStore v4 with projectAppearanceSchema to implement workspaceBinding, grant|disabled 3 modes/revisions, only authorizing and App binding, mutually exclusive, archiving and double-archiving atoms submitted
 * [POS]: The canonical perpetuation ledger of the projects module; App identity only reads workspaceBinding, authorizes intent and member changes to independent revision sequencing, looks to loosen up field presentation without any involvement in any judgments
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  PROJECT_ID_PATTERN,
  workspaceCapabilityId,
  type Project,
  type ProjectAppearance,
  type ProjectWorkspaceBinding,
  type ProjectsSortMode,
} from "../../../shared/projects-ipc";
import {
  isPositiveAppGrant,
  type AppCapabilityGrant,
  type AppGrantRecord,
} from "../../../shared/apps-ipc";
import { errorMessage } from "../errors";
import { SerialQueue } from "../persistence/serial-queue";

const SCHEMA_VERSION = 4;
const sortModeSchema = z.enum(["last-updated", "manual"]);
const projectIdentityFields = {
  id: z.string().regex(PROJECT_ID_PATTERN),
  name: z.string().trim().min(1).max(100),
  dir: z.union([
    z.literal(""),
    z.string().min(1).refine(isAbsolute, "Project dir 必须是绝对路径"),
  ]),
  sortIndex: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
};
/* 外观是渲染端目录表的键，账本只当它是两个短字符串：长度设界防止写坏，
   语义一概不认。认不出的 id 由渲染端回落，永远不该让整档解析失败。 */
export const projectAppearanceSchema = z
  .object({ color: z.string().max(32), icon: z.string().max(64) })
  .strict();
const appCapabilityGrantSchema = z
  .object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    data: z
      .object({ kind: z.literal("base"), level: z.enum(["read", "row-write"]) })
      .strict()
      .optional(),
    agentDelegation: z
      .object({ fileRead: z.boolean(), useData: z.boolean() })
      .strict(),
    grantedAt: z.number().int().nonnegative(),
  })
  .strict();
const appDisabledGrantSchema = z
  .object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    state: z.literal("disabled"),
    disabledAt: z.number().int().nonnegative(),
  })
  .strict();
const capabilityIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/);
const workspaceBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("external"),
      capabilityId: capabilityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("app"),
      appId: z.string().regex(/^[a-z0-9]{10}$/),
    })
    .strict(),
]);
const storedProjectSchema = z
  .object({
    ...projectIdentityFields,
    /* 不进 projectIdentityFields：那组字段是身份，外观只是呈现。
       optional 也让老档（无此键）与新档（有此键）在同一 SCHEMA_VERSION 下共存。 */
    appearance: projectAppearanceSchema.optional(),
    workspaceBinding: workspaceBindingSchema,
    grants: z.array(z.union([appCapabilityGrantSchema, appDisabledGrantSchema])),
    grantRevision: z.number().int().nonnegative(),
    membershipRevision: z.number().int().nonnegative(),
    archivedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((project, context) => {
    if (project.workspaceBinding.kind === "none" && project.dir !== "") {
      context.addIssue({
        code: "custom",
        path: ["dir"],
        message: "none binding 不保存目录",
      });
    }
    if (workspaceCapabilityId(project.workspaceBinding) && project.dir === "") {
      context.addIssue({
        code: "custom",
        path: ["dir"],
        message: `${project.workspaceBinding.kind} binding 缺少目录投影`,
      });
    }
  });
const projectFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    sortMode: sortModeSchema.default("manual"),
    projects: z.array(storedProjectSchema),
    workspaceCapabilities: z.record(
      z.string().regex(/^[A-Za-z0-9_-]{10,64}$/),
      z.string().min(1).refine(isAbsolute, "Workspace capability 必须指向绝对路径")
    ),
  })
  .strict();
export type StoredProject = Omit<Project, "missing">;
type ProjectFile = z.infer<typeof projectFileSchema>;

export type ProjectStoreDependencies = {
  atomicWrite?: (filePath: string, content: string) => Promise<void>;
  readText?: (filePath: string) => Promise<string>;
  now?: () => number;
  createId?: () => string;
};

const clone = <T>(value: T): T => structuredClone(value);
const emptyFile = (): ProjectFile => ({
  schemaVersion: SCHEMA_VERSION,
  sortMode: "manual",
  projects: [],
  workspaceCapabilities: {},
});

/**
 * D17 的写侧最后一道：绑定 App 与写 grant 都在本 store 的同一条队列上，两个方向
 * 于是不可能各写一份。静默清空是明令禁止的——用户会毫不知情地失去授权。
 */
function assertNoPositiveAppGrants(project: StoredProject) {
  const positive = project.grants.filter(isPositiveAppGrant);
  if (!positive.length) return;
  throw Object.assign(
    new Error(
      `Project 仍持有 App 授权，请先撤销：${positive
        .map((grant) => grant.appId)
        .join("、")}`
    ),
    { status: 409 }
  );
}

export class ProjectStore {
  readonly filePath: string;
  readonly backupPath: string;
  private readonly queue = new SerialQueue();
  private state: ProjectFile = emptyFile();
  private previousValidated: ProjectFile | undefined;
  private warning: string | undefined;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly readText: (filePath: string) => Promise<string>;

  constructor(
    userData: string,
    private readonly dependencies: ProjectStoreDependencies = {}
  ) {
    this.filePath = join(userData, "projects.json");
    this.backupPath = `${this.filePath}.bak`;
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? nanoid;
    this.readText = dependencies.readText ?? ((path) => readFile(path, "utf8"));
  }

  async initialize() {
    await this.queue.enqueue(async () => {
      this.warning = undefined;
      try {
        const main = await this.readValidated(this.filePath);
        this.state = main;
        this.previousValidated = clone(main);
        return;
      } catch (mainCause) {
        const mainMissing = (mainCause as NodeJS.ErrnoException).code === "ENOENT";
        if (!mainMissing) await this.isolate(this.filePath);
        try {
          const backup = await this.readValidated(this.backupPath);
          await this.atomicWrite(this.filePath, this.serialize(backup));
          this.state = backup;
          this.previousValidated = clone(backup);
          this.warning = "Projects 已从备份恢复，最近一次变更可能丢失。";
          return;
        } catch (backupCause) {
          const backupMissing =
            (backupCause as NodeJS.ErrnoException).code === "ENOENT";
          if (!backupMissing) await this.isolate(this.backupPath);
          const next = emptyFile();
          await this.atomicWrite(this.filePath, this.serialize(next));
          this.state = next;
          this.previousValidated = clone(next);
          if (!mainMissing || !backupMissing) {
            this.warning = `Projects 主档与备份均无法读取，已建立空档案。主档：${errorMessage(mainCause)}；备份：${errorMessage(backupCause)}`;
          }
        }
      }
    });
  }

  list(): StoredProject[] {
    return clone(this.state.projects);
  }

  get(projectId: string) {
    const project = this.state.projects.find((item) => item.id === projectId);
    return project ? clone(project) : undefined;
  }

  findByDir(dir: string) {
    const project = this.state.projects.find((item) => item.dir === dir);
    return project ? clone(project) : undefined;
  }

  findByAppId(appId: string) {
    const project = this.state.projects.find(
      (item) =>
        item.workspaceBinding.kind === "app" &&
        item.workspaceBinding.appId === appId
    );
    return project ? clone(project) : undefined;
  }

  listDirs() {
    return new Set(
      Object.values(this.state.workspaceCapabilities)
    );
  }

  add(input: { name: string; dir: string; appId?: string | null }) {
    return this.queue.enqueue(async () => {
      const existing = this.state.projects.find((item) => item.dir === input.dir);
      if (existing) return clone(existing);
      const now = this.now();
      const project = storedProjectSchema.parse({
        id: this.createId(),
        name: input.name.trim(),
        dir: input.dir,
        workspaceBinding: input.appId
          ? { kind: "app", appId: input.appId }
          : {
              kind: "external",
              capabilityId: `workspace-${this.createId()}`,
            },
        sortIndex:
          this.state.projects.reduce(
            (maximum, item) => Math.max(maximum, item.sortIndex),
            -1
          ) + 1,
        createdAt: now,
        updatedAt: now,
        grants: [],
        grantRevision: 0,
        membershipRevision: 0,
      });
      const capabilities = { ...this.state.workspaceCapabilities };
      if (project.workspaceBinding.kind === "external") {
        capabilities[project.workspaceBinding.capabilityId] = project.dir;
      }
      await this.commit({
        ...this.state,
        projects: [...this.state.projects, project],
        workspaceCapabilities: capabilities,
      });
      return clone(project);
    });
  }

  addNew(input: { name: string; dir: string; appId: null }) {
    return this.queue.enqueue(async () => {
      if (this.state.projects.some((item) => item.dir === input.dir)) {
        throw new Error("该 Project 文件夹已登记");
      }
      return this.addUnlocked(input);
    });
  }

  addGrouping(name: string) {
    return this.queue.enqueue(async () => {
      const now = this.now();
      const project = storedProjectSchema.parse({
        id: this.createId(),
        name: name.trim(),
        dir: "",
        workspaceBinding: { kind: "none" },
        sortIndex:
          this.state.projects.reduce(
            (maximum, item) => Math.max(maximum, item.sortIndex),
            -1
          ) + 1,
        createdAt: now,
        updatedAt: now,
        grants: [],
        grantRevision: 0,
        membershipRevision: 0,
      });
      await this.commit({
        ...this.state,
        projects: [...this.state.projects, project],
      });
      return clone(project);
    });
  }

  ensureAppBinding(input: {
    appId: string;
    dir: string;
    name: string;
    projectId?: string;
  }) {
    return this.queue.enqueue(async () => {
      const bound = this.state.projects.find(
        (item) =>
          item.workspaceBinding.kind === "app" &&
          item.workspaceBinding.appId === input.appId
      );
      if (bound) {
        if (input.projectId && bound.id !== input.projectId) {
          throw new Error("App Project 身份与 lifecycle intent 不一致");
        }
        return clone(bound);
      }
      const sameDir = this.state.projects.find((item) => item.dir === input.dir);
      if (sameDir?.workspaceBinding.kind === "app") {
        throw new Error("该文件夹已绑定到另一个 App");
      }
      if (sameDir) {
        if (input.projectId && sameDir.id !== input.projectId) {
          throw new Error("同目录 Project 身份与 lifecycle intent 不一致");
        }
        assertNoPositiveAppGrants(sameDir);
        const project = storedProjectSchema.parse({
          ...sameDir,
          workspaceBinding: { kind: "app", appId: input.appId },
          membershipRevision: sameDir.membershipRevision + 1,
          updatedAt: this.now(),
        });
        await this.replace(project);
        return clone(project);
      }
      return this.addUnlocked({
        ...input,
        id: input.projectId,
        appId: input.appId,
      });
    });
  }

  rename(projectId: string, name: string) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      const project = storedProjectSchema.parse({
        ...current,
        name: name.trim(),
        updatedAt: this.now(),
      });
      await this.replace(project);
      return clone(project);
    });
  }

  setAppearance(projectId: string, appearance: ProjectAppearance) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      /* 刻意不动 updatedAt——照抄 rename 的 `updatedAt: this.now()` 正是这里的陷阱：
         last-updated 排序对无 chat 的 Project 回落到 updatedAt（lib/project-sort.ts），
         换个颜色就会让这一行在光标底下自己跳走。外观是呈现，不是内容。 */
      const project = storedProjectSchema.parse({ ...current, appearance });
      await this.replace(project);
      return clone(project);
    });
  }

  remove(projectId: string) {
    return this.queue.enqueue(async () => {
      if (!this.state.projects.some((item) => item.id === projectId)) return;
      const removed = this.state.projects.find((item) => item.id === projectId);
      const workspaceCapabilities = { ...this.state.workspaceCapabilities };
      const capabilityId = removed && workspaceCapabilityId(removed.workspaceBinding);
      if (capabilityId) delete workspaceCapabilities[capabilityId];
      await this.commit({
        ...this.state,
        projects: this.state.projects.filter((item) => item.id !== projectId),
        workspaceCapabilities,
      });
    });
  }

  getSortMode() {
    return this.state.sortMode;
  }

  setSortMode(sortMode: ProjectsSortMode) {
    return this.queue.enqueue(async () => {
      const value = sortModeSchema.parse(sortMode);
      if (value === this.state.sortMode) return value;
      await this.commit({ ...this.state, sortMode: value });
      return value;
    });
  }

  getWarning() {
    return this.warning;
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private async addUnlocked(input: {
    id?: string;
    name: string;
    dir: string;
    appId: string | null;
  }) {
    const now = this.now();
    const project = storedProjectSchema.parse({
      id: input.id ?? this.createId(),
      name: input.name.trim() || basename(input.dir),
      dir: input.dir,
      workspaceBinding: input.appId
        ? { kind: "app", appId: input.appId }
        : {
            kind: "external",
            capabilityId: `workspace-${this.createId()}`,
          },
      sortIndex:
        this.state.projects.reduce(
          (maximum, item) => Math.max(maximum, item.sortIndex),
          -1
        ) + 1,
      createdAt: now,
      updatedAt: now,
      grants: [],
      grantRevision: 0,
      membershipRevision: 0,
    });
    const workspaceCapabilities = { ...this.state.workspaceCapabilities };
    if (project.workspaceBinding.kind === "external") {
      workspaceCapabilities[project.workspaceBinding.capabilityId] = project.dir;
    }
    await this.commit({
      ...this.state,
      projects: [...this.state.projects, project],
      workspaceCapabilities,
    });
    return clone(project);
  }

  private require(projectId: string) {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("Project 不存在");
    return project;
  }

  private async replace(project: StoredProject) {
    await this.commit({
      ...this.state,
      projects: this.state.projects.map((item) =>
        item.id === project.id ? project : item
      ),
    });
  }

  private async commit(next: ProjectFile) {
    const validated = projectFileSchema.parse(next);
    if (this.previousValidated) {
      await this.atomicWrite(
        this.backupPath,
        this.serialize(this.previousValidated)
      );
    }
    await this.atomicWrite(this.filePath, this.serialize(validated));
    this.state = validated;
    this.previousValidated = clone(validated);
  }

  resolveWorkspace(binding: ProjectWorkspaceBinding) {
    const capabilityId = workspaceCapabilityId(binding);
    return capabilityId
      ? this.state.workspaceCapabilities[capabilityId]
      : undefined;
  }

  setWorkspaceBinding(
    projectId: string,
    binding: ProjectWorkspaceBinding,
    externalDir?: string
  ) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      if (binding.kind === "app") assertNoPositiveAppGrants(current);
      const workspaceCapabilities = { ...this.state.workspaceCapabilities };
      const previousCapability = workspaceCapabilityId(current.workspaceBinding);
      if (previousCapability) delete workspaceCapabilities[previousCapability];
      const nextCapability = workspaceCapabilityId(binding);
      if (nextCapability) {
        if (!externalDir) throw new Error(`${binding.kind} binding 缺少受信目录`);
        workspaceCapabilities[nextCapability] = externalDir;
      }
      const project = storedProjectSchema.parse({
        ...current,
        workspaceBinding: binding,
        membershipRevision: current.membershipRevision + 1,
        dir: nextCapability
          ? externalDir
          : binding.kind === "app"
            ? current.dir
            : "",
        updatedAt: this.now(),
      });
      await this.commit({
        ...this.state,
        workspaceCapabilities,
        projects: this.state.projects.map((item) =>
          item.id === projectId ? project : item
        ),
      });
      return clone(project);
    });
  }

  setArchivedAt(projectId: string, archivedAt: number | undefined) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      const project = storedProjectSchema.parse({
        ...current,
        archivedAt,
        updatedAt: this.now(),
      });
      await this.replace(project);
      return clone(project);
    });
  }

  setAppGrant(projectId: string, grant: AppCapabilityGrant) {
    return this.setAppGrantRecord(projectId, grant);
  }

  setAppGrantRecord(projectId: string, grant: AppGrantRecord) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      /* D17 的写侧最后一道：与 setWorkspaceBinding/ensureAppBinding 同一条队列，
         「授权」与「变成 App Project」于是不可能各写一份。 */
      if (current.workspaceBinding.kind === "app") {
        throw Object.assign(new Error("App Project 不能再附加 App"), {
          status: 403,
        });
      }
      const project = storedProjectSchema.parse({
        ...current,
        grants: [
          ...current.grants.filter((item) => item.appId !== grant.appId),
          clone(grant),
        ],
        grantRevision: current.grantRevision + 1,
        updatedAt: this.now(),
      });
      await this.replace(project);
      return clone(project);
    });
  }

  revokeAppGrant(projectId: string, appId: string) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      const grants = current.grants.filter((item) => item.appId !== appId);
      if (grants.length === current.grants.length) return clone(current);
      const project = storedProjectSchema.parse({
        ...current,
        grants,
        grantRevision: current.grantRevision + 1,
        updatedAt: this.now(),
      });
      await this.replace(project);
      return clone(project);
    });
  }

  /* 断代：v3 是唯一可读版本。非 v3（含一切历史版本）解析即抛，
     由 initialize 的既有损坏路径隔离原文件——绝不静默升格。 */
  private async readValidated(filePath: string) {
    return projectFileSchema.parse(JSON.parse(await this.readText(filePath)));
  }

  private serialize(state: ProjectFile) {
    return `${JSON.stringify(state, null, 2)}\n`;
  }

  private async atomicWrite(filePath: string, content: string) {
    if (this.dependencies.atomicWrite) {
      await this.dependencies.atomicWrite(filePath, content);
      return;
    }
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, filePath);
  }

  private async isolate(filePath: string) {
    const corruptPath = `${filePath}.corrupt-${this.now()}`;
    try {
      await rename(filePath, corruptPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
}
