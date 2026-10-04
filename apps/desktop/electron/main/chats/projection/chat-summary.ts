/**
 * [INPUT]: Depends on the shared ChatRecord/ChatSummary contracts and the message preview projection
 * [OUTPUT]: Provides ChatFacts, ChatMetadata, installWorkflowChatIndex / workflowChatTitle, and the one summary projection carrying canonical context, the workflow-owned role, fork lineage, execution capability, import origin, manual sortKey, and durable revisions
 * [POS]: apps/desktop/electron/main/chats/projection; The read-only projection sheet of the chats module; ChatStore metadata, ChatsService events, and renderer lists all derive from this one field list, so no second projection can grow
 */

import type { ChatRecord, ChatSummary } from "../../../../shared/ipc/content/chats-ipc";
import { previewOfMessages } from "../../../../shared/chats/model/chat-preview";
import type { WorkflowChatRole } from "../../../../shared/placement/facts";

/* Which Chats a workflow owns is this computer's workflow index, not a fact on the record: the index is loaded before any
   window lists Chats and installs itself here, so every summary (list, event, search) carries the same role, and a workflow
   Chat is created with its fixed title instead of going to title generation. */
type WorkflowChatIndex = { roleOf(chatId: string): WorkflowChatRole | null; titleOf(chatId: string): string | null;
  entries(): Array<readonly [string, WorkflowChatRole]> };
let workflowChats: WorkflowChatIndex | null = null;
export function installWorkflowChatIndex(index: WorkflowChatIndex | null) { workflowChats = index; }
/** Every workflow Chat with its role, for the cloud repair of a role a Chat's head lacks (R-35); empty until the index is installed. */
export const workflowChatRoles = () => workflowChats?.entries() ?? [];
export const workflowChatTitle = (chatId: string) => workflowChats?.titleOf(chatId) ?? null;
/** The role of a workflow Chat of this computer, or null (R-35: sent with its first upload). */
export const workflowChatRole = (chatId: string) => workflowChats?.roleOf(chatId) ?? null;
const workflowRoleOf = (chatId: string) => workflowChats?.roleOf(chatId) ?? null;

/* ── 为何 preview 住在 metadata 而不是 record ────────────────────
 * record 是落盘的那份，preview 是从它现场蒸出来的——派生态一旦落盘，
 * 就有了「盘上的旧值」与「消息算出的新值」两个真相，而它们必然会分叉。
 *
 * 白蹭的一次遍历：ChatStore 启动时本就整条读进来再把 messages 扔掉，
 * 每次 append 手里也正拿着完整 record。提炼挂在丢弃的那一刻，
 * 零额外 IO，且此后再没有第二个「该刷新 preview 了」的地方需要记得。
 * ────────────────────────────────────────────────────────── */
/* 一条 Chat 剥掉消息、子代理、被取代分支之后剩下的全部事实。
   窄事实变更、纯 transition、写入投影共用它——同一个 Omit 只写一次。 */
export type ChatFacts = Omit<
  ChatRecord,
  | "messages"
  | "subagents"
  | "supersededBranches"
  | "supersededBranchesTrimmedThroughSeq"
>;

export type ChatMetadata = ChatFacts & {
  /** 派生态，永不落盘。 */
  preview: string | null;
};

export function metadataOf(record: ChatRecord): ChatMetadata {
  const {
    messages,
    subagents: _subagents,
    supersededBranches: _branches,
    supersededBranchesTrimmedThroughSeq: _branchWatermark,
    ...metadata
  } = record;
  return { ...metadata, preview: previewOfMessages(messages) };
}

/* 入参取 metadata 而非 ChatRecord：ChatStore 手里就是剥掉 messages 的那份，
   若签名钉死整条记录，它就只能自己再抄一份字段清单——那正是本文件存在的
   理由。持有整条记录的调用方走 summaryOfRecord，两步同向，没有分支。 */
export function summaryOfChat({
  id,
  incarnationId,
  title,
  createdAt,
  updatedAt,
  projectId,
  appRole,
  context,
  startState,
  titleSource,
  readOnlyReason,
  chatRecordRevision,
  chatMessageRevision,
  agent,
  agentRevision,
  options,
  forkAgent,
  grants,
  grantRevision,
  archivedAt,
  sortKey,
  importOrigin,
  parentChatId,
  parentIncarnationId,
  parentMessageId,
  inheritedThroughSeq,
  executionKind,
  preview,
}: ChatMetadata): ChatSummary {
  const workflowRole = workflowRoleOf(id);
  return {
    id,
    incarnationId,
    title,
    createdAt,
    updatedAt,
    projectId,
    appRole,
    context,
    startState,
    titleSource,
    ...(readOnlyReason ? { readOnlyReason } : {}),
    chatRecordRevision,
    chatMessageRevision,
    agent,
  agentRevision,
  options,
  forkAgent,
    grants,
    grantRevision,
    ...(importOrigin ? { importOrigin } : {}),
    parentChatId: parentChatId ?? null,
    parentIncarnationId: parentIncarnationId ?? null,
    parentMessageId: parentMessageId ?? null,
    inheritedThroughSeq: inheritedThroughSeq ?? null,
    executionKind: executionKind ?? null,
    preview,
    ...(archivedAt ? { archivedAt, effectiveArchived: true } : {}),
    ...(sortKey === undefined ? {} : { sortKey }),
    ...(workflowRole ? { workflowRole } : {}),
  };
}

export const summaryOfRecord = (record: ChatRecord): ChatSummary =>
  summaryOfChat(metadataOf(record));

export const summaryOfChatLike = (
  chat: ChatRecord | ChatMetadata
): ChatSummary => "messages" in chat ? summaryOfRecord(chat) : summaryOfChat(chat);
