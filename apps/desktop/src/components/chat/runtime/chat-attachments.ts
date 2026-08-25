/**
 * [INPUT]: Depends on PromptInputMessage and shared AgentUserInput/Chat image attachment contract
 * [OUTPUT]: Provides image exclusive splitChatAttachments, LiveAttachmentPreview and unified with the interface preview
 * [POS]: The video conversion layer of chat/runtime; Non-pictures are exclusive to the RichInput file node and the main opaque license
 */

import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { AgentUserInput } from "../../../../shared/agent-ipc";
import type { ChatAttachmentPayload } from "../../../../shared/chats-ipc";

const LIVE_PREVIEW_LIMIT = 4;

export type LiveAttachmentPreview = {
  filename: string;
  mediaType: string;
  /** 图片 data URL，仅用于当前 renderer 会话的即时预览 */
  url: string;
};

export type SubmitAttachments = {
  input: Extract<AgentUserInput, { type: "image" }>[];
  payloads: ChatAttachmentPayload[];
  previews: LiveAttachmentPreview[];
};

export function splitChatAttachments(
  files: PromptInputMessage["files"]
): SubmitAttachments {
  const result: SubmitAttachments = { input: [], payloads: [], previews: [] };
  for (const file of files) {
    const filename = file.filename ?? "attachment";
    const isImage =
      Boolean(file.mediaType?.startsWith("image/")) &&
      Boolean(file.url?.startsWith("data:"));
    if (isImage) {
      result.input.push({ type: "image", dataUrl: file.url!, filename });
      result.payloads.push({
        filename,
        mediaType: file.mediaType!,
        dataUrl: file.url!,
      });
      result.previews.push({
        filename,
        mediaType: file.mediaType!,
        url: file.url!,
      });
      continue;
    }
    throw new Error(`非图片文件必须以内联 chip 提交：${filename}`);
  }
  return result;
}

export function appendLivePreviews(
  current: ReadonlyMap<string, LiveAttachmentPreview[]>,
  messageId: string,
  previews: LiveAttachmentPreview[]
) {
  const next = new Map(current);
  next.set(messageId, previews);
  while (next.size > LIVE_PREVIEW_LIMIT) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}
