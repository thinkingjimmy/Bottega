/**
 * [INPUT]: Retained command session, confirmed head, selected target and private file reader.
 * [OUTPUT]: Authenticated workspace queries and exact target/reference checks, without native paths or opaque grants.
 * [POS]: Shared remote file source for composer suggestions and workspace previews.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { remoteWorkspaceResultSchema, type RemoteFileReference } from "@ai-chat/cloud-protocol/remote/input/references";
import type { RemoteCommandInput } from "./contracts";
import type { RemoteCommandSession } from "./commands/session";
import type { TranscriptSource } from "../contracts";
import { awaitRemoteResult } from "./commands/result";
export async function queryRemoteWorkspace(ports: { session: RemoteCommandSession; transcript: TranscriptSource }, head: { chat: Pick<CloudChatHead["chat"], "id" | "incarnationId"> },
  targetDeviceId: string, payload: Extract<RemoteCommandInput["payload"], { kind: "list-workspace-files" | "read-workspace-file" }>, signal: AbortSignal) {
  const input = { commandId: crypto.randomUUID(), chatId: head.chat.id, incarnationId: head.chat.incarnationId, targetDeviceId, payload };
  const receipt = await awaitRemoteResult(ports.session, input, signal);
  if (receipt.state !== "done" || receipt.output?.kind !== "workspace-result") throw new Error(receipt.reason ?? "workspace-file-unavailable");
  const descriptor = receipt.output.blob;
  if (descriptor.encryption.owner.kind !== "chat" || descriptor.encryption.owner.id !== head.chat.id || descriptor.bytes > 7 * 1024 * 1024) throw new Error("workspace-file-unavailable");
  const file = await ports.transcript.file(head.chat.id, descriptor, signal);
  try {
    const response = await fetch(file.url, { signal }); if (!response.ok) throw new Error("workspace-file-unavailable");
    const text = await response.text(); signal.throwIfAborted();
    if (new TextEncoder().encode(text).length !== descriptor.bytes) throw new Error("workspace-file-unavailable");
    const value = remoteWorkspaceResultSchema.parse(JSON.parse(text));
    if (payload.kind === "list-workspace-files") {
      if (value.kind !== "workspace-files" || value.deviceId !== targetDeviceId) throw new Error("reference-target-changed");
    } else if (value.kind !== "workspace-text" || JSON.stringify(value.reference) !== JSON.stringify(payload.reference)) throw new Error("reference-target-changed");
    return value;
  } finally { file.release(); }
}
export type SkillSuggestion = { libraryId: string; name: string; description: string };
export type SkillSource = { list(query: string, signal: AbortSignal): Promise<SkillSuggestion[]> };
export type WorkspacePreviewSource = { read(reference: RemoteFileReference, signal: AbortSignal): Promise<string> };
