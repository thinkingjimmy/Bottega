/**
 * [INPUT]: Depends on Electron chooser, shared Project/Chat contracts, lifecycle-fenced ProjectStore, ProjectResourceCleanupCoordinator, rebind saga, and cross-domain cleanup ports
 * [OUTPUT]: Provides Project CRUD/branch/workspace operations, canonical lifecycle contexts, rebuildable removal handlers, and startup cleanup recovery
 * [POS]: Main Project authority; archive/rebind preserve incarnation while permanent removal is delegated only to the durable resource cleanup coordinator
 */

import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import {
  PROJECT_UNAVAILABLE,
  PROJECTS_CHANNEL,
  workspaceCapabilityId,
  type GitBranchTarget,
  type Project,
  type ProjectLocalDetachReason,
  type ProjectLocalDetachResult,
  type ProjectsEvent,
  type ProjectsSnapshot,
} from "../../../shared/projects-ipc";
import type { AppChatRole, ChatSummary } from "../../../shared/chats-ipc";
import type { AppLocale } from "../../../shared/i18n/locale";
import { translate } from "../../../shared/i18n/runtime";
import { errorMessage } from "../errors";
import { SerialQueue } from "../persistence/serial-queue";
import { statusError } from "./service/errors";
import { publishProjectsEvent } from "./service/renderer-policy";
import type { BuiltinMcpLease } from "../tools/lease";
import {
  assertWorkspaceDisjoint,
  isUsableDirectory,
} from "./fs-utils";
import {
  checkoutGitBranch,
  createGitBranch,
  listGitBranches,
} from "./git-branches";
import {
  ProjectStore,
  type ProjectRemovalOperation,
  type StoredProject,
} from "./project-store";
import {
  ProjectRebindJournal,
  type ProjectRebindCapsule,
  type ProjectRebindExpectation,
} from "./rebind-journal";
import {
  driveProjectRebind,
  isProjectRebindSource,
  isProjectRebindTarget,
} from "./rebind-saga";
import { ProjectResourceCleanupCoordinator } from "./resource-cleanup/coordinator";
import { registerProjectsServiceIpc } from "./projects-service-ipc";

export type ProjectsServiceOptions = {
  locale?: () => AppLocale;
  resolveApp: (appId: string) => { dir: string; name: string } | undefined;
  resolveAppForBinding?: (appId: string) => { dir: string; name: string } | undefined;
  isAppProjectAvailable: (appId: string) => boolean;
  listProjectRefs: () => Map<string, { latestUpdatedAt: number }>;
  removeChatsByProject: (projectId: string, projectLifecycle?: "held") => Promise<void>;
  removeBaseForProject?: (projectId: string) => Promise<void>;
  cancelTurnsByProject: (projectId: string) => Promise<void>;
  hasActiveTurnsByProject: (projectId: string) => boolean;
  getChatBinding: (chatId: string) =>
    { projectId: string | null; incarnationId: string } | undefined;
  assignProjectToChat: (chatId: string, projectId: string) => Promise<ChatSummary>;
  moveChatProject?: (
    chatId: string,
    expectedSource: string | null,
    target: string | null,
    appRole?: AppChatRole | null
  ) => Promise<ChatSummary>;
  publishChatUpserted: (summary: ChatSummary) => void;
  listChatsByProject: (projectId: string) => string[];
  hasPendingProjectCreation?: (projectId: string) => boolean;
  localDetachReasons?: (projectId: string) => ProjectLocalDetachReason[];
  releaseChatProject: (chatId: string) => Promise<ChatSummary>;
  /** userData + 全部 App dir；Project dir 由 store 自取。 */
  listManagedRoots: () => string[];
  /** Archive ProjectLifecycleGate 的即时投影；所有绑定/成员变更在 queue 内复核。 */
  isProjectOpen?: (projectId: string) => boolean;
  /**
   * D17/D26：把既有 Project 转成 App Project 前，先按固定全序取 gate 并复核该
   * Project 及其成员 chat 的 grant/active reference。必须包住整条 Store queue——
   * gate 只能在 queue 之外获取，反向获取会被 fail-fast 打死。
   */
  admitAppConversion?: <T>(
    projectId: string,
    work: () => Promise<T>
  ) => Promise<T>;
  snapshotMemoryRebind?: (
    projectId: string
  ) => Promise<ProjectRebindExpectation | null>;
  prepareMemoryRebind?: (
    projectId: string,
    operationId: string,
    expectation: ProjectRebindExpectation & { mode: "retain" | "new" }
  ) => Promise<{ applied: boolean }>;
  /** 删除 intent 已持久时，新的 workspace rebind 必须让路。 */
  hasDeletionFenceForProject?: (projectId: string) => boolean;
  /** 生产组合根必传；测试可省略以聚焦无 Memory 的旧路径。 */
  rebindJournal?: ProjectRebindJournal;
  onWorkspaceRebound?: (evidence: Pick<
    ProjectRebindCapsule,
    "operationId" | "projectId" | "sourceBinding" | "targetBinding"
  >) => Promise<void>;
  resourceCleanup: ProjectResourceCleanupCoordinator;
};

export class ProjectsService {
  private readonly queue = new SerialQueue();
  private readonly activeRebinds = new Set<Promise<unknown>>();
  private readonly deletingProjects = new Set<string>();
  private window: BrowserWindow | null = null;
  private admissionOpen = true;
  readonly resourceCleanup: ProjectResourceCleanupCoordinator;
  constructor(readonly store: ProjectStore,
    readonly options: ProjectsServiceOptions) {
    this.resourceCleanup = options.resourceCleanup;
    this.registerResourceCleanupHandlers();
  }
  async initialize() { await this.options.rebindJournal?.initialize(); }
  async recoverMemoryRebinds() {
    const journal = this.options.rebindJournal;
    if (!journal) return;
    for (const capsule of journal.list()) {
      try {
        await this.trackRebind(this.driveMemoryRebind(capsule));
      } catch (cause) {
        console.error(
          `[projects] workspace rebind ${capsule.operationId} 待恢复`,
          cause
        );
      }
    }
  }
  recoverResourceCleanup() {
    return this.resourceCleanup.recoverPending();
  }
  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    registerProjectsServiceIpc(window, rendererUrl, this);
    window.once("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  /** chooser 只冻结规范路径；history-import 的计数发生在真正落 Project 之前。 */
  async prepareExternalProject(window?: BrowserWindow) {
    this.assertAdmission();
    const options = {
      title: translate(
        this.options.locale?.() ?? "en",
        "settings.native.chooseProject"
      ),
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    };
    const parent = window ?? this.window;
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    const canonicalRoot = await realpath(selected);
    if (!isUsableDirectory(canonicalRoot)) throw new Error("所选文件夹不可用");
    return { canonicalRoot, name: basename(canonicalRoot) || canonicalRoot };
  }

  /** prepare→commit 的唯一落盘点；重复目录只返回已有实体，调用者不得重放 onboarding 配置。 */
  commitExternalProject(input: { canonicalRoot: string; name: string }) {
    return this.runExclusive(async () => {
      this.assertAdmission();
      const canonical = await realpath(input.canonicalRoot);
      if (!isUsableDirectory(canonical)) throw new Error("所选文件夹不可用");
      const existing = this.store.findByDir(canonical);
      if (existing) return { project: this.withMissing(existing), created: false } as const;
      assertWorkspaceDisjoint(canonical, this.managedDirs());
      const project = await this.store.add({
        name: input.name || basename(canonical) || canonical,
        dir: canonical,
        appId: null,
      });
      const wire = this.withMissing(project);
      this.emit({ type: "upserted", project: wire });
      return { project: wire, created: true } as const;
    });
  }
  list(): Promise<ProjectsSnapshot> {
    return this.queue.enqueue(async () => this.snapshot());
  }
  private snapshot(): ProjectsSnapshot {
    const stored = this.store.list();
    const storedIds = new Set(stored.map((project) => project.id));
    const placeholders = [...this.options.listProjectRefs()]
      .filter(([projectId]) => !storedIds.has(projectId))
      .map(([id, reference]): Project => ({
        id,
        name: "已丢失的 Project",
        dir: "",
        workspaceBinding: { kind: "none" },
        grants: [],
        grantRevision: 0,
        membershipRevision: 0,
        projectLifecycleRevision: 0,
        sortIndex: Number.MAX_SAFE_INTEGER,
        createdAt: reference.latestUpdatedAt,
        updatedAt: reference.latestUpdatedAt,
        missing: true,
      }))
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
      );
    return {
      projects: [...stored.map((project) => this.withMissing(project)), ...placeholders],
      sortMode: this.store.getSortMode(),
      ...(this.store.getWarning() ? { warning: this.store.getWarning() } : {}),
    };
  }
  managedDirs() {
    return [...this.options.listManagedRoots(), ...this.store.listDirs()];
  }
  withMissing(project: StoredProject): Project {
    const {
      deletionCheckpoint: _checkpoint,
      resourceAdmissions: _resourceAdmissions,
      ...wire
    } = project;
    const binding = project.workspaceBinding;
    /* external 由 opaque capability→路径；丢失判定只认 capability owner。 */
    const capabilityId = workspaceCapabilityId(binding);
    return {
      ...wire,
      missing: capabilityId
        ? !isUsableDirectory(this.store.resolveWorkspace(binding) ?? "")
        : binding.kind === "app" &&
            !this.options.isAppProjectAvailable(binding.appId),
    };
  }
  ensureForApp(appId: string) {
    const run = () => this.runExclusive(() => this.ensureForAppHeld(appId));
    /* 只有「收编一个既有普通 Project」才是转换；已经是 App Project 或将要新建的
       都没有可失去的授权，跳过 gate 而不是空转一遍全序。 */
    const adopted = this.adoptableProject(appId);
    return adopted && this.options.admitAppConversion
      ? this.options.admitAppConversion(adopted, run)
      : run();
  }
  private adoptableProject(appId: string) {
    if (this.store.findByAppId(appId)) return null;
    const dir =
      this.options.resolveAppForBinding?.(appId)?.dir ??
      this.options.resolveApp(appId)?.dir;
    const sameDir = dir ? this.store.findByDir(dir) : undefined;
    return sameDir && sameDir.workspaceBinding.kind !== "app"
      ? sameDir.id
      : null;
  }
  async ensureForAppHeld(appId: string, projectId?: string) {
      const app =
        this.options.resolveAppForBinding?.(appId) ??
        this.options.resolveApp(appId);
      if (!app) throw new Error("App 不可用（不存在或正在维护）");
      const existing =
        this.store.findByAppId(appId) ?? this.store.findByDir(app.dir);
      if (existing) {
        this.assertProjectOpen(existing.id);
        this.assertNoMemoryRebind(existing.id);
        this.assertNoPendingProjectCreation(existing.id);
      }
      const project = await this.store.ensureAppBinding({
        appId,
        ...app,
        ...(projectId ? { projectId } : {}),
      });
      const wire = this.withMissing(project);
      this.emit({ type: "upserted", project: wire });
      return wire;
  }
  isAppBinding(projectId: string, appId: string) {
    const binding = this.store.get(projectId)?.workspaceBinding;
    return binding?.kind === "app" && binding.appId === appId;
  }
  publishStored(projectId: string) {
    const stored = this.store.get(projectId);
    if (stored) this.emit({ type: "upserted", project: this.withMissing(stored) });
  }
  publishRemoved(projectId: string) {
    this.emit({ type: "removed", projectId });
  }
  /** 只能在 conversation 门闩内调用；App 可见性与可发送性在此明确分层。 */
  resolveCodexContext(projectId: string) {
    this.assertNoMemoryRebind(projectId);
    const project = this.store.get(projectId);
    if (!project) {
      throw new Error(`${PROJECT_UNAVAILABLE}: Project 记录不存在`);
    }
    const binding = project.workspaceBinding;
    if (binding.kind === "app") {
      const app =
        this.options.resolveAppForBinding?.(binding.appId) ??
        this.options.resolveApp(binding.appId);
      if (!app || !isUsableDirectory(app.dir)) {
        throw new Error("App 不可用（不存在或正在维护）");
      }
      return { workspace: app.dir, appId: binding.appId };
    }
    if (binding.kind === "none") {
      throw new Error(`${PROJECT_UNAVAILABLE}: Project 未绑定工作目录`);
    }
    const workspace = this.store.resolveWorkspace(binding);
    if (!workspace || !isUsableDirectory(workspace)) {
      throw new Error(`${PROJECT_UNAVAILABLE}: Project 文件夹已丢失`);
    }
    return { workspace };
  }
  getWorkspaceBinding(projectId: string) {
    return this.store.get(projectId)?.workspaceBinding;
  }
  getMembershipRevision(projectId: string) {
    return this.store.get(projectId)?.membershipRevision;
  }
  getProjectLifecycleRevision(projectId: string) {
    return this.store.projectLifecycleRevision(projectId);
  }
  resolveConversationContext(projectId: string, homeDir: string) {
    this.assertNoMemoryRebind(projectId);
    const project = this.store.get(projectId);
    if (!project) {
      throw new Error(`${PROJECT_UNAVAILABLE}: Project 记录不存在`);
    }
    return project.workspaceBinding.kind === "none"
      ? { workspace: homeDir }
      : this.resolveCodexContext(projectId);
  }
  async listBranches(projectId: string) {
    const workspace = this.branchWorkspace(projectId);
    return workspace ? listGitBranches(workspace) : null;
  }
  checkoutBranch(projectId: string, target: GitBranchTarget) {
    return this.runBranchMutation(projectId, (workspace) =>
      checkoutGitBranch(workspace, target)
    );
  }
  createBranch(projectId: string, name: string) {
    return this.runBranchMutation(projectId, (workspace) =>
      createGitBranch(workspace, name)
    );
  }
  async deleteProjectData(projectId: string) {
    await this.runExclusive(async () => {
      this.assertProjectRemovalOpen(projectId, "delete-project-data");
      this.assertNoMemoryRebind(projectId);
      this.assertNoPendingProjectCreation(projectId);
      const binding = this.store.get(projectId)?.workspaceBinding;
      if (binding?.kind === "app") {
        throw statusError(403, "App Project 请从 Apps 页删除");
      }
      this.deletingProjects.add(projectId);
    });
    try {
      /* Project queue 只负责发布 product fence；cancel、Policy/Delivery drain 与
         Chat bytes 删除都在门外推进，避免一个慢 provider 阻塞全局 Project。 */
      await this.resourceCleanup.remove(projectId, "delete-project-data");
      this.emit({ type: "removed", projectId });
    } finally {
      this.deletingProjects.delete(projectId);
    }
  }
  detachLocalProject(projectId: string): Promise<ProjectLocalDetachResult> {
    return this.runExclusive(async () => {
      this.assertProjectRemovalOpen(projectId, "detach-local-project");
      this.assertNoMemoryRebind(projectId);
      this.assertNoPendingProjectCreation(projectId);
      const project = this.store.get(projectId);
      if (!project) throw statusError(404, "Project 不存在");
      if (project.workspaceBinding.kind === "app") {
        throw statusError(403, "App Project 请从 Apps 页管理");
      }
      if (this.options.hasActiveTurnsByProject(projectId)) {
        throw statusError(409, "Project 正在运行任务，结束后再移除");
      }
      const reasons = [
        ...new Set(this.options.localDetachReasons?.(projectId) ?? []),
      ];
      if (reasons.length) {
        return { status: "archive-required", reasons };
      }
      const chatIds = this.options.listChatsByProject(projectId);
      await this.resourceCleanup.remove(projectId, "detach-local-project");
      this.emit({ type: "removed", projectId });
      return { status: "detached", movedChatCount: chatIds.length };
    });
  }
  async removeAppProjectHeld(projectId: string, appId: string) {
    this.assertNoMemoryRebind(projectId);
    const binding = this.store.get(projectId)?.workspaceBinding;
    if (binding?.kind !== "app" || binding.appId !== appId) {
      throw new Error("Project 不属于目标 App");
    }
    await this.removeProjectHeld(projectId);
  }
  /** Archive purge 已完成 chat 删除；仍必须经过统一资源收敛器后才能删 Project 行。 */
  async purgeProjectHeld(
    projectId: string,
    purgeIntentId: string
  ) {
    await this.resourceCleanup.remove(projectId, "archive-purge", purgeIntentId);
    this.emit({ type: "removed", projectId });
  }
  async detachAppProjectHeld(projectId: string, appId: string) {
    this.assertNoMemoryRebind(projectId);
    const binding = this.store.get(projectId)?.workspaceBinding;
    if (binding?.kind !== "app" || binding.appId !== appId) {
      throw new Error("Project 不属于目标 App");
    }
    const stored = await this.store.setWorkspaceBinding(
      projectId,
      { kind: "none" }
    );
    const project = this.withMissing(stored);
    this.emit({ type: "upserted", project });
    return project;
  }
  async moveChatProjectHeld(
    chatId: string,
    expectedSource: string | null,
    target: string | null,
    appRole?: AppChatRole | null
  ) {
    if (!this.options.moveChatProject) {
      throw new Error("当前 Projects 组合缺少 chat project 移动能力");
    }
    if (expectedSource) this.assertProjectOpen(expectedSource);
    if (target) this.assertProjectOpen(target);
    const summary = await this.options.moveChatProject(
      chatId,
      expectedSource,
      target,
      appRole
    );
    this.options.publishChatUpserted(summary);
    return summary;
  }
  /** Save 补偿专用：成员已迁回后只移除本次预分配的空 App Project。 */
  async rollbackAppProjectHeld(projectId: string, appId: string) {
    this.assertNoMemoryRebind(projectId);
    const project = this.store.get(projectId);
    if (!project) return;
    const binding = project.workspaceBinding;
    if (binding.kind !== "app" || binding.appId !== appId) {
      throw new Error("回滚 Project 不属于目标 App");
    }
    if (this.options.listChatsByProject(projectId).length > 0) {
      throw new Error("回滚 App Project 仍有成员 chat");
    }
    await this.resourceCleanup.remove(
      projectId,
      "rollback-app-project"
    );
    this.emit({ type: "removed", projectId });
  }
  private async removeProjectHeld(projectId: string) {
    await this.resourceCleanup.remove(projectId, "delete-app-project");
    this.emit({ type: "removed", projectId });
  }
  convertFromChat(input: { lease: BuiltinMcpLease; name: string }) {
    return this.runExclusive(async () => {
      const { lease } = input;
      if (lease.state === "revoked") {
        throw statusError(401, "内置 MCP lease 已撤销");
      }
      const binding = this.options.getChatBinding(lease.chatId);
      if (!binding || binding.incarnationId !== lease.incarnationId) {
        throw statusError(404, "聊天不存在或已被替换");
      }
      if (binding.projectId !== null) {
        throw statusError(409, "当前聊天已经属于某个 Project");
      }
      let project: StoredProject;
      try {
        project = await this.store.addGrouping(input.name);
      } catch (cause) {
        throw statusError(500, errorMessage(cause), cause);
      }
      let chat: ChatSummary;
      try {
        chat = await this.options.assignProjectToChat(
          lease.chatId,
          project.id
        );
      } catch (primary) {
        const residue: string[] = [];
        try {
          await this.resourceCleanup.remove(
            project.id,
            "convert-compensation"
          );
        } catch (cleanupCause) {
          residue.push(`Project 记录 ${project.id}`);
          console.error("[projects] 补偿 remove 失败", cleanupCause);
        }
        const survivor = this.store.get(project.id);
        if (survivor) {
          this.emit({
            type: "upserted",
            project: this.withMissing(survivor),
          });
        } else {
          this.emit({ type: "removed", projectId: project.id });
        }
        const suffix = residue.length
          ? `（补偿未完成，请手动清理：${residue.join("、")}）`
          : "";
        throw statusError(500, `${errorMessage(primary)}${suffix}`, primary);
      }
      const wire = this.withMissing(project);
      this.emit({ type: "upserted", project: wire });
      this.options.publishChatUpserted(chat);
      return {
        project_id: project.id,
        project_name: project.name,
        project_dir: project.dir,
        chat_id: chat.id,
        note: "转换已完成；Project 仅用于分组，下一轮仍使用 Chat Home，可在设置中另行绑定工作目录。",
      };
    });
  }
  releaseMissing(projectId: string) {
    return this.runExclusive(async () => {
      if (this.store.get(projectId)) {
        throw statusError(409, "只允许抢救 Project 记录已丢失的聊天");
      }
      const chatIds = this.options.listChatsByProject(projectId);
      for (const chatId of chatIds) {
        await this.options.releaseChatProject(chatId);
      }
      this.emit({ type: "removed", projectId });
      return chatIds.length;
    });
  }
  runExclusive<T>(job: () => Promise<T>): Promise<T> {
    this.assertAdmission();
    return this.queue.enqueue(job);
  }
  /** 只能在 runExclusive 任务内调用；调用方必须维持 Lifecycle → ChatStore 锁序。 */
  isUsable(projectId: string) {
    if (this.deletingProjects.has(projectId)) return false;
    const project = this.store.get(projectId);
    return Boolean(project && !this.withMissing(project).missing);
  }
  private branchWorkspace(projectId: string) {
    this.assertNoMemoryRebind(projectId);
    const project = this.store.get(projectId);
    if (
      !project ||
      !this.isProjectOpen(projectId) ||
      this.withMissing(project).missing
    ) {
      return null;
    }
    const binding = project.workspaceBinding;
    if (binding.kind === "app") {
      return this.options.resolveApp(binding.appId)?.dir ?? null;
    }
    return binding.kind === "external"
      ? this.store.resolveWorkspace(binding) ?? null
      : null;
  }
  private runBranchMutation<T>(
    projectId: string,
    mutate: (workspace: string) => Promise<T>
  ) {
    return this.runExclusive(async () => {
      const workspace = this.branchWorkspace(projectId);
      if (!workspace) throw new Error(`${PROJECT_UNAVAILABLE}: Project 不可用`);
      if (this.options.hasActiveTurnsByProject(projectId)) {
        throw new Error("Project 正在运行任务，停止后再切换 branch");
      }
      return mutate(workspace);
    });
  }
  stopAdmission() {
    this.admissionOpen = false;
  }
  async closeAndFlush() {
    await Promise.allSettled([...this.activeRebinds]);
    this.queue.close();
    await this.queue.flush();
    await this.options.rebindJournal?.closeAndFlush();
  }
  reopen() {
    this.queue.reopen();
    this.admissionOpen = true;
  }

  private assertAdmission() {
    if (!this.admissionOpen) throw new Error("应用正在退出，Project 操作已关闭");
  }

  private isProjectOpen(projectId: string) {
    return !this.deletingProjects.has(projectId) &&
      !this.store.get(projectId)?.deletionCheckpoint &&
      (this.options.isProjectOpen?.(projectId) ?? true);
  }

  assertProjectOpen(projectId: string) {
    if (!this.isProjectOpen(projectId)) {
      throw new Error("ARCHIVED: Project 不接受绑定或结构变更");
    }
  }

  private assertProjectRemovalOpen(
    projectId: string,
    operation: ProjectRemovalOperation
  ) {
    const checkpoint = this.store.get(projectId)?.deletionCheckpoint;
    if (
      this.deletingProjects.has(projectId) ||
      (checkpoint && checkpoint.operation !== operation) ||
      !(this.options.isProjectOpen?.(projectId) ?? true)
    ) {
      throw new Error("ARCHIVED: Project 不接受绑定或结构变更");
    }
  }

  assertNoMemoryRebind(projectId: string) {
    if (this.deletingProjects.has(projectId)) {
      throw statusError(409, "Project 正在删除，请稍后重试");
    }
    if (this.options.rebindJournal?.get(projectId)) {
      throw statusError(409, "Project 工作目录正在安全改绑；完成 Memory 对账后再试");
    }
  }
  private assertNoPendingProjectCreation(projectId: string) {
    if (this.options.hasPendingProjectCreation?.(projectId)) {
      throw statusError(
        409,
        "Project 正在兑现待恢复的 Section 创建；完成或失败收敛前不能删除或转换"
      );
    }
  }
  assertWorkspaceRebindAllowed(projectId: string) {
    this.assertNoMemoryRebind(projectId);
    if (this.options.hasDeletionFenceForProject?.(projectId)) {
      throw statusError(409, "Project 中有 Chat 删除待完成，请稍后重试改绑");
    }
  }

  trackRebind<T>(operation: Promise<T>) {
    this.activeRebinds.add(operation);
    void operation
      .finally(() => this.activeRebinds.delete(operation))
      .catch(() => {});
    return operation;
  }

  private registerResourceCleanupHandlers() {
    this.resourceCleanup.registerRuntime("delete-project-data", (context) =>
      this.cleanupProjectRuntime(context.projectId, undefined)
    );
    this.resourceCleanup.registerRuntime("delete-app-project", (context) =>
      this.cleanupProjectRuntime(context.projectId, "held")
    );
    this.resourceCleanup.registerRuntime("detach-local-project", (context) =>
      this.detachProjectRuntime(context.projectId)
    );
    this.resourceCleanup.registerRuntime("archive-purge", (context) =>
      this.options.removeBaseForProject?.(context.projectId) ?? Promise.resolve()
    );
    this.resourceCleanup.registerRuntime("rollback-app-project", async () => undefined);
    this.resourceCleanup.registerRuntime("convert-compensation", async () => undefined);
  }

  private async cleanupProjectRuntime(
    projectId: string,
    lifecycle?: "held"
  ) {
    await this.options.cancelTurnsByProject(projectId);
    await this.options.removeChatsByProject(projectId, lifecycle);
    await this.options.removeBaseForProject?.(projectId);
  }

  private async detachProjectRuntime(projectId: string) {
    for (const chatId of this.options.listChatsByProject(projectId)) {
      await this.options.releaseChatProject(chatId);
    }
  }

  async driveMemoryRebind(capsule: ProjectRebindCapsule) {
    const journal = this.options.rebindJournal;
    return driveProjectRebind({
      capsule,
      journal,
      prepare: this.options.prepareMemoryRebind,
      commit: () =>
        this.queue.enqueue(async () => {
          const current = this.store.get(capsule.projectId);
          if (!current) {
            throw new Error("Project 记录已丢失，rebind capsule 需要人工对账");
          }
          if (isProjectRebindTarget(current, capsule)) {
            await this.options.onWorkspaceRebound?.(capsule);
            await journal?.finish(capsule.operationId);
            return this.withMissing(current);
          }
          if (!isProjectRebindSource(current, capsule)) {
            throw new Error("Project binding 已变化，rebind capsule 需要人工对账");
          }
          const stored = await this.store.setWorkspaceBinding(
            capsule.projectId,
            capsule.targetBinding,
            capsule.targetDir
          );
          await this.options.onWorkspaceRebound?.(capsule);
          await journal?.finish(capsule.operationId);
          const project = this.withMissing(stored);
          this.emit({ type: "upserted", project });
          return project;
        }),
    });
  }

  emit(event: ProjectsEvent) {
    publishProjectsEvent(PROJECTS_CHANNEL.event, event, this.window);
  }
}
