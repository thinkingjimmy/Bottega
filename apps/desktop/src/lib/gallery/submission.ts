/**
 * [INPUT]: Depends on the shared RichInput wire projection, PromptInputMessage, PreparedSubmissionV1/schema/comment templates and a per-chat Gallery snapshot with backend/epoch
 * [OUTPUT]: Provides synchronized freeze GalleryDraft, freezes sourceRef/token/backend/epoch and injects comment text in the first await
 * [POS]: The lib/gallery submission boundaries are frozen; direct, queue, steer and ambiguous share message.submissionData
 */

import type {
  PromptInputFilePart,
  PromptInputMessage,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import {
  AGENT_INPUT_LIMIT,
  ATTACHMENT_LIMIT,
} from "../../../shared/agent-ipc";
import {
  appendGalleryCommentBlocks,
  formatGalleryCommentBlock,
  preparedSubmissionV1Schema,
  type PreparedSubmissionV1,
} from "../../../shared/gallery-submission";
import type { ComposerFile } from "../chat-composer-store";
import { projectRichInput } from "../../../shared/rich-input-projection";
import { readGalleryState } from "./store";

type IdentifiedFile = PromptInputFilePart &
  Pick<ComposerFile, "id" | "origin">;

export function freezeGalleryDraft(
  chatId: string,
  message: PromptInputMessage
): PromptInputMessage {
  const files = message.files as IdentifiedFile[];
  const state = readGalleryState(chatId);
  const galleryAttachments = files.flatMap((file, fileIndex) => {
    if (file.origin?.kind !== "gallery") return [];
    return [
      {
        fileIndex,
        attachmentId: file.id,
        logicalKey: file.origin.logicalKey,
        sourceRevision: file.origin.sourceRevision,
        selectionToken: file.origin.selectionToken,
        materializationToken: file.origin.materializationToken,
        sourceRef: selectionSourceRef(state, file),
      },
    ];
  });
  const blocks = galleryAttachments.flatMap((attachment) => {
    const comments = state.comments.get(attachment.logicalKey) ?? [];
    return comments.length
      ? [
          formatGalleryCommentBlock(
            attachment.fileIndex + 1,
            comments.map(({ x, y, text }) => ({ x, y, text }))
          ),
        ]
      : [];
  });
  const originalText = message.input.displayText;
  const displayText = appendGalleryCommentBlocks(originalText, blocks);
  // 额度双点预检的提交点：添加点在 store/attachment hook，此处冻结前最后复核
  if (files.length > ATTACHMENT_LIMIT) {
    throw Object.assign(new Error("附件最多 8 个"), {
      code: "ATTACHMENT_LIMIT",
    });
  }
  if (new TextEncoder().encode(displayText).length > 32 * 1024) {
    throw Object.assign(new Error("消息文本（含评论）超出 32KB"), {
      code: "COMMENT_TEXT_LIMIT",
    });
  }
  const richValue =
    message.input.kind === "rich"
      ? injectText(message.input.value, originalText, displayText)
      : [{ id: crypto.randomUUID(), type: "text" as const, value: displayText }];
  if (projectRichInput(richValue).length + files.length > AGENT_INPUT_LIMIT) {
    throw Object.assign(new Error("消息结构项最多 32 个"), {
      code: "AGENT_INPUT_LIMIT",
    });
  }
  if (galleryAttachments.length && (!state.backend || !state.imageInputAvailable)) {
    throw Object.assign(
      new Error("Agent 能力已变化，画廊附件需重新确认后再发送"),
      { code: "EPOCH_MISMATCH" }
    );
  }
  /* 这条 parse 不是「校验自己刚造的对象」那种冗余：state.backend 类型上
     可为 null，而 schema 要求非空——它实际担保的是「冻结时后端必须已知」，
     否则下游的 backend/epoch 比对就是在跟空值较劲。故它不能为了把 zod 挪
     出首包而删除，也不能改成 await import（本函数的契约是同步冻结）。 */
  const prepared: PreparedSubmissionV1 = preparedSubmissionV1Schema.parse({
    schemaVersion: 1,
    message: {
      richValue,
      displayText,
      files: files.map(({ id, type, filename, mediaType }) => ({
        id,
        type,
        ...(filename ? { filename } : {}),
        ...(mediaType ? { mediaType } : {}),
      })),
    },
    galleryAttachments,
    origin: { kind: "composer" },
    backend: state.backend,
    capabilityEpoch: state.capabilityEpoch,
    backendEpoch: state.backendEpoch,
  });
  return {
    ...message,
    input: { kind: "rich", value: richValue, displayText },
    submissionData: prepared,
  };
}

function selectionSourceRef(
  state: ReturnType<typeof readGalleryState>,
  file: IdentifiedFile
) {
  const origin = file.origin;
  const selection = origin
    ? state.selections.get(origin.logicalKey)
    : undefined;
  if (
    !origin ||
    !selection ||
    selection.materialization !== "done" ||
    selection.attachmentId !== file.id ||
    selection.selectionToken !== origin.selectionToken ||
    selection.sourceRevision !== origin.sourceRevision ||
    selection.materializationToken !== origin.materializationToken
  ) {
    throw Object.assign(
      new Error("画廊选择已失效，请重新选择图片后再发送"),
      { code: "GALLERY_SELECTION_STALE" }
    );
  }
  return selection.sourceRef;
}

function injectText(
  value: RichValue,
  originalText: string,
  displayText: string
): RichValue {
  if (displayText === originalText) return structuredClone(value);
  const suffix = displayText.slice(originalText.length);
  const next = structuredClone(value);
  const tail = next.at(-1);
  if (tail?.type === "text") {
    tail.value += suffix;
    return next;
  }
  return [
    ...next,
    { id: crypto.randomUUID(), type: "text", value: suffix },
  ];
}
