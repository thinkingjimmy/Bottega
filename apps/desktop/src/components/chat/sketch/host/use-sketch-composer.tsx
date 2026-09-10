/**
 * [INPUT]: Depends on composer controls and stable menu triggers, source resources, editor preloading/intents, and submission tokens.
 * [OUTPUT]: Provides Sketch menu preloading/thumbnail actions and synchronous source pin/actual-finally settlement hooks.
 * [POS]: Thin composer integration; source ownership and the mounted editor outlive ChatView.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { PencilIcon } from "lucide-react";
import type { RichInputHandle } from "@ai-chat/ui/components/ai-elements/rich-input";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { PromptInputAttachmentsProps } from "@ai-chat/ui/components/ai-elements/prompt-input-attachments";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  captureComposerOwner,
  composerMigrating,
  setSketchEditable,
  useComposerState,
  type ComposerOwner,
} from "@/lib/chat-composer-store";
import {
  pinSketchSubmission,
  settleSketchSubmission,
} from "@/lib/chat-composer/sketch";
import { sketchErrorMessage } from "@/lib/chat-composer/errors";
import { freezeGalleryDraft } from "@/lib/gallery/submission";
import type { ChatSessionController } from "../../runtime/use-chat-session";
import { openSketch } from "./controller";
import { preloadSketchEditor } from "./editor-loader";
export function useSketchComposer(
  controller: ChatSessionController["composer"],
  editor: RefObject<RichInputHandle | null>,
  disabled: boolean,
) {
  const { t } = useAppTranslation(),
    state = useComposerState(controller.chatId);
  const submissionOwners = useRef(new Map<string, ComposerOwner>());
  useLayoutEffect(() => {
    setSketchEditable(controller.chatId, !disabled);
  }, [controller.chatId, disabled]);
  const focusComposer = () => {
    if (!editor.current) return false;
    editor.current.focus();
    return true;
  };
  const open = (id?: string, returnFocus?: HTMLElement | null) => {
    try {
      if (disabled) throw new Error("SKETCH_READ_ONLY");
      openSketch(controller.chatId, id, focusComposer, returnFocus);
    } catch (error) {
      controller.setAttachmentNotice(sketchErrorMessage(error));
    }
  };
  const count =
    state.draft.files.length +
    state.draft.richValue.filter((node) => node.type === "file").length;
  const newDisabled =
    disabled || count >= 8 || composerMigrating(controller.chatId);
  const attachmentAction: PromptInputAttachmentsProps["attachmentAction"] = (
    file,
  ) =>
    state.sketch.sketchAttachmentIds.has(file.id)
      ? {
          label: t("sketch.edit"),
          onClick: () => open(file.id),
          badge: (
            <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-white p-1 text-black shadow-sm">
              <PencilIcon className="size-3" aria-hidden="true" />
            </span>
          ),
        }
      : undefined;
  return {
    preload: preloadSketchEditor,
    open: (returnFocus: HTMLElement | null) => open(undefined, returnFocus),
    newDisabled,
    disabledReason:
      count >= 8
        ? t("sketch.attachmentLimit")
        : composerMigrating(controller.chatId)
          ? t("sketch.migrationActive")
          : t("sketch.readOnly"),
    attachmentAction,
    prepare(
      message: PromptInputMessage,
      { submissionToken }: { submissionToken: string },
    ) {
      const owner = captureComposerOwner(controller.chatId);
      submissionOwners.current.set(submissionToken, owner);
      pinSketchSubmission(owner, submissionToken, message);
      return freezeGalleryDraft(controller.chatId, message);
    },
    settled(token: string) {
      const owner = submissionOwners.current.get(token);
      submissionOwners.current.delete(token);
      if (owner) settleSketchSubmission(owner, token);
    },
  };
}
