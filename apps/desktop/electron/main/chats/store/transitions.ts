/**
 * [INPUT]: Depends on canonical Chat records/facts, metadata ownership projections, lifecycle helpers, and app capability facts
 * [OUTPUT]: Provides pure Chat fact transitions, the aggregate tail revision, and the external-readonly presentation-only mutation guard for sessions, titles, grants, and project placement
 * [POS]: Mutation policy layer beneath ChatStore queue/persistence orchestration; contains no durable I/O
 */

import type { SessionRef } from "../../../../shared/agent-ipc";
import type { AppCapabilityGrant, AppGrantRecord } from "../../../../shared/apps-ipc";
import {
  REVISION_STALE,
  type AppChatRole,
  type ChatMessage,
  type ChatRecord,
  type SupersededChatBranch,
  type UnsequencedUserMessage,
} from "../../../../shared/chats-ipc";
import type { ChatTitleJob } from "../../../../shared/placement/facts";
import { applyTurnCommit, normalizeMessage } from "../chat-commit";
import {
  moveChatProjectRecord,
  pruneSupersededBranches,
  withCommitRevisions,
} from "../chat-record-lifecycle";
import { assertProjectRole, isAppProjectMember } from "../chat-guards";
import type { ChatFacts, ChatMetadata } from "../chat-summary";

type ProjectDependencies = {
  isAppProject?: (projectId: string) => boolean;
  appForProject?: (projectId: string) =>
    | { appId: string; editableSource: boolean }
    | null;
};

export type ReviseTailInput = {
  chatId: string;
  supersedes: {
    supersedesUserMessageId: string;
    throughSeqEnd: number;
  };
  message: UnsequencedUserMessage;
  reservedSeq?: number;
  intentId?: string;
};

const sessionKey = (session: SessionRef) => `${session.backend}:${session.id}`;
const sameSession = (left: SessionRef | null, right: SessionRef | null) =>
  left?.backend === right?.backend && left?.id === right?.id;

export function reviseTailRecord(
  current: ChatRecord,
  input: ReviseTailInput,
  now: number
) {
  if (current.importOrigin) throw new Error("收养的外源会话不能修订");
  const replay = current.messages.find((message) => message.id === input.message.id);
  if (replay) {
    if (
      replay.role !== "user" ||
      replay.content !== input.message.content ||
      replay.createdAt !== input.message.createdAt
    ) throw new Error("修订消息 identity 已存在但内容不一致");
    return { kind: "replay" as const, record: current, message: replay };
  }

  const index = current.messages.findIndex(
    (message) => message.id === input.supersedes.supersedesUserMessageId
  );
  const superseded = index < 0 ? undefined : current.messages[index];
  const last = current.messages.at(-1);
  const lastUser = current.messages.filter((message) => message.role === "user").at(-1);
  if (
    superseded?.role === "user" &&
    current.inheritedThroughSeq &&
    superseded.seq <= current.inheritedThroughSeq
  ) {
    throw Object.assign(new Error("CHAT_FORK_INHERITED_HISTORY_IMMUTABLE"), { status: 409 });
  }
  if (
    superseded?.role !== "user" ||
    lastUser?.id !== superseded.id ||
    last?.seq !== input.supersedes.throughSeqEnd
  ) throw new Error(REVISION_STALE);

  const message = normalizeMessage({
    ...input.message,
    ...(superseded.attachments?.length
      ? { attachments: structuredClone(superseded.attachments) }
      : {}),
    seq: input.reservedSeq ?? current.nextSeq,
  } as ChatMessage);
  const branch: SupersededChatBranch = {
    intentId: input.intentId ?? input.message.id,
    supersededAt: now,
    supersedesUserMessageId: superseded.id,
    throughSeqEnd: last.seq,
    messages: structuredClone(current.messages.slice(index)),
  };
  const prefix = current.messages.slice(0, index);
  const archive = pruneSupersededBranches(
    [...prefix, message],
    [...(current.supersededBranches ?? []), branch],
    current.supersededBranchesTrimmedThroughSeq
  );
  const result = applyTurnCommit({
    ...current,
    session: null,
    messages: prefix,
    supersededBranches: archive.retained,
    ...(archive.trimmedThroughSeq > 0
      ? { supersededBranchesTrimmedThroughSeq: archive.trimmedThroughSeq }
      : {}),
  }, { message });
  return {
    kind: "revised" as const,
    record: withCommitRevisions(current, result.record, true),
    message,
  };
}

export function bindSessionRecord<T extends ChatFacts>(
  current: T,
  chatId: string,
  session: SessionRef,
  metadata: Iterable<ChatMetadata>
) {
  if (session.backend !== current.agent) {
    throw new Error("session backend 与聊天 agent 不一致");
  }
  const key = sessionKey(session);
  const owner = [...metadata].find(
    (record) => record.id !== chatId && record.session && sessionKey(record.session) === key
  );
  if (owner) throw new Error("Agent session 已绑定到其他聊天");
  if (sameSession(current.session, session)) return current;
  if (current.session) throw new Error("聊天已绑定到另一个 Agent session");
  return { ...current, session };
}

export function replaceSessionRecord<T extends ChatFacts>(
  current: T,
  chatId: string,
  expected: SessionRef,
  next: SessionRef | null,
  metadata: Iterable<ChatMetadata>
) {
  if (!sameSession(current.session, expected)) throw new Error("session 已被其他操作更新");
  if (next?.backend !== undefined && next.backend !== current.agent) {
    throw new Error("session backend 与聊天 agent 不一致");
  }
  if (next) {
    const key = sessionKey(next);
    const owner = [...metadata].find(
      (record) => record.id !== chatId && record.session && sessionKey(record.session) === key
    );
    if (owner) throw new Error("Agent session 已绑定到其他聊天");
  }
  return { ...current, session: next };
}

export function setUserTitleRecord<T extends ChatFacts>(current: T, title: string, now: number) {
  return {
    ...current,
    title: title.trim(),
    titleSource: "user" as const,
    titleJob: current.titleJob.state === "pending"
      ? { state: "superseded" as const, jobId: current.titleJob.jobId, supersededAt: now }
      : current.titleJob,
  };
}

export function assertReadonlyPresentationMutation(
  current: ChatFacts,
  candidate: ChatFacts
) {
  if (current.readOnlyReason !== "external-readonly") return;
  const invariant = (record: ChatFacts) => {
    const {
      title: _title, titleSource: _titleSource, titleJob: _titleJob,
      archivedAt: _archivedAt, updatedAt: _updatedAt,
      chatRecordRevision: _chatRecordRevision, ...rest
    } = record;
    return JSON.stringify(rest);
  };
  if (invariant(current) !== invariant(candidate)) {
    throw new Error("readonly Chat only accepts title/archive presentation changes");
  }
}

export function setGrantRecord<T extends ChatFacts>(
  current: T,
  grant: AppCapabilityGrant | AppGrantRecord,
  isAppProject?: (projectId: string) => boolean
) {
  if (current.appRole !== null) {
    throw Object.assign(new Error("App chat 不能再附加 App"), { status: 403 });
  }
  if (isAppProjectMember(isAppProject, current.projectId)) {
    throw Object.assign(new Error("App Project 的聊天不能再附加 App"), { status: 403 });
  }
  return {
    ...current,
    grants: [...current.grants.filter((item) => item.appId !== grant.appId), structuredClone(grant)],
    grantRevision: current.grantRevision + 1,
  };
}

export function revokeGrantRecord<T extends ChatFacts>(current: T, appId: string) {
  const grants = current.grants.filter((item) => item.appId !== appId);
  return grants.length === current.grants.length
    ? current
    : { ...current, grants, grantRevision: current.grantRevision + 1 };
}

export function setProjectRecord<T extends ChatFacts>(
  current: T,
  projectId: string,
  isAppProject?: (projectId: string) => boolean
) {
  assertProjectRole(isAppProject, projectId, null);
  if (current.projectId !== null) throw new Error("聊天已属于某个 Project");
  return { ...current, projectId };
}

export function moveProjectRecord<T extends ChatFacts>(
  current: T,
  input: { expectedSource: string | null; target: string | null; appRole?: AppChatRole | null },
  dependencies: ProjectDependencies
) {
  return moveChatProjectRecord(current, input, dependencies);
}

export function clearProjectRecord<T extends ChatFacts>(current: T) {
  return current.projectId === null && current.appRole === null
    ? current
    : {
        ...current,
        projectId: null,
        appRole: null,
        context: { kind: "ordinary" as const },
      };
}

export function setGeneratedTitleRecord<T extends ChatFacts>(
  current: T,
  title: string,
  receipt: Extract<ChatTitleJob, { state: "pending" }>,
  now: number
) {
  if (
    current.titleSource === "user" ||
    current.titleJob.state !== "pending" ||
    current.titleJob.jobId !== receipt.jobId ||
    current.titleJob.expectedTitleSource !== receipt.expectedTitleSource ||
    current.titleJob.expectedRecordRevision !== receipt.expectedRecordRevision ||
    current.titleSource !== receipt.expectedTitleSource
  ) return current;
  return {
    ...current,
    title: title.trim(),
    titleSource: "generated" as const,
    titleJob: {
      state: "completed" as const,
      jobId: current.titleJob.jobId,
      completedAt: now,
    },
  };
}
