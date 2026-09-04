/**
 * [INPUT]: Depends on Electron IPC, Node crypto/fs, Chat/Project stores, ChatHome/Purge journals, Coordinator pending CreationIntent/conversation critical area, ProjectsService durable cleanup, ChatsService deletion-resource chain, and optional Memory rebuild port
 * [OUTPUT]: Provides ArchiveService: explicitly archived Agent-identified Chat projection carrying read-only capability, admission-first immutable local-only/cleanup-and-rebuild purge that refuses read-only Chats, short Project intent/CAS, canonical+pending member snapshot, verified/record-only tokenized preview, and legacy Home convergence through the shared deletion helper
 * [POS]: The trans-book coordinator of the archive module; The product gate only packs intent/CAS, Memory receipt/drain/network both outside the gate and hold multiple conversation locks at different times
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { BrowserWindow } from "electron";
import {
  ARCHIVE_CHANNEL,
  type ArchiveEvent,
  type ArchivePurgeMode,
  type ArchiveSnapshot,
  type ArchiveTarget,
  type PurgeMemoryPreview,
  type PurgePreview,
} from "../../../shared/archive-ipc";
import type { ChatStore } from "../chats/chat-store";
import type { ChatsService } from "../chats/chats-service";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import type { PurgeJournal } from "../chat-home/purge-journal";
import type { ChatHomeRecord } from "../chat-home/ledger-values";
import type { ProjectStore } from "../projects/store/project-store";
import type { ProjectsService } from "../projects/projects-service";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import { rendererIpc } from "../ipc-registrar";
import { SerialQueue } from "../persistence/serial-queue";
import { errorMessage } from "../errors";
import { appearsInArchive } from "../../../shared/placement/archive";

type ProjectGateState = "open" | "archiving" | "archived" | "purging";

type PreviewState = {
  targets: ArchiveTarget[];
  members: Array<{ chatId: string; incarnationId: string }>;
  blockedReasons: string[];
  chatRevision: number;
  projectRevisions: Record<string, number>;
  homes: Array<{
    chatId: string;
    authorization: "delete" | "record-only";
    record: ChatHomeRecord | null;
  }>;
  memory: PurgeMemoryPreview | null;
  expiresAt: number;
};

type ArchiveMemoryPurge = {
  preview(excludedChatIds: ReadonlySet<string>): Promise<PurgeMemoryPreview | null>;
  cleanupAndRebuild(
    operationId: string,
    target: PurgeMemoryPreview
  ): Promise<void>;
};

const targetKey = (target: ArchiveTarget) => `${target.kind}:${target.id}`;
const sameTargets = (left: ArchiveTarget[], right: ArchiveTarget[]) =>
  JSON.stringify(left.map(targetKey).sort()) ===
  JSON.stringify(right.map(targetKey).sort());

export class ArchiveService {
  private readonly queue = new SerialQueue();
  private readonly gates = new Map<string, ProjectGateState>();
  private readonly previews = new Map<string, PreviewState>();
  private readonly secret = randomBytes(32);
  private revision = 0;
  private window: BrowserWindow | null = null;

  constructor(
    private readonly chats: ChatStore,
    private readonly projects: ProjectStore,
    private readonly chatHomes: ChatHomeService,
    private readonly purgeJournal: PurgeJournal,
    private readonly coordinator: ConversationCoordinator,
    private readonly chatsService: ChatsService,
    private readonly projectsService: ProjectsService,
    private readonly now: () => number = Date.now,
    private readonly countRootBases: (chatIds: ReadonlySet<string>) => number =
      () => 0,
    private readonly memoryPurge?: ArchiveMemoryPurge
  ) {}

  async initialize() {
    const warning = await this.purgeJournal.initialize();
    if (warning) this.chats.pushWarning(warning);
    for (const project of this.projects.list()) {
      this.gates.set(
        project.id,
        this.purgeJournal.hasActiveProject(project.id)
          ? "purging"
          : project.archivedAt
            ? "archived"
            : "open"
      );
    }
    await this.recoverPurge();
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    rendererIpc(window, rendererUrl, "拒绝非主窗口的归档请求")
      .handle(ARCHIVE_CHANNEL.list, () => this.snapshot())
      .handle(ARCHIVE_CHANNEL.archive, (targets) =>
        this.archive(this.assertTargets(targets))
      )
      .handle(ARCHIVE_CHANNEL.restore, (targets) =>
        this.restore(this.assertTargets(targets))
      )
      .handle(ARCHIVE_CHANNEL.previewPurge, (targets) =>
        this.previewPurge(this.assertTargets(targets))
      )
      .handle(ARCHIVE_CHANNEL.executePurge, (token, targets, mode) => {
        if (typeof token !== "string") throw new Error("executionToken 无效");
        return this.executePurge(
          token,
          this.assertTargets(targets),
          this.assertPurgeMode(mode)
        );
      });
    window.once("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  snapshot(): ArchiveSnapshot {
    const entities = [
      ...this.projects
        .list()
        .filter(
          (project) =>
            project.role !== "base-custody" && project.archivedAt !== undefined
        )
        .map((project) => ({
          target: { kind: "project" as const, id: project.id },
          title: project.name,
          archivedAt: project.archivedAt!,
          memberCount: this.chats.listByProject(project.id).length,
        })),
      ...this.chats
        .list()
        .filter(appearsInArchive)
        .map((chat) => ({
          target: { kind: "chat" as const, id: chat.id },
          title: chat.title ?? "未命名聊天",
          archivedAt: chat.archivedAt!,
          memberCount: 0,
          agent: chat.agent,
          ...(chat.readOnlyReason ? { readOnly: true } : {}),
        })),
    ].sort(
      (left, right) =>
        right.archivedAt - left.archivedAt ||
        targetKey(left.target).localeCompare(targetKey(right.target))
    );
    return { entities, revision: this.revision };
  }

  isProjectOpen(projectId: string) {
    return this.projectGateState(projectId) === "open";
  }

  getConversationAvailability(
    chatId: string,
    fallbackProjectId?: string | null
  ): "open" | "blocked" | "archived" {
    const summary = this.chats.list().find((chat) => chat.id === chatId);
    if (summary?.archivedAt) return "archived";
    const projectId = summary?.projectId ?? fallbackProjectId;
    if (!summary && fallbackProjectId === undefined) return "archived";
    if (!projectId) return "open";
    const state = this.projectGateState(projectId);
    if (state === "open") return "open";
    return state === "archiving" ? "blocked" : "archived";
  }

  isConversationAvailable(chatId: string) {
    return this.getConversationAvailability(chatId) === "open";
  }

  archive(targets: ArchiveTarget[]) {
    return this.queue.enqueue(async () => {
      const now = this.now();
      let committed = false;
      try {
        for (const target of this.unique(targets)) {
          if (target.kind === "chat") {
            await this.withArchivableConversation(target.id, async () => {
              const candidate = this.chats.getMetadata(target.id);
              if (!candidate) throw new Error("Chat 不存在");
              await this.chatsService.prepareForArchive?.(candidate);
              await this.coordinator.failArchived(target.id);
              const record = await this.chats.setArchivedAt(target.id, now);
              this.chatsService.publishRecord(record);
            });
            committed = true;
            continue;
          }
          await this.projectsService.runExclusive(async () => {
            if (this.purgeJournal.hasActiveProject(target.id)) {
              throw new Error("Project 正在清理，不能重复归档");
            }
            const project = this.projects.get(target.id);
            if (!project) throw new Error("Project 不存在");
            if (project.workspaceBinding.kind === "app") {
              throw new Error("App Project 请从 Apps 页删除，不能直接归档");
            }
            const chatIds = this.projectConversationIds(target.id);
            this.gates.set(target.id, "archiving");
            try {
              for (const chatId of chatIds) {
                await this.withArchivableConversation(chatId, async () => {});
              }
              await this.projects.setArchivedAt(target.id, now);
            } catch (cause) {
              this.gates.set(target.id, "open");
              this.coordinator.resumeConversations(chatIds);
              throw cause;
            }
            this.gates.set(target.id, "archived");
            this.projectsService.publishStored(target.id);
            for (const chatId of chatIds) {
              await this.coordinator
                .runConversationExclusive(chatId, () =>
                  this.coordinator.failArchived(chatId)
                )
                .catch((cause) => {
                  this.chats.pushWarning(
                    `Project 已归档，但 Chat ${chatId} 队列清理待重试：${errorMessage(cause)}`
                  );
                });
              const record = this.chats.getMetadata(chatId);
              if (record) this.chatsService.publishEffectiveArchive(record, true);
            }
          });
          committed = true;
        }
      } catch (cause) {
        if (committed) this.changed();
        throw cause;
      }
      return this.changed();
    });
  }

  restore(targets: ArchiveTarget[]) {
    return this.queue.enqueue(async () => {
      let committed = false;
      try {
        for (const target of this.unique(targets)) {
          if (target.kind === "chat") {
            const candidate = this.chats.getMetadata(target.id);
            /* 导入历史是只读但活着的会话：归档过就必须恢复得回来。
               真正回不来的只有旧版 App Edit 那种失去可编辑性的记录。 */
            if (candidate?.readOnlyReason === "legacy-app-not-editable") {
              throw new Error("Read-only legacy App Edit chats cannot be restored");
            }
            const memberProjectId = this.chats.getProjectId(target.id);
            if (
              memberProjectId &&
              this.purgeJournal.hasActiveProject(memberProjectId)
            ) {
              throw new Error("所属 Project 正在清理，不能恢复该聊天");
            }
            const record = await this.chats.setArchivedAt(target.id, undefined);
            this.chatsService.publishEffectiveArchive(
              record,
              Boolean(
                record.projectId &&
                  this.projects.get(record.projectId)?.archivedAt
              )
            );
            committed = true;
            continue;
          }
          await this.projectsService.runExclusive(async () => {
            if (this.purgeJournal.hasActiveProject(target.id)) {
              throw new Error("Project 正在清理，不能恢复");
            }
            await this.projects.setArchivedAt(target.id, undefined);
            this.projectsService.publishStored(target.id);
            for (const chatId of this.chats.listByProject(target.id)) {
              const record = this.chats.getMetadata(chatId);
              if (record) {
                this.chatsService.publishEffectiveArchive(
                  record,
                  Boolean(record.archivedAt)
                );
              }
            }
            this.gates.set(target.id, "open");
          });
          committed = true;
        }
      } catch (cause) {
        if (committed) this.changed();
        throw cause;
      }
      return this.changed();
    });
  }

  async previewPurge(targets: ArchiveTarget[]): Promise<PurgePreview> {
    for (const [token, state] of this.previews) {
      if (state.expiresAt < this.now()) this.previews.delete(token);
    }
    const normalized = this.foldTargets(this.unique(targets));
    const members = this.membersOf(normalized);
    const blockedReasons: string[] = [];
    for (const target of normalized) {
      if (target.kind === "chat") {
        const chat = this.chats.list().find((item) => item.id === target.id);
        if (!chat?.archivedAt) blockedReasons.push(`Chat ${target.id} 未显式归档`);
        else if (chat.readOnlyReason) {
          blockedReasons.push(`Chat ${target.id} 是只读内容，不能永久删除`);
        }
      } else if (!this.projects.get(target.id)?.archivedAt) {
        blockedReasons.push(`Project ${target.id} 未显式归档`);
      } else if (
        this.projects.get(target.id)?.workspaceBinding.kind === "app"
      ) {
        blockedReasons.push(
          `Project ${target.id} 属于 App，请先从 Apps 页删除`
        );
      }
    }
    const projectRevisions = Object.fromEntries(
      normalized
        .filter((target) => target.kind === "project")
        .map((target) => [
          target.id,
          this.projects.get(target.id)?.updatedAt ?? -1,
        ])
    );
    const homes = await Promise.all(
      members.map(({ chatId }) => this.previewHome(chatId))
    );
    const excludedChatIds = new Set(members.map(({ chatId }) => chatId));
    const memory = this.memoryPurge
      ? await this.memoryPurge.preview(excludedChatIds).catch(() => null)
      : null;
    const state: PreviewState = {
      targets: normalized,
      members,
      blockedReasons,
      chatRevision: this.chats.getStoreRevision(),
      projectRevisions,
      homes,
      memory,
      expiresAt: this.now() + 5 * 60_000,
    };
    const executionToken = this.sign(state);
    this.previews.set(executionToken, state);
    const retainedExternalBindings = normalized.flatMap((target) => {
      if (target.kind !== "project") return [];
      const project = this.projects.get(target.id);
      const binding = project?.workspaceBinding;
      if (!project || !binding || binding.kind === "none") return [];
      /* worktree 与 external 一样是「归档不会删掉的真实目录」；App 只报身份。 */
      return [binding.kind === "app" ? `app:${binding.appId}` : project.dir];
    });
    return {
      deletePaths: homes.flatMap((home) =>
        home.authorization === "delete" && home.record
          ? [home.record.homeDir]
          : []
      ),
      retainedExternalBindings,
      rootBaseCount: this.countRootBases(
        new Set(members.map(({ chatId }) => chatId))
      ),
      blockedReasons,
      memory,
      executionToken,
    };
  }

  executePurge(
    token: string,
    targets: ArchiveTarget[],
    mode: ArchivePurgeMode = "local-only"
  ) {
    return this.queue.enqueue(async () => {
      const preview = this.previews.get(token);
      const currentHomes = preview
        ? await Promise.all(
            preview.homes.map((home) => this.previewHome(home.chatId))
          )
        : [];
      const currentMemory =
        preview && mode === "cleanup-and-rebuild" && this.memoryPurge
          ? await this.memoryPurge
              .preview(new Set(preview.members.map(({ chatId }) => chatId)))
              .catch(() => null)
          : preview?.memory ?? null;
      if (
        !preview ||
        preview.expiresAt < this.now() ||
        !sameTargets(preview.targets, this.foldTargets(this.unique(targets))) ||
        preview.chatRevision !== this.chats.getStoreRevision() ||
        Object.entries(preview.projectRevisions).some(
          ([id, revision]) => this.projects.get(id)?.updatedAt !== revision
        ) ||
        preview.members.some(
          (member) =>
            this.chats.getIncarnationId(member.chatId) !== member.incarnationId
        ) ||
        JSON.stringify(currentHomes) !== JSON.stringify(preview.homes) ||
        (mode === "cleanup-and-rebuild" &&
          JSON.stringify(currentMemory) !== JSON.stringify(preview.memory))
      ) {
        this.previews.delete(token);
        throw new Error("删除预览已失效，请重新预览");
      }
      this.previews.delete(token);
      if (preview.blockedReasons.length > 0) {
        throw new Error(preview.blockedReasons.join("；"));
      }
      if (mode === "cleanup-and-rebuild" && !preview.memory) {
        throw new Error("当前 Memory 目标不可重建，请选择仅删除本机数据");
      }
      await this.chatsService.admitDeletion(
        preview.members.map((member) => member.chatId)
      );
      await this.runPurge(
        preview.targets,
        preview.members,
        preview.homes
          .filter((home) => home.authorization === "delete")
          .map((home) => home.chatId),
        mode,
        mode === "cleanup-and-rebuild" ? preview.memory : null
      );
      return this.changed();
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
    await this.purgeJournal.closeAndFlush();
  }

  reopen() {
    this.queue.reopen();
    this.purgeJournal.reopen();
  }

  private async runPurge(
    targets: ArchiveTarget[],
    members: Array<{ chatId: string; incarnationId: string }>,
    homeDeletionChatIds: string[],
    deletionMode: ArchivePurgeMode,
    memoryTarget: PurgeMemoryPreview | null,
    existingIntentId?: string
  ) {
    return this.runPurgeInsideGate(
      targets,
      members,
      homeDeletionChatIds,
      deletionMode,
      memoryTarget,
      existingIntentId
    );
  }

  private async runPurgeInsideGate(
    targets: ArchiveTarget[],
    members: Array<{ chatId: string; incarnationId: string }>,
    homeDeletionChatIds: string[],
    deletionMode: ArchivePurgeMode,
    memoryTarget: PurgeMemoryPreview | null,
    existingIntentId?: string
  ) {
    const now = this.now();
    const intentId = existingIntentId ?? randomUUID();
    const primary = targets[0]!;
    const durable = await this.projectsService.runExclusive(async () => {
      const intent = await this.purgeJournal.put({
        intentId,
        target: primary,
        targets,
        members,
        homeDeletionChatIds,
        deletionMode,
        memoryTarget,
        phase: "planned",
        completedChatIds: [],
        trashPaths: [],
        createdAt: now,
        updatedAt: now,
      });
      for (const target of targets) {
        if (target.kind === "project") this.gates.set(target.id, "purging");
      }
      return intent;
    });
    const completed = new Set(durable.completedChatIds);
    const trashPaths = new Set(durable.trashPaths);
    const deletableHomes = new Set(
      durable.homeDeletionChatIds ?? durable.members.map((member) => member.chatId)
    );
    try {
      for (const member of members) {
        if (completed.has(member.chatId)) continue;
        if (!this.chats.has(member.chatId)) {
          if (deletableHomes.has(member.chatId)) {
            await this.chatHomes.releaseHomeForDeletion(
              { id: member.chatId, incarnationId: member.incarnationId },
              `${intentId}:legacy-home:${member.chatId}`
            );
          } else {
            await this.chatHomes.ledger.removeOwnership(member.chatId);
          }
          completed.add(member.chatId);
          await this.purgeJournal.patch(intentId, {
            phase: "relatedDeleted",
            completedChatIds: [...completed],
            trashPaths: [...trashPaths],
            updatedAt: this.now(),
          });
          continue;
        }
        if (this.chats.getIncarnationId(member.chatId) !== member.incarnationId) {
          throw new Error(`Chat ${member.chatId} incarnation 已漂移`);
        }
        await this.coordinator.runConversationExclusive(
          member.chatId,
          async () => {
            if (this.coordinator.hasDurableActiveTurn(member.chatId)) {
              throw new Error(`Chat ${member.chatId} 仍有活动 turn`);
            }
            await this.chatsService.removeFromPurge(
              member.chatId,
              durable.deletionMode
            );
            await this.purgeJournal.patch(intentId, {
              phase: "recordDeleted",
              updatedAt: this.now(),
            });
            if (deletableHomes.has(member.chatId)) {
              await this.chatHomes.releaseHomeForDeletion(
                { id: member.chatId, incarnationId: member.incarnationId },
                `delete:${member.chatId}:${member.incarnationId}`
              );
            } else {
              await this.chatHomes.ledger.removeOwnership(member.chatId);
            }
            await this.purgeJournal.patch(intentId, {
              phase: "homeMoved",
              trashPaths: [...trashPaths],
              updatedAt: this.now(),
            });
            completed.add(member.chatId);
            await this.purgeJournal.patch(intentId, {
              phase: "relatedDeleted",
              completedChatIds: [...completed],
              trashPaths: [...trashPaths],
              updatedAt: this.now(),
            });
          }
        );
      }
      for (const target of targets) {
        if (target.kind === "project") {
          await this.projectsService.runExclusive(async () => {
            await this.projectsService.purgeProjectHeld(target.id, intentId);
            await this.purgeJournal.patch(intentId, {
              phase: "projectBaseRemoved",
              updatedAt: this.now(),
            });
          });
        }
      }
      for (const path of trashPaths) {
        await rm(path, { recursive: true, force: true });
      }
      if (durable.deletionMode === "cleanup-and-rebuild") {
        if (!this.memoryPurge || !durable.memoryTarget) {
          throw new Error("Memory 重建端口不可用");
        }
        await this.memoryPurge.cleanupAndRebuild(
          `${intentId}:memory-rebuild`,
          durable.memoryTarget
        );
        await this.purgeJournal.patch(intentId, {
          phase: "memoryRebuilt",
          updatedAt: this.now(),
        });
      }
      await this.purgeJournal.patch(intentId, {
        phase: "completed",
        completedChatIds: [...completed],
        trashPaths: [...trashPaths],
        terminalAt: this.now(),
        updatedAt: this.now(),
      });
      for (const target of targets) {
        if (target.kind === "project") this.gates.delete(target.id);
      }
    } catch (cause) {
      await this.purgeJournal.patch(intentId, {
        phase: "failed",
        completedChatIds: [...completed],
        trashPaths: [...trashPaths],
        error: "purge-failed",
        updatedAt: this.now(),
      });
      throw cause;
    }
  }

  private async recoverPurge() {
    for (const intent of this.purgeJournal.listActive()) {
      try {
        await this.runPurge(
          intent.targets,
          intent.members,
          intent.homeDeletionChatIds ??
            intent.members.map((member) => member.chatId),
          intent.deletionMode,
          intent.memoryTarget,
          intent.intentId
        );
      } catch {
        this.chats.pushWarning(
          `Purge ${intent.intentId} 恢复失败，将在下次启动重试`
        );
      }
    }
  }

  private async withArchivableConversation<T>(
    chatId: string,
    task: () => Promise<T>
  ) {
    return this.coordinator.runConversationExclusive(chatId, async () => {
      if (this.coordinator.hasDurableActiveTurn(chatId)) {
        throw new Error("聊天仍有 claimed/charged 活动 turn，不能归档");
      }
      if (await this.coordinator.isTransitioning(chatId)) {
        throw new Error("聊天正在保存为 App，完成前不能归档");
      }
      return task();
    });
  }

  private projectGateState(projectId: string): ProjectGateState {
    const gated = this.gates.get(projectId);
    if (gated) return gated;
    const project = this.projects.get(projectId);
    if (!project) return "archived";
    return project.archivedAt ? "archived" : "open";
  }

  private projectConversationIds(projectId: string) {
    return [...new Set([
      ...this.chats.listByProject(projectId),
      ...this.coordinator.pendingProjectConversationIds(projectId),
    ])].sort();
  }

  private async previewHome(chatId: string): Promise<PreviewState["homes"][number]> {
    const verified = await this.chatHomes.verifyOwnership(chatId);
    const record = verified ?? this.chatHomes.ledger.get(chatId) ?? null;
    return {
      chatId,
      authorization: verified ? "delete" : "record-only",
      record,
    };
  }

  private membersOf(targets: ArchiveTarget[]) {
    const ids = new Set<string>();
    for (const target of targets) {
      if (target.kind === "chat") ids.add(target.id);
      else this.chats.listByProject(target.id).forEach((id) => ids.add(id));
    }
    return [...ids].sort().map((chatId) => {
      const incarnationId = this.chats.getIncarnationId(chatId);
      if (!incarnationId) throw new Error(`Chat ${chatId} 不存在`);
      return { chatId, incarnationId };
    });
  }

  private foldTargets(targets: ArchiveTarget[]) {
    const projectIds = new Set(
      targets
        .filter((target) => target.kind === "project")
        .map((target) => target.id)
    );
    return targets.filter((target) => {
      if (target.kind === "project") return true;
      const projectId = this.chats.getProjectId(target.id);
      return !projectId || !projectIds.has(projectId);
    });
  }

  private unique(targets: ArchiveTarget[]) {
    return [...new Map(targets.map((target) => [targetKey(target), target])).values()]
      .sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
  }

  private assertTargets(value: unknown) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
      throw new Error("归档目标无效");
    }
    return value.map((target): ArchiveTarget => {
      if (
        !target ||
        typeof target !== "object" ||
        !("kind" in target) ||
        !("id" in target) ||
        (target.kind !== "chat" && target.kind !== "project") ||
        typeof target.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(target.id)
      ) {
        throw new Error("归档目标无效");
      }
      return { kind: target.kind, id: target.id };
    });
  }

  private assertPurgeMode(value: unknown): ArchivePurgeMode {
    if (value !== "local-only" && value !== "cleanup-and-rebuild") {
      throw new Error("删除模式无效");
    }
    return value;
  }

  private sign(state: PreviewState) {
    return createHash("sha256")
      .update(this.secret)
      .update(JSON.stringify(state))
      .digest("hex");
  }

  private changed() {
    this.revision += 1;
    const snapshot = this.snapshot();
    const event: ArchiveEvent = { type: "changed", snapshot };
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(ARCHIVE_CHANNEL.event, event);
    }
    return snapshot;
  }
}
