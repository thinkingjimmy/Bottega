/**
 * [INPUT]: Depends on PromptInput File/Rich Text Contract, Composer File Form and Row Annex DTO
 * [OUTPUT]: Provides the queue attachment materialization, Gallery origin/submission Data authentication, with workspace file/dir, directory tail slider) to show the two-way draft
 * [POS]: the attachment boundary of the runtime/message-queue; Concentrate on having a FileReader that fits with blob URLs, not participating in access or Steer state migration
 */

import type {
  PromptInputFilePart,
  PromptInputMessage,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import { richValueDisplayText } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { ComposerFile } from "@/lib/chat-composer-store";
import {
  queuedPrompt,
  type QueuedAttachment,
  type QueuedPrompt,
} from "@/lib/message-queue-model";

const fileDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取附件 ${file.name}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

const materializeAttachment = async (
  attachment: QueuedAttachment
): Promise<PromptInputFilePart> => ({
  type: "file",
  filename: attachment.name,
  mediaType: attachment.mediaType,
  ...(attachment.kind === "handle"
    ? {
        nativeFile: attachment.nativeFile,
        url: await fileDataUrl(attachment.nativeFile),
      }
    : { url: attachment.dataUrl }),
  ...(attachment.origin ? { origin: attachment.origin } : {}),
});

export async function materializePrompt(
  prompt: QueuedPrompt
): Promise<PromptInputMessage> {
  return {
    input: {
      kind: "rich",
      value: structuredClone(prompt.richValue),
      displayText: prompt.displayText,
    },
    files: await Promise.all(prompt.attachments.map(materializeAttachment)),
    ...(prompt.submissionData !== undefined
      ? { submissionData: structuredClone(prompt.submissionData) }
      : {}),
  };
}

export const draftPrompt = (
  richValue: RichValue,
  files: ComposerFile[]
): QueuedPrompt =>
  queuedPrompt({
    input: {
      kind: "rich",
      value: richValue,
      displayText: richValueDisplayText(richValue),
    },
    files,
  });

export const promptFiles = (prompt: QueuedPrompt): ComposerFile[] =>
  prompt.attachments.map((attachment) => ({
    id: attachment.id,
    type: "file",
    filename: attachment.name,
    mediaType: attachment.mediaType,
    ...(attachment.kind === "handle"
      ? {
          nativeFile: attachment.nativeFile,
          url: URL.createObjectURL(attachment.nativeFile),
        }
      : { url: attachment.dataUrl }),
    ...(attachment.origin ? { origin: attachment.origin } : {}),
  }));
