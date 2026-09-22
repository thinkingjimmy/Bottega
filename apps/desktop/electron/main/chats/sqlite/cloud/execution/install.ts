/**
 * [INPUT]: Depends on the owning head, complete Home capture, verified body cache, the unpublished outbox rows the canonical prefix supersedes, and the sole Chat writers.
 * [OUTPUT]: Atomically installs canonical native/imported prefixes, archives divergent evidence/options and resets observed settings and clears old sessions.
 * [POS]: Worker preparation transaction; Home restoration and backend admission remain separate main-owned steps.
 */
import type { z } from "zod";
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import { canonicalJson, projectChatClassification, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { chatRecordSchema, messageSchema, subagentsSchema } from "../../../chat-schema";
import type { SqliteDatabase } from "../../connection";
import type { ChatRepositoryReader } from "../../repository/reader";
import type { ChatRecordWriter } from "../../repository/writer";
import { readMirrorDownload } from "../mirror/downloads";
import { mirrorReferences, readMirrorBody } from "../mirror/references";
import { mirrorExecutionWindow, mirrorStartState } from "../mirror/window";
import { readChatOutbox, turnOutboxDigest } from "../settlement/outbox";
import { readRetainedSource } from "../inventory/source";
import { releaseRoot } from "../retention";
import { localExecutionState } from "./state";
import { archiveExecution } from "./archive";
import type { executionInstallSchema } from "./contracts";
import { activateCloudImport } from "../imported/downloads";
import { assertHomeCaptured } from "../home/jobs";
import { observeExecutionOptions } from "../delivery/options/capture";
import { readSavedNative } from "../../../../library/mirrors/native-source";
import { writeCanonicalHistory } from "../convergence/history";
export function installExecutionPrefix(db: SqliteDatabase, reader: ChatRepositoryReader, writer: ChatRecordWriter, scope: SyncScope, deviceId: string,
  action: z.infer<typeof executionInstallSchema>, now: number) {
  assertHomeCaptured(db, action.chatId);
  const state = localExecutionState(db, action.chatId, deviceId), head = state?.head, bounded = reader.getRecord(action.chatId, deviceId);
  const native = bounded && readSavedNative(db, bounded);
  if (!head || !native || state?.deleted || head.ownerDeviceId !== deviceId ||
    head.chat.incarnationId !== action.incarnationId || head.chat.cloudRevision !== action.cloudRevision || head.bodyRevision !== action.bodyRevision ||
    head.archivedAt !== null || head.chat.classification.conversationKind !== "ordinary" || head.kind === "external-readonly" || head.openTurnId ||
    canonicalJson(projectChatClassification(native)) !== canonicalJson(head.chat.classification)) throw new Error("EXECUTION_IDENTITY_CHANGED");
  if (native.chatMessageRevision !== action.expectedMessageRevision || turnOutboxDigest(db, scope, action.chatId) !== action.expectedOutboxDigest) throw new Error("EXECUTION_CONTENT_CHANGED");
  if (action.home.chatId !== native.id || action.home.incarnationId !== native.incarnationId || action.home.homeDir !== native.homeDir) throw new Error("HOME_IDENTITY_CHANGED");
  const download = readMirrorDownload(db, scope, native.id);
  if (!download?.complete || download.bodyRevision !== head.bodyRevision) throw new Error("MIRROR_BODY_UNAVAILABLE");
  const canonicalAgents = new Map<string, unknown>();
  const different = (input: unknown) => {
    const message = messageSchema.parse(input), reference = mirrorReferences(db, scope, native.id, message.seq + 1, 1)[0];
    if (!reference || reference.seq !== message.seq) return true;
    const body = readMirrorBody(db, reference);
    for (const [key, value] of Object.entries(body.subagents ?? {})) canonicalAgents.set(key, value);
    return canonicalJson(projectPortableMessage(message)) !== canonicalJson(body.message);
  };
  const differentAgents = (input: unknown) => Object.entries(subagentsSchema.parse(input ?? {})).some(([key, value]) => {
    const portable = { ...value, parts: value.parts.map(part => { const { mediaSource: _local, ...rest } = part as unknown as Record<string, unknown>; return rest; }) };
    return canonicalJson(portable) !== canonicalJson(canonicalAgents.get(key) ?? null);
  });
  /* The canonical prefix replaces the local tail, so every unpublished business row for this Chat is superseded by it.
     The initialization is not: it carries the Chat's own identity, which the prefix does not replace. */
  const superseded = readChatOutbox(db, scope, native.id).filter(row => ["chat", "message", "turn"].includes(String(row.entity_kind)) && row.kind !== "initialize");
  let divergent = native.messages.map(different).some(Boolean) || Boolean(native.supersededBranches?.length) || differentAgents(native.subagents);
  for (const row of superseded) {
    const manifest = JSON.parse(String(row.payload_json));
    const source = readRetainedSource(db, manifest.sources[0]) as { message?: unknown; messages?: unknown[]; user?: unknown; userMessage?: unknown; resultMessage?: unknown; notices?: unknown[]; subagents?: unknown; branches?: unknown[]; optionsOperation?: unknown };
    divergent ||= Boolean(source.optionsOperation);
    divergent ||= [source.message, source.user, source.userMessage, source.resultMessage, ...(source.messages ?? []), ...(source.notices ?? [])].filter(Boolean).some(different);
    divergent ||= differentAgents(source.subagents) || Boolean(source.branches?.length);
    if (row.entity_kind === "turn" && !db.prepare("SELECT 1 FROM cloud_turn_receipts WHERE environment=? AND user_id=? AND turn_id=? AND settlement_state='settled'")
      .get(scope.environment, scope.userId, String(row.entity_id))) divergent = true;
  }
  const window = mirrorExecutionWindow(db, scope, native.id);
  if (divergent && action.requireConverged) throw new Error("CHAT_CONVERGENCE_REQUIRED");
  const branch = divergent ? archiveExecution(db, scope, head, native, superseded, now) : null;
  if (head.kind === "external-managed") activateCloudImport(db, scope, native.id, now);
  const next = chatRecordSchema.parse({ ...native, messages: window.messages, subagents: window.subagents, trimmedThroughSeq: window.trimmedThroughSeq,
    supersededBranches: [], supersededBranchesTrimmedThroughSeq: undefined, session: null, forkAgent: null,
    startState: mirrorStartState(db, scope, native.id),
    agent: head.chat.agent, agentRevision: head.chat.agentRevision, options: head.chat.options,
    nextSeq: head.reservedThroughSeq + 1, chatRecordRevision: native.chatRecordRevision + 1, chatMessageRevision: native.chatMessageRevision + 1 });
  writer.writeCore(next, head.kind === "external-managed" ? "external-managed" : "native"); writer.writeLocalFacts(next, deviceId);
  writeCanonicalHistory(db, writer, scope, next, now);
  observeExecutionOptions(db, scope, native.id, next);
  for (const row of superseded) {
    if (["queued", "blocked", "conflicted"].includes(String(row.metadata_status))) continue;
    db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(row.id)); releaseRoot(db, `outbox:${row.id}`);
  }
  return { chatId: native.id, bodyRevision: head.bodyRevision, branchId: branch?.branchId ?? null };
}
