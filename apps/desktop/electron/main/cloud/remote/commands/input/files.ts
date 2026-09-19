/**
 * [INPUT]: Depends on authenticated remote descriptors, the scoped private file store and native integrity checks.
 * [OUTPUT]: Materializes immutable remote inputs as main-owned file references without binary ledger payloads.
 * [POS]: Remote download boundary preceding the coordinator lifecycle lock.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { RemoteAttachment } from "@ai-chat/cloud-protocol/remote/input/model";
import { remoteAttachmentsSchema } from "@ai-chat/cloud-protocol/remote/input/model";
import type { DesktopBlobStore } from "../../../files/store";
import type { TrustedManualTurnSubmission } from "../../../../../../shared/sections-ipc";
export async function materializeRemoteFiles(chatId: string, values: RemoteAttachment[], files: DesktopBlobStore, current: () => void, signal: AbortSignal) {
  const result: NonNullable<TrustedManualTurnSubmission["remoteInput"]> = [];
  for (const attachment of remoteAttachmentsSchema.parse(values)) {
    current(); signal.throwIfAborted();
    if (attachment.blob.encryption.owner.kind !== "chat" || attachment.blob.encryption.owner.id !== chatId) throw new Error("attachment-invalid");
    let path: string;
    try { path = (await files.read(attachment.blob, { kind: "chat", id: chatId }, signal)).path; }
    catch { throw new Error("attachment-unavailable"); }
    current(); signal.throwIfAborted();
    const bytes = await readFile(path);
    if (bytes.length !== attachment.blob.bytes || createHash("sha256").update(bytes).digest("hex") !== attachment.blob.sha256) throw new Error("attachment-invalid");
    if (attachment.kind === "image" && !imageMagic(bytes, attachment.blob.mime)) throw new Error("attachment-invalid");
    result.push({ attachment, path });
  }
  return result;
}
function imageMagic(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") return bytes.slice(0, 8).join() === "137,80,78,71,13,10,26,10";
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(new TextDecoder().decode(bytes.slice(0, 6)));
  return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}
