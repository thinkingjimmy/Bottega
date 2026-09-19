/**
 * [INPUT]: Depends on verified complete mirror bodies, original native custody and the sole SQLite record writer.
 * [OUTPUT]: Retains complete divergent turns before canonical installation; former executors atomically become readable mirrors after custody completes.
 * [POS]: Executor-independent adoption transaction; Home ownership and execution preparation remain local authorities.
 */
import type { z } from "zod";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import { portableForkLineage } from "@ai-chat/cloud-protocol/chats/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chatRecordSchema } from "../../../chat-schema";
import type { SqliteDatabase } from "../../connection";
import type { ChatRepositoryReader } from "../../repository/reader";
import type { ChatRecordWriter } from "../../repository/writer";
import type { Row } from "../../repository/codec";
import { readMetadataState, acceptMetadataHead } from "../delivery/metadata-confirm";
import { readMirrorDownload } from "../mirror/downloads";
import { mirrorExecutionWindow, mirrorStartState } from "../mirror/window";
import { readChatOutbox, turnOutboxDigest } from "../settlement/outbox";
import { archiveExecution } from "../execution/archive";
import { assertHomeCaptured } from "../home/jobs";
import { portableFacts } from "../snapshots";
import { requireOutbox } from "../delivery/checkpoints";
import { completeInitialEvidence } from "../initialization/complete";
import { releaseRoot } from "../retention";
import { observeExecutionOptions } from "../delivery/options/capture";
import { activateCloudImport } from "../imported/downloads";
import { divergentUserTurn } from "./content";
import { recoveredForkChildId, type prepareConvergenceSchema, type commitConvergenceSchema } from "./contracts";
import { convergeReadonly } from "./readonly";
import { readSavedNative } from "../../../../library/mirrors/native-source";
import { writeCanonicalHistory } from "./history";
type Action = z.infer<typeof prepareConvergenceSchema> | z.infer<typeof commitConvergenceSchema>;
export function convergeChat(db: SqliteDatabase, reader: ChatRepositoryReader, writer: ChatRecordWriter, scope: SyncScope, deviceId: string, action: Action, now: number) {
  const { head } = action, chatId = head.chat.id;
  if (head.kind === "external-readonly") return convergeReadonly(db, writer, scope, deviceId, action, now);
  assertHomeCaptured(db, chatId);
  const bounded = reader.getRecord(chatId, deviceId), native = bounded && readSavedNative(db, bounded), current = readMetadataState(db, scope, chatId).head;
  if (!native || native.incarnationId !== head.chat.incarnationId || native.context.kind !== "ordinary" || head.chat.classification.conversationKind !== "ordinary" ||
    !current || current.executionEpoch !== head.executionEpoch || current.bodyRevision !== head.bodyRevision || current.chat.cloudRevision !== head.chat.cloudRevision ||
    head.openTurnId || db.prepare("SELECT 1 FROM cloud_tombstones WHERE environment=? AND user_id=? AND chat_id=?").get(scope.environment, scope.userId, chatId)) throw new Error("CHAT_CONVERGENCE_IDENTITY_CHANGED");
  if (native.chatMessageRevision !== action.expectedMessageRevision || turnOutboxDigest(db, scope, chatId) !== action.expectedOutboxDigest) throw new Error("CHAT_CONVERGENCE_CONTENT_CHANGED");
  const download = readMirrorDownload(db, scope, chatId);
  if (!download?.complete || download.bodyRevision !== head.bodyRevision) throw new Error("MIRROR_BODY_UNAVAILABLE");
  const outbox = readChatOutbox(db, scope, chatId);
  const initial = action.initial ? requireOutbox(db, scope, action.initial.id, action.initial.payloadDigest) : null;
  if (initial && (initial.kind !== "initialize" || JSON.parse(String(initial.payload_json)).chatId !== chatId)) throw new Error("INITIAL_OUTBOX_REQUIRED");
  // Preparing finds the divergence point; committing reuses it under the same content fences above.
  const start = action.type === "prepare-chat-convergence" ? divergentUserTurn(db, scope, native) : action.startSeq;
  let archiveId: string | null = null, archived: typeof native.messages = [];
  if (start !== null) {
    archived = native.messages.filter(message => message.seq >= start);
    const original = { ...head, chat: portableFacts(native, head.chat.cloudRevision) };
    const branch = archiveExecution(db, scope, original, { ...native, messages: archived }, outbox, now);
    const archive = db.prepare(`SELECT s.source_id FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
      WHERE r.root_id=? AND s.kind='superseded-execution-archive'`).get(`settlement:${chatId}:execution:${branch.branchId}`) as Row;
    archiveId = String(archive.source_id);
  }
  if (action.type === "prepare-chat-convergence") return { chatId, archiveId, startSeq: start, committed: false };
  // A start seq that no longer matches the prepared one yields a different branch, hence a different archive.
  if (action.archiveId !== archiveId) throw new Error("CHAT_CONVERGENCE_ARCHIVE_CHANGED");
  if (archiveId) {
    const childId = recoveredForkChildId(scope, { chatId, incarnationId: native.incarnationId, startSeq: start! });
    const child = reader.getRecord(childId, deviceId);
    /* The divergence, not the archived bytes, names the child, so a retry that archived a longer tail
       finds the child it already created. It qualifies while the prefix it copied is still exactly a
       leading run of this archive: the retry either appended the rest or kept it beside its own tail. */
    const covered = child ? archived.findIndex(message => message.id === child.parentMessageId) + 1 : 0;
    if (action.childId !== childId || !child || child.parentChatId !== chatId || child.parentIncarnationId !== native.incarnationId ||
      !child.messages.some(message => message.role === "user") || !covered || covered !== child.inheritedThroughSeq) throw new Error("CHAT_CONVERGENCE_FORK_REQUIRED");
  } else if (action.childId !== null) throw new Error("CHAT_CONVERGENCE_CHILD_UNEXPECTED");
  const window = mirrorExecutionWindow(db, scope, chatId);
  /* Lineage travels complete or not at all (portableChatSchema enforces 0 or 4 fields): a head without
     it says nothing about this Chat's origin, so the local Fork divider stays. */
  const next = chatRecordSchema.parse({ ...native, ...portableForkLineage(head.chat),
    title: head.chat.title, titleSource: "user", archivedAt: head.archivedAt ?? undefined, sortKey: head.chat.sortKey,
    agent: head.chat.agent, agentRevision: head.chat.agentRevision, options: head.chat.options,
    messages: window.messages, subagents: window.subagents, trimmedThroughSeq: window.trimmedThroughSeq,
    startState: mirrorStartState(db, scope, chatId), nextSeq: head.reservedThroughSeq + 1,
    supersededBranches: [], supersededBranchesTrimmedThroughSeq: undefined, session: null, forkAgent: null,
    chatRecordRevision: native.chatRecordRevision + 1, chatMessageRevision: native.chatMessageRevision + 1 });
  if (head.kind === "external-managed") activateCloudImport(db, scope, chatId, now);
  writer.writeCore(next, head.kind === "external-managed" ? "external-managed" : "native"); writer.writeLocalFacts(next, deviceId);
  writeCanonicalHistory(db, writer, scope, next, now);
  for (const row of outbox) {
    if (row.kind === "delete-chat" || row.kind === "classification" || row.entity_kind === "home-snapshot") continue;
    if (!initial && ["queued", "blocked", "conflicted"].includes(String(row.metadata_status))) continue;
    db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(row.id)); releaseRoot(db, `outbox:${row.id}`);
  }
  if (initial) {
    const source = JSON.parse(String(initial.payload_json)).sources[0];
    completeInitialEvidence(db, scope, chatId, source.sourceId, hashChatContent(["adopted", source.digest, head, archiveId, action.childId]), now);
    db.prepare("UPDATE cloud_chat_metadata_state SET conflicted=0,deleted=0,tail_operation_id=NULL WHERE chat_id=?").run(chatId);
  }
  // Initial copied-profile adoption retains its existing recovery semantics.
  // A former executor changes residence only after canonical installation and custody succeed.
  const remote = !initial && head.executorDeviceId !== deviceId;
  db.prepare("UPDATE chats SET cloud_state=?,cloud_last_committed_executor_device_id=? WHERE id=?")
    .run(remote ? "mirror" : "synced", head.lastCommittedExecutorDeviceId, chatId);
  if (remote) db.prepare(`INSERT INTO cloud_chat_mirrors(chat_id,environment,user_id,portable_json) VALUES(?,?,?,?)
    ON CONFLICT(chat_id) DO UPDATE SET portable_json=excluded.portable_json,preparation_json=NULL`)
    .run(chatId, scope.environment, scope.userId, JSON.stringify(head.chat));
  observeExecutionOptions(db, scope, chatId, next);
  acceptMetadataHead(db, writer, scope, deviceId, head, now);
  return { chatId, archiveId, startSeq: start, committed: true };
}
