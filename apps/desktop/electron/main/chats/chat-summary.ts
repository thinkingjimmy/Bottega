/**
 * [INPUT]: Depends on shared ChatRecord/ChatSummary agreement with chat-preview preview of Messages
 * [OUTPUT]: Provides the main-private sub-archives of ChatMetadata/rendererRecordOf, metadataOf(record→metadata, evaporate preview) and summaryOfChat/summaryOfRecord with two levels of projection
 * [POS]: The chats module has a purely read projection sheet; ChatStore's permanent metadata, events in ChatService and lists are shared with the same field lists as the same refinement, and cannot be copied elsewhere
 */

import type { ChatRecord, ChatSummary } from "../../../shared/chats-ipc";
import { previewOfMessages } from "../../../shared/chat-preview";

/* ── 为何 preview 住在 metadata 而不是 record ────────────────────
 * record 是落盘的那份，preview 是从它现场蒸出来的——派生态一旦落盘，
 * 就有了「盘上的旧值」与「消息算出的新值」两个真相，而它们必然会分叉。
 *
 * 白蹭的一次遍历：ChatStore 启动时本就整条读进来再把 messages 扔掉，
 * 每次 append 手里也正拿着完整 record。提炼挂在丢弃的那一刻，
 * 零额外 IO，且此后再没有第二个「该刷新 preview 了」的地方需要记得。
 * ────────────────────────────────────────────────────────── */
export type ChatMetadata = Omit<
  ChatRecord,
  | "messages"
  | "subagents"
  | "supersededBranches"
  | "supersededBranchesTrimmedThroughSeq"
> & {
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

export function rendererRecordOf(record: ChatRecord | null) {
  if (!record) return null;
  const {
    supersededBranches: _branches,
    supersededBranchesTrimmedThroughSeq: _branchWatermark,
    ...publicRecord
  } = record;
  return publicRecord;
}

/* 入参取 metadata 而非 ChatRecord：ChatStore 手里就是剥掉 messages 的那份，
   若签名钉死整条记录，它就只能自己再抄一份字段清单——那正是本文件存在的
   理由。持有整条记录的调用方走 summaryOfRecord，两步同向，没有分支。 */
export function summaryOfChat({
  id,
  title,
  createdAt,
  updatedAt,
  projectId,
  appRole,
  agent,
  grants,
  grantRevision,
  archivedAt,
  preview,
}: ChatMetadata): ChatSummary {
  return {
    id,
    title,
    createdAt,
    updatedAt,
    projectId,
    appRole,
    agent,
    grants,
    grantRevision,
    preview,
    ...(archivedAt ? { archivedAt, effectiveArchived: true } : {}),
  };
}

export const summaryOfRecord = (record: ChatRecord): ChatSummary =>
  summaryOfChat(metadataOf(record));
