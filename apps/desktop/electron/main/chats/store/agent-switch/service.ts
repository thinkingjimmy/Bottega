/**
 * [INPUT]: Depends on canonical ChatStore, stable attachment persistence, and existing Chat event publishers
 * [OUTPUT]: Commits prepared switch attachments and publishes the authoritative receipt and delta
 * [POS]: Thin service collaborator; unknown mutations retain their original staged custody
 */
import type { ChatStore } from "../../chat-store";
import type { AttachmentStore } from "../../attachment-store";
import type { ChatMetadata } from "../../chat-summary";
import type { ChatAttachmentPayload, ChatsEvent } from "../../../../../shared/chats-ipc";
import type { SwitchAgentCommand } from "../../sqlite/agent-switch/command";
export async function commitSwitchWithAttachments(store: ChatStore, attachments: AttachmentStore,
  command: SwitchAgentCommand, payloads: ChatAttachmentPayload[], publish: (metadata: ChatMetadata) => void, emit: (event: ChatsEvent) => void) {
  const metas = command.userMessage.attachments ?? [];
  if (payloads.length !== metas.length) throw new Error("AGENT_SWITCH_ATTACHMENTS_CONFLICT");
  await attachments.persist(payloads, metas.map(meta => meta.id));
  const result = await store.switchAgent(command);
  publish(result.metadata);
  emit({ type: "messages-delta", chatId: command.chatId, incarnationId: command.incarnationId,
    revision: result.receipt.nativeMessageRevision, appended: [command.notice, command.userMessage] });
  return result.receipt;
}
