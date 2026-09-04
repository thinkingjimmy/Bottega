/**
 * [INPUT]: Depends on Node fs/path, nanoid, shared Project/App contracts, project-store-schema, main/errors, and persistence/serial-queue
 * [OUTPUT]: Provides ProjectStore v8 mutations with mirrored monotonic commits, lifecycle/deletion authority, and delegated workspace plus App-placement atoms over one ProjectFile
 * [POS]: Canonical Project persistence and lifecycle authority; focused collaborators share its queue/state/commit port and never create secondary ledgers
 */
import { basename } from "node:path";
import { nanoid } from "nanoid";
import {
  workspaceCapabilityId,
  type ProjectAppearance,
  type ProjectWorkspaceBinding,
  type ProjectsSortMode,
} from "../../../../shared/projects-ipc";
import type { TurnProjectContext } from "../../../../shared/resource-scope";
import type { AppGrantRecord } from "../../../../shared/apps-ipc";
import { errorMessage } from "../../errors";
import { SerialQueue } from "../../persistence/serial-queue";
import {
  projectFileSchema,
  projectSortModeSchema,
  storedProjectSchema,
  type ProjectDeletionCheckpoint,
  type ProjectFile,
  type ProjectRemovalOperation,
  type ProjectResourceAdmission,
  type StoredProject,
} from "./project-store-schema";
import { emptyProjectFile, ProjectStorePersistence } from "./project-store-persistence";
import { ProjectStoreWorkspace } from "../rebind/project-store-workspace";
import { assertNoPositiveAppGrants } from "../rebind/project-workspace-policy";
import { ProjectAppPlacements } from "./project-app-placements";
export { projectAppearanceSchema, type ProjectDeletionCheckpoint,
  type ProjectRemovalOperation, type ProjectResourceAdmission,
  type StoredProject } from "./project-store-schema";

export type ProjectStoreDependencies = {
  atomicWrite?: (filePath: string, content: string) => Promise<void>;
  readText?: (filePath: string) => Promise<string>;
  now?: () => number;
  createId?: () => string;
};

const clone = <T>(value: T): T => structuredClone(value);
export class ProjectStore {
  readonly filePath: string;
  readonly backupPath: string;
  readonly failurePath: string;
  private readonly queue = new SerialQueue();
  private state: ProjectFile = emptyProjectFile();
  private ready = false;
  private warning: string | undefined;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly persistence: ProjectStorePersistence;
  private readonly workspace: ProjectStoreWorkspace;
  readonly appPlacements: ProjectAppPlacements;

  constructor(userData: string, private readonly dependencies: ProjectStoreDependencies = {}) {
    this.persistence = new ProjectStorePersistence(userData, dependencies);
    this.filePath = this.persistence.filePath;
    this.backupPath = this.persistence.backupPath;
    this.failurePath = this.persistence.failurePath;
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? nanoid;
    this.workspace = new ProjectStoreWorkspace({
      enqueue: (operation) => this.queue.enqueue(operation),
      state: () => this.state,
      require: (projectId) => this.require(projectId),
      commit: (next) => this.commit(next),
      now: () => this.now(),
    });
    this.appPlacements = new ProjectAppPlacements({
      enqueue: (operation) => this.queue.enqueue(operation),
      state: () => this.state,
      require: (projectId) => this.require(projectId),
      commit: (next) => this.commit(next),
      now: () => this.now(),
    });
  }

  async initialize() {
    await this.queue.enqueue(async () => {
      this.ready = false;
      this.warning = undefined;
      await this.persistence.assertNoFailureSentinel();
      const { main, backup } = await this.persistence.candidates();
      let selected;
      try {
        selected = this.persistence.select(main, backup);
      } catch (cause) {
        await this.persistence.writeFailureSentinel(cause);
        throw cause;
      }
      if (!selected) {
        if (!main.missing || !backup.missing) {
          await this.persistence.writeFailureSentinel(main.cause ?? backup.cause);
          await this.persistence.isolateInvalid(main, backup);
          throw new Error(
            `Projects 主档与镜像均无法验证，已隔离并 fail closed。主档：${errorMessage(main.cause)}；镜像：${errorMessage(backup.cause)}`
          );
        }
        const next = emptyProjectFile();
        await this.persistence.publishMirror(next);
        this.state = next;
        this.ready = true;
        return;
      }
      await this.persistence.isolateInvalid(main, backup);
      await this.persistence.backupMigration(selected);
      await this.persistence.publishMirror(selected.file);
      this.state = selected.file;
      this.ready = true;
      if (selected.source === "backup" || !main.file) {
        this.warning = "Projects 已从同代持久镜像恢复。";
      }
    });
  }

  list(): StoredProject[] {
    this.assertReady();
    return clone(this.state.projects);
  }

  get(projectId: string) {
    this.assertReady();
    const project = this.state.projects.find((item) => item.id === projectId);
    return project ? clone(project) : undefined;
  }

  isDeleting(projectId: string) {
    this.assertReady();
    return Boolean(
      this.state.projects.find((item) => item.id === projectId)
        ?.deletionCheckpoint
    );
  }

  turnContext(projectId: string | null): TurnProjectContext {
    if (projectId === null) {
      return { projectId: null, projectLifecycleRevision: null };
    }
    const project = this.require(projectId);
    if (project.deletionCheckpoint) {
      throw lifecycleError("project-deleting", "Project 正在删除");
    }
    return {
      projectId,
      projectLifecycleRevision: project.projectLifecycleRevision,
    };
  }

  assertLifecycle(projectId: string, expectedRevision: number) {
    const project = this.require(projectId);
    if (project.deletionCheckpoint) {
      throw lifecycleError("project-deleting", "Project 正在删除");
    }
    if (project.projectLifecycleRevision !== expectedRevision) {
      throw lifecycleError(
        "project-lifecycle-conflict",
        "Project lifecycle 已变化，请刷新后重试"
      );
    }
    return clone(project);
  }

  runWithLifecycle<T>(
    projectId: string,
    expectedRevision: number,
    operation: () => Promise<T>
  ) {
    return this.queue.enqueue(async () => {
      this.assertLifecycle(projectId, expectedRevision);
      return operation();
    });
  }

  projectLifecycleRevision(projectId: string) {
    this.assertReady();
    return this.state.projects.find((item) => item.id === projectId)
      ?.projectLifecycleRevision;
  }

  assertProjectLifecycle(projectId: string, expectedRevision: number) {
    this.assertReady();
    const project = this.require(projectId);
    if (project.deletionCheckpoint) throw conflict("Project 正在删除");
    if (project.projectLifecycleRevision !== expectedRevision) {
      throw conflict("Project lifecycle 已变更");
    }
    return clone(project);
  }

  acquireResourceAdmission(
    projectId: string,
    input: ProjectResourceAdmission
  ) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      if (current.deletionCheckpoint) throw conflict("Project 正在删除");
      if (current.projectLifecycleRevision !== input.projectLifecycleRevision) {
        throw conflict("Project lifecycle 已变更");
      }
      const existing = current.resourceAdmissions.find(
        (item) => item.operationId === input.operationId
      );
      if (existing) {
        if (
          existing.kind !== input.kind ||
          existing.installIdentity !== input.installIdentity ||
          existing.projectLifecycleRevision !== input.projectLifecycleRevision
        ) {
          throw conflict("Project resource admission identity 已漂移");
        }
        return clone(existing);
      }
      const admission: ProjectResourceAdmission = structuredClone(input);
      const project = storedProjectSchema.parse({
        ...current,
        resourceAdmissions: [...current.resourceAdmissions, admission],
      });
      await this.replace(project);
      return clone(admission);
    });
  }

  assertResourceAdmission(
    projectId: string,
    operationId: string,
    installIdentity: string,
    expectedProjectLifecycleRevision: number
  ) {
    this.assertReady();
    const project = this.require(projectId);
    const admission = project.resourceAdmissions.find(
      (item) => item.operationId === operationId
    );
    if (
      !admission ||
      admission.installIdentity !== installIdentity ||
      admission.projectLifecycleRevision !== expectedProjectLifecycleRevision ||
      project.projectLifecycleRevision !== expectedProjectLifecycleRevision ||
      project.deletionCheckpoint
    ) {
      throw conflict("Project resource admission 已失效");
    }
    return clone(admission);
  }

  releaseResourceAdmission(
    projectId: string,
    operationId: string,
    installIdentity: string,
    expectedProjectLifecycleRevision: number
  ) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      const frozen = current.deletionCheckpoint?.frozenResourceAdmissions.some(
        (item) =>
          item.operationId === operationId &&
          item.installIdentity === installIdentity &&
          item.projectLifecycleRevision === expectedProjectLifecycleRevision
      );
      if (
        current.projectLifecycleRevision !== expectedProjectLifecycleRevision &&
        !frozen
      ) {
        throw conflict("Project lifecycle 已变更");
      }
      const admission = current.resourceAdmissions.find(
        (item) => item.operationId === operationId
      );
      if (!admission) return;
      if (
        admission.installIdentity !== installIdentity ||
        admission.projectLifecycleRevision !== expectedProjectLifecycleRevision
      ) {
        throw conflict("Project resource admission identity 已漂移");
      }
      const project = storedProjectSchema.parse({
        ...current,
        resourceAdmissions: current.resourceAdmissions.filter(
          (item) => item.operationId !== operationId
        ),
      });
      await this.replace(project);
    });
  }

  findByDir(dir: string) {
    this.assertReady();
    const project = this.state.projects.find((item) => item.dir === dir);
    return project ? clone(project) : undefined;
  }

  findByAppId(appId: string) {
    this.assertReady();
    const project = this.state.projects.find(
      (item) =>
        item.workspaceBinding.kind === "app" &&
        item.workspaceBinding.appId === appId
    );
    return project ? clone(project) : undefined;
  }

  listDirs() {
    this.assertReady();
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
        role: "workspace",
        nameSource: input.appId ? "app" : "user",
        appPlacements: [],
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
        projectLifecycleRevision: this.state.lifecycleSequence + 1,
      });
      const capabilities = { ...this.state.workspaceCapabilities };
      if (project.workspaceBinding.kind === "external") {
        capabilities[project.workspaceBinding.capabilityId] = project.dir;
      }
      await this.commit({
        ...this.state,
        lifecycleSequence: project.projectLifecycleRevision,
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
        role: "workspace",
        nameSource: "user",
        appPlacements: [],
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
        projectLifecycleRevision: this.state.lifecycleSequence + 1,
      });
      await this.commit({
        ...this.state,
        lifecycleSequence: project.projectLifecycleRevision,
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
          role: "workspace",
          nameSource: "app",
          appPlacements: [],
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

  rename(projectId: string, name: string, source: "app" | "user" = "user") {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      if (source === "app" && current.nameSource === "user") {
        return clone(current);
      }
      const project = storedProjectSchema.parse({
        ...current,
        name: name.trim(),
        nameSource: source,
        updatedAt: this.now(),
      });
      await this.replace(project);
      return clone(project);
    });
  }

  convertToBaseCustody(projectId: string) {
    return this.workspace.convertToBaseCustody(projectId);
  }

  setAppearance(projectId: string, appearance: ProjectAppearance) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      /* Appearance is presentation metadata, so it must not advance updatedAt. */
      const project = storedProjectSchema.parse({ ...current, appearance });
      await this.replace(project);
      return clone(project);
    });
  }

  beginDeletion(
    projectId: string,
    operation: ProjectRemovalOperation,
    plan: Readonly<{
      planVersion: 1;
      requiredParticipants: readonly string[];
      operationIntentId?: string | null;
    }>
  ) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      if (current.deletionCheckpoint) {
        if (
          current.deletionCheckpoint.operation !== operation ||
          current.deletionCheckpoint.operationIntentId !==
            (plan.operationIntentId ?? null)
        ) {
          throw conflict(
            `Project cleanup operation 已冻结为 ${current.deletionCheckpoint.operation}`
          );
        }
        return clone(current);
      }
      const projectLifecycleRevision = this.state.lifecycleSequence + 1;
      const project = storedProjectSchema.parse({
        ...current,
        projectLifecycleRevision,
        deletionCheckpoint: {
          projectLifecycleRevision,
          operation,
          operationIntentId: plan.operationIntentId ?? null,
          planVersion: plan.planVersion,
          requiredParticipants: [...plan.requiredParticipants],
          phase: "closing-admission",
          completedParticipants: [],
          frozenResourceAdmissions: clone(current.resourceAdmissions),
          blocked: null,
        },
      });
      await this.commit({
        ...this.state,
        lifecycleSequence: projectLifecycleRevision,
        projects: this.state.projects.map((item) =>
          item.id === projectId ? project : item
        ),
      });
      return clone(project);
    });
  }

  recordDeletionProgress(
    projectId: string,
    expectedRevision: number,
    update: Pick<ProjectDeletionCheckpoint, "phase" | "completedParticipants" | "blocked">
  ) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      const checkpoint = current.deletionCheckpoint;
      if (!checkpoint || current.projectLifecycleRevision !== expectedRevision) {
        throw conflict("Project cleanup fence 已变更");
      }
      const phases = [
        "closing-admission",
        "cleaning-resources",
        "ready-to-remove",
      ] as const;
      const currentPhase = phases.indexOf(checkpoint.phase);
      const nextPhase = phases.indexOf(update.phase);
      const priorCompleted = new Set(checkpoint.completedParticipants);
      const nextCompleted = new Set(update.completedParticipants);
      if (
        nextCompleted.size !== update.completedParticipants.length ||
        [...priorCompleted].some((id) => !nextCompleted.has(id)) ||
        nextPhase < currentPhase ||
        nextPhase > currentPhase + 1
      ) {
        throw conflict("Project cleanup progress 必须单调推进");
      }
      if (
        update.phase === "ready-to-remove" &&
        (update.blocked !== null ||
          checkpoint.requiredParticipants.some((id) => !nextCompleted.has(id)) ||
          nextCompleted.size !== checkpoint.requiredParticipants.length)
      ) {
        throw conflict("Project cleanup 冻结 plan 尚未精确完成");
      }
      const project = storedProjectSchema.parse({
        ...current,
        deletionCheckpoint: {
          projectLifecycleRevision: expectedRevision,
          operation: checkpoint.operation,
          operationIntentId: checkpoint.operationIntentId,
          planVersion: checkpoint.planVersion,
          requiredParticipants: checkpoint.requiredParticipants,
          frozenResourceAdmissions: checkpoint.frozenResourceAdmissions,
          ...update,
        },
      });
      await this.replace(project);
      return clone(project);
    });
  }

  cancelDeletion(projectId: string, expectedRevision: number) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      if (
        !current.deletionCheckpoint ||
        current.projectLifecycleRevision !== expectedRevision
      ) {
        throw conflict("Project cleanup fence 已变更");
      }
      if (current.resourceAdmissions.length) {
        throw conflict("Project cleanup 已冻结资源写入，不能在 admission 未收敛时取消");
      }
      if (
        current.deletionCheckpoint.phase !== "closing-admission" ||
        current.deletionCheckpoint.completedParticipants.length > 0 ||
        current.deletionCheckpoint.frozenResourceAdmissions.length > 0
      ) {
        throw conflict("Project cleanup 已产生不可逆进度，不能取消删除");
      }
      const projectLifecycleRevision = this.state.lifecycleSequence + 1;
      const { deletionCheckpoint: _checkpoint, ...rest } = current;
      const project = storedProjectSchema.parse({
        ...rest,
        projectLifecycleRevision,
      });
      await this.commit({
        ...this.state,
        lifecycleSequence: projectLifecycleRevision,
        projects: this.state.projects.map((item) =>
          item.id === projectId ? project : item
        ),
      });
      return clone(project);
    });
  }

  finalizeDeletion(projectId: string, expectedRevision: number) {
    return this.queue.enqueue(async () => {
      const current = this.require(projectId);
      if (
        current.projectLifecycleRevision !== expectedRevision ||
        current.deletionCheckpoint?.phase !== "ready-to-remove" ||
        current.resourceAdmissions.length > 0 ||
        current.deletionCheckpoint.blocked !== null ||
        current.deletionCheckpoint.requiredParticipants.some(
          (id) => !current.deletionCheckpoint!.completedParticipants.includes(id)
        ) ||
        current.deletionCheckpoint.completedParticipants.length !==
          current.deletionCheckpoint.requiredParticipants.length
      ) {
        throw conflict("Project cleanup 尚未完成");
      }
      const workspaceCapabilities = { ...this.state.workspaceCapabilities };
      const capabilityId = workspaceCapabilityId(current.workspaceBinding);
      if (capabilityId) delete workspaceCapabilities[capabilityId];
      await this.commit({
        ...this.state,
        projects: this.state.projects.filter((item) => item.id !== projectId),
        deletionReceipts: [
          ...this.state.deletionReceipts,
          {
            projectId,
            projectLifecycleRevision: expectedRevision,
            operation: current.deletionCheckpoint.operation,
            operationIntentId: current.deletionCheckpoint.operationIntentId,
            completedAt: this.now(),
          },
        ],
        workspaceCapabilities,
      });
    });
  }

  wasDeletedBy(
    projectId: string,
    operation: ProjectRemovalOperation,
    operationIntentId: string | null
  ) {
    this.assertReady();
    return this.state.deletionReceipts.some(
      (receipt) =>
        receipt.projectId === projectId &&
        receipt.operation === operation &&
        receipt.operationIntentId === operationIntentId
    );
  }

  getSortMode() {
    this.assertReady();
    return this.state.sortMode;
  }

  setSortMode(sortMode: ProjectsSortMode) {
    return this.queue.enqueue(async () => {
      const value = projectSortModeSchema.parse(sortMode);
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
      role: "workspace",
      nameSource: input.appId ? "app" : "user",
      appPlacements: [],
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
      projectLifecycleRevision: this.state.lifecycleSequence + 1,
    });
    const workspaceCapabilities = { ...this.state.workspaceCapabilities };
    if (project.workspaceBinding.kind === "external") {
      workspaceCapabilities[project.workspaceBinding.capabilityId] = project.dir;
    }
    await this.commit({
      ...this.state,
      lifecycleSequence: project.projectLifecycleRevision,
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
    if (!this.ready) throw new Error("ProjectStore 尚未通过持久化 authority 初始化");
    const validated = projectFileSchema.parse({
      ...next,
      commitGeneration: this.state.commitGeneration + 1,
    });
    try {
      await this.persistence.publishMirror(validated);
    } catch (cause) {
      /* A rejected fsync does not prove the preceding rename was absent. Keep
         this instance poisoned until initialize rereads both generations. */
      this.ready = false;
      throw cause;
    }
    this.state = validated;
  }

  resolveWorkspace(binding: ProjectWorkspaceBinding) {
    this.assertReady(); return this.workspace.resolve(binding);
  }
  setWorkspaceBinding(
    projectId: string,
    binding: ProjectWorkspaceBinding,
    externalDir?: string
  ) {
    return this.workspace.setBinding(projectId, binding, externalDir);
  }
  setArchivedAt(projectId: string, archivedAt: number | undefined) { return this.workspace.setArchivedAt(projectId, archivedAt); }

  setAppGrantRecord(projectId: string, grant: AppGrantRecord) { return this.workspace.setAppGrant(projectId, grant); }

  revokeAppGrant(projectId: string, appId: string) { return this.workspace.revokeAppGrant(projectId, appId); }

  private assertReady() {
    if (!this.ready) throw new Error("ProjectStore 尚未通过持久化 authority 初始化");
  }
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

function lifecycleError(code: string, message: string) {
  return Object.assign(new Error(message), { code, status: 409 });
}
