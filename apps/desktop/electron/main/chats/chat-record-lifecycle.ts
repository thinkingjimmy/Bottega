/**
 * [INPUT]: Depends on canonical Chat schemas/commit normalization, App Project membership facts, and monotonic Chat/title/start revisions
 * [OUTPUT]: Provides Chat record creation, App Project placement mutation, superseded-branch pruning, and fact/commit revision advancement
 * [POS]: Pure Chat record lifecycle policy; ChatStore retains queue and I/O ownership while delegating record construction and transitions
 */

import { randomUUID } from "node:crypto";
import type { AgentBackendId, SessionRef } from "../../../shared/agent-ipc";
import {
  SUPERSEDED_BRANCH_LIMIT,
  type AppChatRole,
  type ChatImportOrigin,
  type ChatMessage,
  type ChatRecord,
  type SupersededChatBranch,
  type UnsequencedUserMessage,
} from "../../../shared/chats-ipc";
import { isPositiveAppGrant } from "../../../shared/apps-ipc";
import {
  CHAT_BYTE_LIMIT,
  chatRecordSchema,
  messageBytes,
  utf8Length,
} from "./chat-schema";
import { normalizeMessage } from "./chat-commit";
import {
  assertProjectRole,
  isAppProjectMember,
} from "./chat-guards";
import type { ChatFacts } from "./chat-summary";

export type ChatCreateIdentity = Readonly<{
  incarnationId?: string;
  title?: string | null;
  minimumNextSeq?: number;
  homeDir?: string;
  appRole?: AppChatRole | null;
  appId?: string;
  dormantNotice?: boolean;
  session?: SessionRef;
  importOrigin?: ChatImportOrigin;
  snapshotDigest?: string;
}>;

type ProjectFacts = Readonly<{
  isAppProject?: (projectId: string) => boolean;
  appForProject?: (projectId: string) =>
    | { appId: string; editableSource: boolean }
    | null;
}>;

export function createChatRecord(input: Readonly<{
  chatId: string;
  firstMessage: UnsequencedUserMessage | ChatMessage;
  projectId: string | null;
  agent: AgentBackendId;
  identity: ChatCreateIdentity;
  projects: ProjectFacts;
}>) {
  if (!input.identity.homeDir) {
    throw new Error("canonical create 缺少 Chat Home ownership（homeDir）");
  }
  const seq = "seq" in input.firstMessage ? input.firstMessage.seq : 1;
  const message = normalizeMessage({
    ...input.firstMessage,
    seq,
  } as ChatMessage);
  const dormant = input.identity.dormantNotice === true;
  if (message.role !== (dormant ? "notice" : "user")) {
    throw new Error(
      dormant
        ? "dormant 会话的首条只能是产品生成的 notice"
        : "首条消息必须来自用户"
    );
  }
  const appRole = input.identity.appRole ?? null;
  const appId =
    input.identity.appId ??
    (message.role === "notice" && message.notice.kind === "app-chat-ready"
      ? message.notice.appId
      : input.projectId
        ? input.projects.appForProject?.(input.projectId)?.appId
        : undefined);
  if (appRole && !appId) throw new Error("canonical App Chat 缺少 appId");
  assertProjectRole(input.projects.isAppProject, input.projectId, appRole);
  const titleSource =
    !dormant && input.identity.title != null
      ? "user"
      : appRole
        ? "app-fallback"
        : "local-fallback";
  return {
    record: chatRecordSchema.parse({
      id: input.chatId,
      incarnationId:
        input.identity.incarnationId ?? randomUUID().replaceAll("-", ""),
      title: input.identity.title ?? null,
      agent: input.agent,
      session: input.identity.session ?? null,
      importOrigin: input.identity.importOrigin ?? null,
      snapshotDigest: input.identity.snapshotDigest ?? null,
      projectId: input.projectId,
      appRole,
      context:
        appRole === "use"
          ? { kind: "app-use", appId: appId! }
          : appRole === "edit"
            ? { kind: "app-edit", appId: appId!, projectId: input.projectId! }
            : { kind: "ordinary" },
      startState: dormant
        ? { kind: "unstarted" }
        : {
            kind: "started-exact",
            firstUserMessageAt: message.createdAt,
            firstUserMessageSeq: seq,
          },
      titleSource,
      titleJob: dormant
        ? { state: "none" }
        : titleSource === "user"
          ? {
              state: "superseded",
              jobId: `title:${input.chatId}:${message.id}`,
              supersededAt: message.createdAt,
            }
          : {
              state: "pending",
              jobId: `title:${input.chatId}:${message.id}`,
              expectedRecordRevision: 1,
              expectedTitleSource: titleSource,
              createdAt: message.createdAt,
            },
      chatRecordRevision: 1,
      chatMessageRevision: 1,
      grants: [],
      grantRevision: 0,
      homeDir: input.identity.homeDir,
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      nextSeq: Math.max(seq + 1, input.identity.minimumNextSeq ?? 1),
      messages: [message],
    }),
    message,
  };
}

export function moveChatProjectRecord<T extends ChatFacts>(
  current: T,
  input: Readonly<{
    expectedSource: string | null;
    target: string | null;
    appRole?: AppChatRole | null;
  }>,
  projects: ProjectFacts
): T {
  if (current.projectId !== input.expectedSource) {
    throw Object.assign(new Error("聊天 Project 归属已变化"), { status: 409 });
  }
  const appRole = input.appRole ?? current.appRole;
  assertProjectRole(projects.isAppProject, input.target, appRole);
  const positiveGrants = current.grants.filter(isPositiveAppGrant);
  if (isAppProjectMember(projects.isAppProject, input.target) && positiveGrants.length) {
    throw Object.assign(
      new Error(
        `聊天仍持有 App 授权，请先撤销：${positiveGrants
          .map((grant) => grant.appId)
          .join("、")}`
      ),
      { status: 409 }
    );
  }
  if (current.projectId === input.target && current.appRole === appRole) {
    return current;
  }
  /* App Project 的 appId 只有一个来源：Project 自己的 workspace binding。
     appRole 存在就意味着 target 是 App Project；解析不出绑定即是数据损坏，不许兜底。 */
  const appIdOf = (target: string | null) => {
    if (current.context.kind !== "ordinary") return current.context.appId;
    const appId = target ? projects.appForProject?.(target)?.appId : undefined;
    if (!appId) {
      throw Object.assign(
        new Error(`Project ${target ?? "unknown"} 未绑定 App，无法承载 App 聊天`),
        { status: 409 }
      );
    }
    return appId;
  };
  const context =
    appRole === "use"
      ? { kind: "app-use" as const, appId: appIdOf(input.target) }
      : appRole === "edit" && input.target
        ? {
            kind: "app-edit" as const,
            appId: appIdOf(input.target),
            projectId: input.target,
          }
        : { kind: "ordinary" as const };
  return { ...current, projectId: input.target, appRole, context };
}

export function pruneSupersededBranches(
  messages: ChatMessage[],
  branches: SupersededChatBranch[],
  watermark = 0
) {
  const excess = Math.max(0, branches.length - SUPERSEDED_BRANCH_LIMIT);
  const retained = branches.slice(excess);
  let trimmedThroughSeq = branches
    .slice(0, excess)
    .reduce(
      (maximum, branch) => Math.max(maximum, branch.throughSeqEnd),
      watermark
    );
  const messageBudget = messages.reduce(
    (total, message) => total + messageBytes(message),
    0
  );
  while (
    retained.length > 0 &&
    messageBudget + utf8Length(JSON.stringify(retained)) > CHAT_BYTE_LIMIT
  ) {
    trimmedThroughSeq = Math.max(
      trimmedThroughSeq,
      retained.shift()!.throughSeqEnd
    );
  }
  return { retained, trimmedThroughSeq };
}

/* 事实变更从不触碰消息：只推进聚合 revision，消息 revision 原样传递。
   revision 契约只住在这一个文件里，窄写入与整聚合写入不会各写一份。 */
export function withFactRevision<T extends ChatFacts>(
  current: ChatFacts,
  candidate: T
): T {
  return { ...candidate, chatRecordRevision: current.chatRecordRevision + 1 };
}

export function withCommitRevisions(
  current: ChatRecord,
  candidate: ChatRecord,
  messagesChanged: boolean
): ChatRecord {
  const chatRecordRevision = current.chatRecordRevision + 1;
  let startState = candidate.startState;
  let titleJob = candidate.titleJob;
  if (messagesChanged) {
    const firstUser = candidate.messages.find((message) => message.role === "user");
    if (firstUser && current.startState.kind === "unstarted") {
      startState = {
        kind: "started-exact",
        firstUserMessageAt: firstUser.createdAt,
        firstUserMessageSeq: firstUser.seq,
      };
    }
    if (
      firstUser &&
      titleJob.state === "none" &&
      (candidate.titleSource === "app-fallback" ||
        candidate.titleSource === "local-fallback")
    ) {
      titleJob = {
        state: "pending",
        jobId: `title:${candidate.id}:${firstUser.id}`,
        expectedRecordRevision: chatRecordRevision,
        expectedTitleSource: candidate.titleSource,
        createdAt: firstUser.createdAt,
      };
    }
  }
  return {
    ...candidate,
    startState,
    titleJob,
    chatRecordRevision,
    chatMessageRevision:
      current.chatMessageRevision + (messagesChanged ? 1 : 0),
  };
}
