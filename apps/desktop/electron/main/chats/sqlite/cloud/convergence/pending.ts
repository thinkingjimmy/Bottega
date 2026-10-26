/**
 * [INPUT]: Depends on complete authenticated mirror bodies, frozen business sources, permanent original receipts and native history.
 * [OUTPUT]: Provides a revision-bound target for preserving closed same-owner legacy differences through the existing recovery Fork.
 * [POS]: Read-only convergence admission; it cannot publish content, acknowledge a queue row or bypass two-phase custody.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import { canonicalJson, turnReceiptSchema, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { ChatRepositoryReader } from "../../repository/reader";
import type { Row } from "../../repository/codec";
import { readSavedNative } from "../../../../library/mirrors/native-source";
import { readMetadataState } from "../delivery/metadata-confirm";
import { optionsConfirmed } from "../delivery/options/checkpoints";
import { readRetainedSource } from "../inventory/source";
import { readMirrorDownload } from "../mirror/downloads";
import { mirrorReferences, readMirrorBody } from "../mirror/references";
import { readChatOutbox, turnOutboxDigest } from "../settlement/outbox";
import { portableFacts } from "../snapshots";
import { messageSchema } from "../../../schema/chat-schema";

const LIMIT = 2000;
export function pendingConvergenceTarget(db: SqliteDatabase, reader: ChatRepositoryReader, scope: SyncScope, deviceId: string, head: CloudChatHead) {
  const id = head.chat.id, metadata = readMetadataState(db, scope, id), current = metadata.head;
  if (head.kind !== "native" || head.ownerDeviceId !== deviceId || head.openTurnId || metadata.deleted || metadata.conflicted || metadata.pendingCount ||
    !current || current.ownerDeviceId !== deviceId || current.openTurnId || current.chat.incarnationId !== head.chat.incarnationId ||
    current.bodyRevision !== head.bodyRevision || current.chat.cloudRevision !== head.chat.cloudRevision || current.rewriteEpoch !== head.rewriteEpoch ||
    current.headSeq !== head.headSeq || current.reservedThroughSeq !== head.reservedThroughSeq) return null;
  const outbox = readChatOutbox(db, scope, id);
  if (!outbox.length || outbox.length > 100 || outbox.some(row => !["upsert-record", "append-message"].includes(String(row.kind)) ||
    row.metadata_status !== null && row.metadata_status !== undefined || row.metadata_intent_json != null)) return null;
  const bounded = reader.getRecord(id, deviceId), native = bounded && readSavedNative(db, bounded);
  const download = readMirrorDownload(db, scope, id);
  if (!native || native.incarnationId !== head.chat.incarnationId || native.context.kind !== "ordinary" || !native.messages.length ||
    native.messages.length > LIMIT || native.supersededBranches?.length || Object.keys(native.subagents ?? {}).length ||
    !download?.complete || download.bodyRevision !== head.bodyRevision) return null;
  // A local content timestamp can advance without authoring another metadata operation.
  const { updatedAt: _localTime, ...facts } = portableFacts(native, head.chat.cloudRevision, head.chat.workflowRole);
  const { updatedAt: _cloudTime, ...confirmed } = head.chat;
  if (canonicalJson(facts) !== canonicalJson(confirmed) || (native.archivedAt ?? null) !== head.archivedAt) return null;
  const local = new Map(native.messages.map(message => [message.id, message]));
  const frozen = new Set<string>();
  for (const item of outbox) {
    const manifest = JSON.parse(String(item.payload_json));
    if (manifest.version !== 1 || manifest.chatId !== id || !Array.isArray(manifest.sources) || manifest.sources.length !== 1) return null;
    const ref = manifest.sources[0];
    const owned = db.prepare(`SELECT 1 FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
      WHERE r.root_id=? AND s.source_id=? AND s.digest=? AND s.chat_id=? AND s.environment=? AND s.user_id=?
      AND (s.local_device_id IS NULL OR s.local_device_id=?)`).get(`outbox:${item.id}`, ref.sourceId, ref.digest, id, scope.environment, scope.userId, deviceId);
    if (!owned) return null;
    const source = readRetainedSource(db, ref) as { messages?: unknown[]; message?: unknown; branches?: unknown[]; subagents?: object; optionsOperation?: unknown };
    if (!optionsConfirmed(db, item, source) || source.branches?.length || Object.keys(source.subagents ?? {}).length) return null;
    for (const raw of [...(source.messages ?? []), ...(source.message ? [source.message] : [])]) {
      const message = messageSchema.parse(raw), value = local.get(message.id);
      if (!value || canonicalJson(projectPortableMessage(message)) !== canonicalJson(projectPortableMessage(value))) return null;
      frozen.add(message.id);
    }
  }
  const canonical = new Map<number, ReturnType<typeof readMirrorBody>>();
  let cursor = 0;
  for (;;) {
    const page = mirrorReferences(db, scope, id, cursor, 100, "after");
    for (const ref of page) {
      if (ref.seq > native.messages.at(-1)!.seq) break;
      canonical.set(ref.seq, readMirrorBody(db, ref));
      if (canonical.size > LIMIT) return null;
    }
    if (page.length < 100 || page.at(-1)!.seq >= native.messages.at(-1)!.seq) break;
    cursor = page.at(-1)!.seq;
  }
  let divergent = false;
  for (const message of native.messages) {
    const body = canonical.get(message.seq);
    if (body?.message.id === message.id && canonicalJson(projectPortableMessage(message)) === canonicalJson(body.message)) continue;
    if (message.role !== "assistant" || !message.completion || !frozen.has(message.id)) return null;
    let original = message;
    if (!message.turnId) {
      const prior = native.messages.filter(item => item.role === "assistant" && item.turnId && item.seq < message.seq).at(-1);
      const canonicalPrior = prior && canonical.get(prior.seq)?.message;
      if (message.completion !== "complete" || prior?.role !== "assistant" || !prior.turnId || canonicalPrior?.role !== "assistant" ||
        canonicalPrior.id !== prior.id || canonicalPrior.completion !== "interrupted") return null;
      original = prior;
    }
    if (original.turnId) {
      const row = db.prepare(`SELECT settlement_state,receipt_json FROM cloud_turn_receipts
        WHERE environment=? AND user_id=? AND chat_id=? AND turn_id=?`).get(scope.environment, scope.userId, id, original.turnId) as Row | undefined;
      if (!row || row.settlement_state !== "settled") return null;
      const receipt = turnReceiptSchema.safeParse(JSON.parse(String(row.receipt_json)));
      const user = native.messages.filter(item => item.role === "user" && item.seq < original.seq).at(-1);
      if (!receipt.success || receipt.data.settlementState !== "settled" || receipt.data.chatId !== id || receipt.data.turnId !== original.turnId ||
        receipt.data.incarnationId !== native.incarnationId || receipt.data.ownerDeviceId !== deviceId || receipt.data.assistantSeq !== original.seq ||
        receipt.data.assistantMessageId !== original.id || receipt.data.userSeq !== user?.seq || receipt.data.userMessageId !== user?.id ||
        !message.turnId && (receipt.data.settledAt === undefined || message.createdAt > receipt.data.settledAt)) return null;
    }
    divergent = true;
  }
  return divergent ? { incarnationId: native.incarnationId, messageRevision: native.chatMessageRevision,
    outboxDigest: turnOutboxDigest(db, scope, id) } : null;
}
