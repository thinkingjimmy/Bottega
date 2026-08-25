/**
 * [INPUT]: Depends on shared Gallery/Submission schema, PromptInputMessage, chat attachment serializer with Gallery current epoch
 * [OUTPUT]: Provides submissionContent, gallery Snapshot and product first-round/outdoor adopts commonly used assembleFirstTurnPayload
 * [POS]: The first step is to create a new chat/runtime/sessionSubmitting transactions only decide the route to be sent and cannot copy the first round field packing
 */

import type { BackendInfo } from "../../../../../shared/agent-ipc";
import type {
  GallerySubmissionSnapshotV1,
  SubmissionContentV1,
} from "../../../../../shared/submission";
import {
  preparedSubmissionV1Schema,
  type PreparedSubmissionV1,
} from "../../../../../shared/gallery-submission";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { readGalleryState } from "@/lib/gallery/store";
import { splitChatAttachments } from "../chat-attachments";
import { serializeCurrentInput } from "../chat-session-model";

export function submissionContent(
  message: PromptInputMessage,
  gallery: PreparedSubmissionV1 | undefined,
  chatId: string
): SubmissionContentV1 {
  const current = readGalleryState(chatId);
  const richValue = gallery?.message.richValue ?? (
    message.input.kind === "rich"
      ? message.input.value
      : [{ id: crypto.randomUUID(), type: "text" as const, value: message.input.displayText }]
  );
  const files = gallery?.message.files ?? message.files.map((file, index) => ({
    id: (file as { id?: string }).id ?? `file_${index}`,
    type: "file" as const,
    ...(file.filename !== undefined ? { filename: file.filename } : {}),
    ...(file.mediaType !== undefined ? { mediaType: file.mediaType } : {}),
    ...(file.url !== undefined ? { url: file.url } : {}),
  }));
  const snapshot: GallerySubmissionSnapshotV1 | undefined = gallery
    ? { schemaVersion: 1, attachments: structuredClone(gallery.galleryAttachments) }
    : undefined;
  return {
    schemaVersion: 1,
    content: {
      richValue: structuredClone(richValue),
      displayText: gallery?.message.displayText ?? message.input.displayText,
      files: structuredClone(files),
    },
    origin: "composer",
    capabilityEpoch: gallery?.capabilityEpoch ?? current.capabilityEpoch,
    backendEpoch: gallery?.backendEpoch ?? current.backendEpoch,
    ...(snapshot ? { gallery: snapshot } : {}),
  };
}

export function assembleFirstTurnPayload(args: {
  message: PromptInputMessage;
  chatId: string;
  backend: BackendInfo["id"];
  selectedBackend: BackendInfo | undefined;
  planMode: boolean;
}) {
  const gallery = gallerySnapshot(
    args.message,
    args.chatId,
    args.backend,
    args.selectedBackend
  );
  const attachments = splitChatAttachments(args.message.files);
  const content = submissionContent(args.message, gallery, args.chatId);
  return {
    input: serializeCurrentInput({ message: args.message, attachmentInput: attachments.input }),
    displayText: content.content.displayText.trim(),
    ...(attachments.payloads.length ? { attachmentPayloads: attachments.payloads } : {}),
    content,
    ...(args.planMode ? { planMode: true as const } : {}),
  };
}

export function gallerySnapshot(
  message: PromptInputMessage,
  chatId: string,
  backend: BackendInfo["id"],
  selectedBackend: BackendInfo | undefined
): PreparedSubmissionV1 | undefined {
  if (message.submissionData === undefined) return undefined;
  const gallery = preparedSubmissionV1Schema.parse(message.submissionData);
  const current = readGalleryState(chatId);
  if (
    gallery.backend !== backend ||
    gallery.backend !== current.backend ||
    gallery.capabilityEpoch !== current.capabilityEpoch ||
    gallery.backendEpoch !== current.backendEpoch ||
    gallery.galleryAttachments.some((attachment) =>
      attachment.sourceRef.kind === "transcript" &&
      attachment.sourceRef.chatId !== chatId
    ) ||
    (gallery.galleryAttachments.length > 0 &&
      (selectedBackend?.runtimeStatus !== "installed" ||
        !selectedBackend.capabilities.imageInput))
  ) {
    throw Object.assign(new Error("EPOCH_MISMATCH"), { code: "EPOCH_MISMATCH" });
  }
  return gallery;
}
