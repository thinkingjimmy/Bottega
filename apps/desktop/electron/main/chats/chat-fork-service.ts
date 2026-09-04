/**
 * [INPUT]: Depends on strict Chat fork IPC contracts, ChatStore generation-fenced native/imported prefixes and receipts, Chat Home creation ownership, Project lifecycle serialization, and managed Git worktree primitives
 * [OUTPUT]: Provides native/imported fork preflight with native child-envelope validation, request-singleflight creation/replay, managed-worktree admission cleanup, and main-owned commits
 * [POS]: Focused fork orchestration boundary composed by ChatsService; ordinary Chat creation, attachments, titles, and removal remain outside it
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  ChatRecord,
  ChatsEvent,
  CommitManagedWorktreeInput,
  ForkChatPreflight,
  ForkChatPreflightInput,
  ForkChatRequest,
} from "../../../shared/chats-ipc";
import { PROJECT_UNAVAILABLE } from "../../../shared/projects-ipc";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import {
  commitManagedWorktree,
  createManagedWorktree,
  inspectManagedWorktree,
  managedWorktreeBranch,
  preflightManagedWorktree,
  removeManagedWorktree,
} from "../projects/git/managed-worktree";
import { resolveGitIdentity } from "../projects/git/git-runner";
import { forkOperationId, materializeForkPrefix } from "./chat-fork";
import {
  commitManagedWorktreeInputSchema,
  forkChatInputSchema,
  forkPreflightInputSchema,
} from "./chat-input";
import { statusError } from "./chats-service-guards";
import { isChatMutationOutcomeUnknown, type ChatStore } from "./chat-store";
import { summaryOfChatLike } from "./chat-summary";

export type ChatForkHomePort = Pick<ChatHomeService,
  "identityForCreation" | "assertCanCreateChat" | "beginCreation" |
  "markPrepared" | "commitCreation" | "rollbackCreation" |
  "configureWorktreeCleanup" | "configureWorktreeAdmission" |
  "verifyOwnership">;

type ChatForkServiceDependencies = Readonly<{
  store: ChatStore;
  homes?: ChatForkHomePort;
  resolveProjectWorkspace?: (projectId: string) => string | null | Promise<string | null>;
  withProject?: <T>(projectId: string, task: () => Promise<T>) => Promise<T>;
  assertAdmission: () => void;
  emit: (event: ChatsEvent) => void;
}>;

export class ChatForkService {
  private readonly running = new Map<string, {
    fingerprint: string;
    promise: Promise<ChatRecord>;
  }>();

  constructor(private readonly dependencies: ChatForkServiceDependencies) {
    this.configureManagedWorktreeLifecycle();
  }

  async preflight(input: ForkChatPreflightInput): Promise<ForkChatPreflight> {
    this.dependencies.assertAdmission();
    const value = forkPreflightInputSchema.parse(input);
    const source = await this.dependencies.store.forkSource(value);
    /* 只为校验 exact prefix 能装进 native child envelope；结果本身不外露。 */
    materializeForkPrefix(source, value);
    if (value.mode === "same-workspace") return {};
    const worktree = await preflightManagedWorktree(
      await this.requireProjectWorkspace(source.projectId!)
    );
    return { worktree: { supported: worktree.supported, dirty: worktree.dirty } };
  }

  fork(input: ForkChatRequest) {
    this.dependencies.assertAdmission();
    const value = forkChatInputSchema.parse(input);
    const operationId = forkOperationId(value.requestId);
    const fingerprint = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const active = this.running.get(operationId);
    if (active) {
      if (active.fingerprint !== fingerprint) throw statusError(409, "CHAT_FORK_REQUEST_CONFLICT");
      return active.promise;
    }
    const promise = this.perform(value);
    const entry = { fingerprint, promise };
    this.running.set(operationId, entry);
    void promise.finally(() => {
      if (this.running.get(operationId) === entry) this.running.delete(operationId);
    }).catch(() => {});
    return promise;
  }

  async commit(input: CommitManagedWorktreeInput) {
    this.dependencies.assertAdmission();
    const value = commitManagedWorktreeInputSchema.parse(input);
    const record = await this.dependencies.store.getConversation(value.chatId);
    if (!record || record.incarnationId !== value.incarnationId ||
        record.executionKind !== "managed-worktree" || !record.executionDir ||
        !record.projectId) {
      throw statusError(409, "MANAGED_WORKTREE_IDENTITY_MISMATCH");
    }
    const home = await this.dependencies.homes?.verifyOwnership(record.id);
    if (!home?.worktree || home.homeDir !== record.homeDir) {
      throw statusError(409, "MANAGED_WORKTREE_OWNERSHIP_MISSING");
    }
    return this.withProject(record.projectId, async () => {
      const sourceWorkspace = await this.requireProjectWorkspace(record.projectId!);
      return commitManagedWorktree({
        sourceIdentity: await resolveGitIdentity(sourceWorkspace),
        worktreeDir: record.executionDir!,
        branch: home.worktree!.branch,
        message: value.message,
      });
    });
  }

  private async perform(value: ForkChatRequest) {
    const replay = await this.dependencies.store.forkReplay(value);
    if (replay) return this.finishReplay(value, replay);
    this.dependencies.homes?.assertCanCreateChat();
    const routed = this.dependencies.store.getMetadata(value.sourceChatId);
    if (!routed?.projectId) throw statusError(404, "CHAT_FORK_SOURCE_MISSING");
    return this.withProject(routed.projectId, () => this.create(value, routed.projectId!));
  }

  private async finishReplay(value: ForkChatRequest, replay: ChatRecord) {
    const home = this.dependencies.homes?.identityForCreation(value.childChatId);
    if (!home || home.intentId !== forkOperationId(value.requestId) ||
        home.incarnationId !== replay.incarnationId || home.homeDir !== replay.homeDir) {
      throw statusError(409, "CHAT_FORK_HOME_RECOVERY_REQUIRED");
    }
    if (home.phase !== "committed") {
      await this.dependencies.homes!.markPrepared(value.childChatId);
      await this.dependencies.homes!.commitCreation(value.childChatId);
    }
    this.publish(replay);
    return replay;
  }

  private async create(value: ForkChatRequest, projectId: string) {
    const source = await this.dependencies.store.forkSource(value);
    if (!source || source.projectId !== projectId) {
      throw statusError(409, "CHAT_FORK_SOURCE_PROJECT_CHANGED");
    }
    const workspace = await this.requireProjectWorkspace(projectId);
    const priorHome = this.dependencies.homes?.identityForCreation(value.childChatId);
    if (priorHome && priorHome.intentId !== forkOperationId(value.requestId)) {
      throw statusError(409, "CHAT_FORK_CHILD_EXISTS");
    }
    const worktree = value.mode === "new-worktree" && !priorHome?.worktree
      ? await preflightManagedWorktree(workspace)
      : null;
    if (worktree && !worktree.supported) throw statusError(409, "GIT_SANDBOX_UNAVAILABLE");
    const descriptor = priorHome?.worktree ?? (worktree ? {
      kind: "managed-worktree" as const,
      projectId,
      baseCommit: worktree.baseCommit,
      branch: managedWorktreeBranch(value.childChatId),
      relativePath: "worktree" as const,
    } : undefined);
    if ((value.mode === "new-worktree") !== Boolean(descriptor)) {
      throw statusError(409, "CHAT_FORK_REQUEST_CONFLICT");
    }
    const home = await this.dependencies.homes?.beginCreation({
      intentId: forkOperationId(value.requestId),
      chatId: value.childChatId,
      submission: value,
      workspaceScope: { kind: "project", projectId },
      stagingOwner: "chat-fork",
      ...(descriptor ? { worktree: descriptor } : {}),
    });
    if (!home) throw new Error("Chat Home service unavailable");
    try {
      const executionDir = descriptor ? join(home.homeDir, descriptor.relativePath) : null;
      if (descriptor) {
        await createManagedWorktree({
          sourceWorkspace: workspace,
          worktreeDir: executionDir!,
          baseCommit: descriptor.baseCommit,
          branch: descriptor.branch,
          expectedIdentity: worktree?.identity ?? await resolveGitIdentity(workspace),
        });
      }
      await this.dependencies.homes!.markPrepared(value.childChatId);
      const child = await this.dependencies.store.forkFromRecord({
        ...value,
        childIncarnationId: home.incarnationId,
        homeDir: home.homeDir,
        executionDir,
      });
      await this.dependencies.homes!.commitCreation(value.childChatId);
      this.publish(child);
      return child;
    } catch (cause) {
      if (!isChatMutationOutcomeUnknown(cause)) {
        await this.dependencies.homes!.rollbackCreation(value.childChatId);
      }
      throw cause;
    }
  }

  private configureManagedWorktreeLifecycle() {
    this.dependencies.homes?.configureWorktreeCleanup(async (record) => {
      if (!record.worktree) return "absent";
      const workspace = await this.dependencies.resolveProjectWorkspace?.(record.worktree.projectId);
      if (!workspace) return "recovery";
      return removeManagedWorktree({
        sourceWorkspace: workspace,
        sourceIdentity: await resolveGitIdentity(workspace),
        worktreeDir: join(record.homeDir, record.worktree.relativePath),
        branch: record.worktree.branch,
      });
    });
    this.dependencies.homes?.configureWorktreeAdmission(async (record) => {
      if (!record.worktree) return "absent";
      const workspace = await this.dependencies.resolveProjectWorkspace?.(record.worktree.projectId);
      if (!workspace) return "recovery";
      return inspectManagedWorktree({
        sourceWorkspace: workspace,
        sourceIdentity: await resolveGitIdentity(workspace),
        worktreeDir: join(record.homeDir, record.worktree.relativePath),
        branch: record.worktree.branch,
      });
    });
  }

  private withProject<T>(projectId: string, task: () => Promise<T>) {
    if (!this.dependencies.withProject) {
      return Promise.reject(new Error(`${PROJECT_UNAVAILABLE}: Project 服务不可用`));
    }
    return this.dependencies.withProject(projectId, task);
  }

  private async requireProjectWorkspace(projectId: string) {
    const workspace = await this.dependencies.resolveProjectWorkspace?.(projectId);
    if (!workspace) throw statusError(409, `${PROJECT_UNAVAILABLE}: Project workspace unavailable`);
    return workspace;
  }

  private publish(record: ChatRecord) {
    this.dependencies.emit({ type: "upserted", summary: summaryOfChatLike(record) });
  }
}
