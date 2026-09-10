/**
 * [INPUT]: Depends on owner-fenced composer publication, Sketch source budgets, attachment admission, and pure queues.
 * [OUTPUT]: Provides atomic source/PNG saves, source pins, and complete draft/queue exchanges.
 * [POS]: Renderer-only composer transaction boundary; no Sketch data enters generic attachments or IPC.
 */
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { selectPromptInputFiles } from "@ai-chat/ui/lib/prompt-input-files";
import {
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
} from "../../../shared/agent-ipc";
import {
  validateDocument,
  type SketchDocument,
} from "../../components/chat/sketch/model/document";
import {
  admitDocument,
  sourceBytes,
} from "../../components/chat/sketch/model/budget";
import {
  assertComposerOwner,
  atomicComposerUpdate,
  composerOwnerValid,
  globalQueuedBytes,
  readComposer,
  retainComposerResources,
  updateComposer,
  type ComposerFile,
  type ComposerOwner,
} from "../chat-composer-store";
import { swapWithInput, type QueuedPrompt } from "../message-queue-model";
import { assertSketchSources, sketchQueueExtraBytes } from "./resources";
const retireUrls = (
  before: readonly ComposerFile[],
  after: readonly ComposerFile[],
) => {
  const retained = new Set(after.map((file) => file.url));
  for (const file of before)
    if (file.url?.startsWith("blob:") && !retained.has(file.url))
      URL.revokeObjectURL(file.url);
};
export function pinSketchEditor(
  owner: ComposerOwner,
  sessionId: string,
  attachmentId?: string,
) {
  atomicComposerUpdate(owner, (state) => {
    if (state.sketch.editorPins.size) throw new Error("SKETCH_EDITOR_ACTIVE");
    if (attachmentId) {
      if (
        !state.draft.files.some((file) => file.id === attachmentId) ||
        !state.sketch.sketchAttachmentIds.has(attachmentId)
      )
        throw new Error("SKETCH_VERSION_CHANGED");
      assertSketchSources(state.sketch, [attachmentId]);
    }
    return {
      ...state,
      sketch: {
        ...state.sketch,
        editorPins: new Map(state.sketch.editorPins).set(
          sessionId,
          attachmentId ? [attachmentId] : [],
        ),
      },
    };
  });
}
function releasePin(
  owner: ComposerOwner,
  token: string,
  kind: "submissionPins" | "editorPins",
) {
  if (!composerOwnerValid(owner)) return;
  updateComposer(owner.chatId, (state) => {
    if (!state.sketch[kind].has(token)) return state;
    const pins = new Map(state.sketch[kind]);
    pins.delete(token);
    return { ...state, sketch: { ...state.sketch, [kind]: pins } };
  });
}
export const releaseSketchEditor = (owner: ComposerOwner, sessionId: string) =>
  releasePin(owner, sessionId, "editorPins");
export function pinSketchSubmission(
  owner: ComposerOwner,
  token: string,
  message: PromptInputMessage,
) {
  atomicComposerUpdate(
    owner,
    (state) => {
      const ids = message.files.flatMap((file) => {
        const id = (file as { id?: string }).id;
        return id && state.sketch.sketchAttachmentIds.has(id) ? [id] : [];
      });
      assertSketchSources(state.sketch, ids);
      return {
        ...state,
        sketch: {
          ...state.sketch,
          submissionPins: new Map(state.sketch.submissionPins).set(token, ids),
        },
      };
    },
    false,
  );
}
export const settleSketchSubmission = (owner: ComposerOwner, token: string) =>
  releasePin(owner, token, "submissionPins");
export function assertSketchSave(owner: ComposerOwner, attachmentId?: string) {
  const state = assertComposerOwner(owner);
  if (
    attachmentId &&
    !state.draft.files.some((file) => file.id === attachmentId)
  )
    throw new Error("SKETCH_VERSION_CHANGED");
  if (attachmentId) assertSketchSources(state.sketch, [attachmentId]);
  return state;
}
export function saveComposerSketch(
  owner: ComposerOwner,
  document: SketchDocument,
  png: File,
  previousId?: string,
): string {
  assertSketchSave(owner, previousId);
  validateDocument(document);
  admitDocument(document);
  if (!document.elements.length) throw new Error("SKETCH_EMPTY");
  const id = crypto.randomUUID(),
    url = URL.createObjectURL(png);
  let previousFiles: ComposerFile[] = [],
    nextFiles: ComposerFile[] = [];
  try {
    atomicComposerUpdate(owner, (state) => {
      const index = previousId
        ? state.draft.files.findIndex((file) => file.id === previousId)
        : -1;
      if (previousId && index < 0) throw new Error("SKETCH_VERSION_CHANGED");
      const currentCount =
        state.draft.files.length +
        state.draft.richValue.filter((node) => node.type === "file").length -
        (previousId ? 1 : 0);
      const selection = selectPromptInputFiles([png], {
        accept: "image/png",
        maxFiles: ATTACHMENT_LIMIT,
        maxFileSize: ATTACHMENT_BYTE_LIMIT,
        currentCount,
        messages: {
          accept: "SKETCH_EXPORT_FAILED",
          max_file_size: "SKETCH_IMAGE_TOO_LARGE",
          max_files: "SKETCH_ATTACHMENT_LIMIT",
        },
      });
      if (selection.error || selection.files.length !== 1)
        throw new Error(selection.error?.message ?? "SKETCH_ATTACHMENT_LIMIT");
      const file: ComposerFile = {
        id,
        type: "file",
        filename: png.name,
        mediaType: png.type,
        nativeFile: png,
        url,
      };
      previousFiles = state.draft.files;
      nextFiles = [...previousFiles];
      if (index >= 0) nextFiles[index] = file;
      else nextFiles.push(file);
      const sources = new Map(state.sketch.sources).set(id, {
        document,
        byteLength: sourceBytes(document),
      });
      return {
        ...state,
        draft: { ...state.draft, files: nextFiles },
        sketch: {
          ...state.sketch,
          sources,
          sketchAttachmentIds: new Set([
            ...state.sketch.sketchAttachmentIds,
            id,
          ]),
        },
      };
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  retireUrls(previousFiles, nextFiles);
  return id;
}
export function swapComposerQueue(
  owner: ComposerOwner,
  id: string,
  input: QueuedPrompt | undefined,
  restore: (prompt: QueuedPrompt) => ComposerFile[],
): boolean {
  const before = assertComposerOwner(owner);
  if (before.sketch.editorPins.size) throw new Error("SKETCH_EDITOR_ACTIVE");
  const swapped = swapWithInput(
    before.queue,
    id,
    input,
    globalQueuedBytes(),
    sketchQueueExtraBytes(before.sketch),
  );
  if (swapped.reason)
    throw new Error(
      typeof swapped.reason === "string"
        ? swapped.reason
        : swapped.reason.copyKey,
    );
  if (!swapped.prompt) return false;
  assertSketchSources(
    before.sketch,
    swapped.prompt.attachments.map((file) => file.id),
  );
  assertSketchSources(
    before.sketch,
    input?.attachments.map((file) => file.id) ?? [],
  );
  let files: ComposerFile[] = [];
  try {
    files = restore(swapped.prompt);
    atomicComposerUpdate(owner, (state) => {
      if (state !== before) throw new Error("SKETCH_VERSION_CHANGED");
      return {
        ...state,
        queue: swapped.queue,
        draft: { richValue: structuredClone(swapped.prompt!.richValue), files },
      };
    });
  } catch (error) {
    retireUrls(files, before.draft.files);
    throw error;
  }
  retireUrls(before.draft.files, files);
  retainComposerResources(owner.chatId);
  return true;
}
export const readSketchSource = (chatId: string, id: string) =>
  readComposer(chatId).sketch.sources.get(id)?.document;
