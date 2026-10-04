/**
 * [INPUT]: Shared dropdown primitives, attachment actions and the composer capability flags.
 * [OUTPUT]: ChatAddMenu.
 * [POS]: Composer attachment, plugin and Plan menu presentation.
 */
import { usePromptInputAttachments } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { type RichInputHandle } from "@ai-chat/ui/components/ai-elements/rich-input";
import { ComposerAddMenu as SharedComposerAddMenu } from "@ai-chat/chat-ui/composer-controls/add";
import type { ChatSessionController } from "../../runtime/use-chat-session";
import { useSketchComposer } from "../../sketch/host/use-sketch-composer";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

export function ChatAddMenu({
  controller,
  editor,
  disabled,
  turnControlsDisabled,
  sketch,
}: {
  controller: ChatSessionController["composer"];
  editor: React.RefObject<RichInputHandle | null>;
  disabled: boolean;
  turnControlsDisabled: boolean;
  sketch: ReturnType<typeof useSketchComposer>;
}) {
  const { t, i18n } = useAppTranslation();
  const attachments = usePromptInputAttachments();
  return <SharedComposerAddMenu locale={i18n.language} disabled={disabled}
    files={controller.imageInputAvailable ? { run: () => { editor.current?.saveSelection(); attachments.openFileDialog(); } } : undefined}
    plugins={controller.imageInputAvailable ? sketch.plugins : []}
    preload={controller.imageInputAvailable && !sketch.newDisabled ? sketch.preload : undefined}
    plan={{ active: controller.planMode, disabled: turnControlsDisabled || controller.skillsLoading || !controller.planSupported,
      reason: !controller.planSupported ? t("chat.composer.planUnavailable") : !controller.planMode && !controller.planAvailable ? controller.skillsError || t("chat.composer.planCheck") : undefined,
      run: () => { void controller.togglePlanMode(); } }} />;
}
