/**
 * [INPUT]: Depends on composer controls and stable menu triggers, source resources, editor preloading/intents, and submission tokens.
 * [OUTPUT]: Provides Sketch menu preloading/thumbnail actions and synchronous source pin/actual-finally settlement hooks; a failed send preparation throws localized copy and logs the raw cause.
 * [POS]: Thin composer integration; source ownership and the mounted editor outlive ChatView.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { PencilIcon } from "lucide-react";
import type { RichInputHandle } from "@ai-chat/ui/components/ai-elements/rich-input";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { PromptInputAttachmentsProps } from "@ai-chat/ui/components/ai-elements/prompt-input-attachments";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import {
  captureComposerOwner,
  composerMigrating,
  setSketchEditable,
  useComposerState,
  type ComposerOwner,
} from "@/lib/chat/state/composer/chat-composer-store";
import {
  pinSketchSubmission,
  settleSketchSubmission,
} from "@/lib/chat-composer/sketch";
import { sendPreparationMessage, sketchErrorMessage } from "@/lib/chat-composer/errors";
import { freezeGalleryDraft } from "@/lib/gallery/submission";
import type { ChatSessionController } from "../../runtime/use-chat-session";
import { openSketch } from "./controller";
import {useComposerPlugins} from "./plugin/catalog";
import {pluginSourceEditable} from "@bottega/contracts/plugins/surface/source";
import {useComposerTranslation} from "@ai-chat/chat-ui/composer-translation";
import type {PluginComposerEntry} from "@ai-chat/chat-ui/plugins/host/contracts";

export function useSketchComposer(
  controller: ChatSessionController["composer"],
  editor: RefObject<RichInputHandle | null>,
  disabled: boolean,
  target?:{ownerDeviceId:string;entries:readonly PluginComposerEntry[]},
) {
  const { t, i18n } = useAppTranslation(),
    state = useComposerState(controller.chatId);
  const localEntries = useComposerPlugins(), entries = target?.entries??localEntries, copy = useComposerTranslation(i18n.language);
  const submissionOwners = useRef(new Map<string, ComposerOwner>());
  useLayoutEffect(() => {
    setSketchEditable(controller.chatId, !disabled);
  }, [controller.chatId, disabled]);
  const focusComposer = () => {
    if (!editor.current) return false;
    editor.current.focus();
    return true;
  };
  const open = (entry: PluginComposerEntry, id?: string, returnFocus?: HTMLElement | null) => {
    try {
      if (disabled) throw new Error("SKETCH_READ_ONLY");
      openSketch(controller.chatId, id, focusComposer, returnFocus, entry, target?.ownerDeviceId);
    } catch (error) {
      controller.setAttachmentNotice(sketchErrorMessage(error));
    }
  };
  const count =
    state.draft.files.length +
    state.draft.richValue.filter((node) => node.type === "file").length;
  const newDisabled =
    disabled || count >= 8 || composerMigrating(controller.chatId);
  const attachmentAction: PromptInputAttachmentsProps["attachmentAction"] = file => {
    const source = state.sketch.pluginSources?.get(file.id);
    if (!source) return undefined;
    const entry = entries.find(entry => entry.id === source.pluginId);
    const compatible = entry && entry.enabled && entry.generationId && pluginSourceEditable(source, {pluginId:entry.id,format:entry.sourceFormat});
    return {preview:!compatible,label:compatible ? t("sketch.edit") : copy("sketch.versionRequired"), onClick:()=>{
      if(compatible)open(entry,file.id);else controller.setAttachmentNotice(copy("sketch.versionRequired"));
    },badge:<span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-white p-1 text-black shadow-sm"><PencilIcon className="size-3" aria-hidden="true"/></span>};
  };
  const disabledReason = count >= 8 ? t("sketch.attachmentLimit") : composerMigrating(controller.chatId) ? t("sketch.migrationActive") : t("sketch.readOnly");
  return {
    plugins: entries.filter(entry=>entry.enabled).map(entry=>({id:entry.id,name:entry.id==='sketch'?t('sketch.title'):entry.composer.title,icon:entry.composer.icon,
      disabled:newDisabled||!entry.enabled||!entry.generationId,reason:(!entry.generationId?entry.error:undefined)??(!entry.enabled?t('sketch.readOnly'):newDisabled?disabledReason:undefined),
      run:(anchor:HTMLElement|null)=>open(entry,undefined,anchor)})),
    preload: () => {},
    newDisabled,
    disabledReason,
    attachmentAction,
    prepare(
      message: PromptInputMessage,
      { submissionToken }: { submissionToken: string },
    ) {
      const owner = captureComposerOwner(controller.chatId);
      submissionOwners.current.set(submissionToken, owner);
      pinSketchSubmission(owner, submissionToken, message);
      try {
        return freezeGalleryDraft(controller.chatId, message);
      } catch (cause) {
        // The notice gets localized copy; the raw cause (a coded refusal, or a schema issue list) stays traceable in the log.
        console.warn("[composer] send preparation failed", cause);
        throw new Error(sendPreparationMessage(cause), { cause });
      }
    },
    settled(token: string) {
      const owner = submissionOwners.current.get(token);
      submissionOwners.current.delete(token);
      if (owner) settleSketchSubmission(owner, token);
    },
  };
}
