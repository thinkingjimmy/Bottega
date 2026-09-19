/**
 * [INPUT]: Depends on the existing SQLite reader, native attachment indexes and active imported generations.
 * [OUTPUT]: Returns bounded local-only inventory counts without source paths, native sessions or storage fingerprints.
 * [POS]: Read-only worker leaf for first-sync review; it never enrolls records or writes an outbox.
 */
import type { SqliteDatabase } from "../../connection";
import type { ChatRepositoryReader } from "../../repository/reader";
import type { Row } from "../../repository/codec";
import { chatInventorySchema } from "../../../../../../shared/cloud/sync";
export function readLocalInventory(db: SqliteDatabase, reader: ChatRepositoryReader, deviceId: string) {
  const chats = reader.listMetadata(deviceId);
  if (chats.length > 10000) throw new Error("SYNC_INVENTORY_LIMIT");
  const result = { nativeChats: 0, messages: 0, messageBytes: 0, attachments: 0, attachmentBytes: 0,
    externalChats: 0, importedEntries: 0, importedBytes: 0 };
  const attachments = new Map<string, number>();
  for (const chat of chats) {
    if (chat.readOnlyReason === "external-readonly") result.externalChats++; else result.nativeChats++;
    const messages = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) bytes FROM chat_messages WHERE chat_id=?").get(chat.id) as Row;
    const subagents = db.prepare("SELECT COALESCE(SUM(length(CAST(meta_json AS BLOB))+length(CAST(parts_json AS BLOB))),0) bytes FROM chat_subagents WHERE chat_id=?").get(chat.id) as Row;
    result.messages += Number(messages.n); result.messageBytes += Number(messages.bytes) + Number(subagents.bytes);
    for (const attachment of db.prepare(`SELECT a.attachment_id,a.byte_size FROM chat_message_attachments a
      JOIN chat_messages m ON m.row_id=a.message_row_id WHERE m.chat_id=?`).iterate(chat.id) as Iterable<Row>) {
      const id = String(attachment.attachment_id), bytes = Number(attachment.byte_size);
      if (attachments.has(id) && attachments.get(id) !== bytes) throw new Error("SYNC_ATTACHMENT_IDENTITY_CHANGED");
      attachments.set(id, bytes);
    }
    const imported = db.prepare(`SELECT g.entry_count,g.byte_size FROM chat_active_import_generations a
      JOIN chat_import_generations g ON g.generation_id=a.generation_id WHERE a.chat_id=?`).get(chat.id) as Row | undefined;
    if (imported) { result.importedEntries += Number(imported.entry_count); result.importedBytes += Number(imported.byte_size); }
  }
  result.attachments = attachments.size; result.attachmentBytes = [...attachments.values()].reduce((sum, bytes) => sum + bytes, 0);
  return chatInventorySchema.parse(result);
}
