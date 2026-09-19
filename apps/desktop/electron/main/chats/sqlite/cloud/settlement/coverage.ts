/**
 * [INPUT]: Depends on verified mirror bodies, immutable option receipts and the original business outbox.
 * [OUTPUT]: Retires only fully represented business commits; local-only saves require no upload.
 * [POS]: Worker acknowledgement proof, atomic with source-root release and protected from partial metadata receipts.
 */
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import { messageSchema, subagentsSchema } from "../../../chat-schema";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { readRetainedSource } from "../inventory/source";
import { readMirrorBody, mirrorReferences } from "../mirror/references";
import { optionsConfirmed } from "../delivery/options/checkpoints";
import { releaseRoot } from "../retention";
import { businessOutboxKinds } from "../delivery/options/model";
export function businessCommitCovered(db: SqliteDatabase, scope: SyncScope, item: Row) {
  if (!businessOutboxKinds.has(String(item.kind)) || ["queued", "blocked", "conflicted", "deleted"].includes(String(item.metadata_status))) return false;
  const manifest = JSON.parse(String(item.payload_json));
  const source = readRetainedSource(db, manifest.sources[0]) as { message?: unknown; messages?: unknown[]; notices?: unknown[];
    subagents?: unknown; branches?: unknown[]; optionsOperation?: unknown; throughSeq?: number };
  if (!optionsConfirmed(db, item, source) || source.branches?.length) return false;
  const agents = new Map<string, unknown>();
  for (const raw of [...(source.messages ?? []), ...(source.notices ?? []), ...(source.message ? [source.message] : [])]) {
    const message = messageSchema.parse(raw);
    if (message.segment === "imported") continue;
    const ref = mirrorReferences(db, scope, manifest.chatId, message.seq + 1, 1)[0];
    if (!ref || ref.seq !== message.seq || ref.messageId !== message.id) return false;
    const body = readMirrorBody(db, ref);
    if (canonicalJson(projectPortableMessage(message)) !== canonicalJson(body.message)) return false;
    for (const [id, agent] of Object.entries(body.subagents ?? {})) agents.set(id, agent);
  }
  if (source.throughSeq !== undefined) {
    const ref = mirrorReferences(db, scope, manifest.chatId, source.throughSeq + 1, 1)[0];
    if (ref?.seq === source.throughSeq) for (const [id, agent] of Object.entries(readMirrorBody(db, ref).subagents ?? {})) agents.set(id, agent);
  }
  return Object.entries(subagentsSchema.parse(source.subagents ?? {})).every(([id, agent]) => {
    const portable = { ...agent, parts: agent.parts.map(part => { const { mediaSource: _local, ...rest } = part as unknown as Record<string, unknown>; return rest; }) };
    return canonicalJson(portable) === canonicalJson(agents.get(id) ?? null);
  });
}
export function retireCoveredCommit(db: SqliteDatabase, scope: SyncScope, deviceId: string, id: string, payloadDigest: string) {
  const item = db.prepare("SELECT * FROM cloud_outbox WHERE id=? AND environment=? AND user_id=?").get(id, scope.environment, scope.userId) as Row | undefined;
  if (!item || item.payload_digest !== payloadDigest) throw new Error("OUTBOX_IDENTITY_MISMATCH");
  const retired = businessCommitCovered(db, scope, item);
  if (retired) {
    // Keep the original payload and receipt sources recoverable after queue acknowledgement.
    db.prepare(`INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id)
      SELECT ?,source_id FROM chat_retention_roots WHERE root_id=?`).run(`confirmed-business:${id}`, `outbox:${id}`);
    db.prepare(`UPDATE chat_retained_sources SET local_device_id=? WHERE source_id IN
      (SELECT source_id FROM chat_retention_roots WHERE root_id=?)`).run(deviceId, `confirmed-business:${id}`);
    db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(id); releaseRoot(db, `outbox:${id}`);
  }
  return { id, retired };
}
