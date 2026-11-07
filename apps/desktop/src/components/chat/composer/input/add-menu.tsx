/**
 * [INPUT]: Shared dropdown primitives, attachment actions, canonical main-owned host-view declarations and the composer capability flags.
 * [OUTPUT]: ChatAddMenu.
 * [POS]: Composer attachment, plugin and Plan menu presentation.
 */
import { useProjectImportAction } from "@ai-chat/chat-ui/artifact-projects";
import { usePromptInputAttachments } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { type RichInputHandle } from "@ai-chat/ui/components/ai-elements/rich-input";
import { ComposerAddMenu as SharedComposerAddMenu } from "@ai-chat/chat-ui/composer-controls/add";
import type { ChatSessionController } from "../../runtime/use-chat-session";
import { useSketchComposer } from "../../sketch/host/use-sketch-composer";
import { useRuntimePlugins } from "@/lib/plugin-platform/projection/runtime";
import { pluginContextCopy } from "@/lib/plugin-platform/context-copy";
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
  const native = useRuntimePlugins(),copy=pluginContextCopy(i18n.language);
  const sketchHost=native.items.find(item=>item.manifest.contributions.some(contribution=>contribution.kind==="composer"&&contribution.hostViewId==="sketch-composer"));
  const plugins=sketch.plugins.map(entry=>entry.id==="sketch"?{...entry,disabled:entry.disabled||!sketchHost?.runtimeReady,reason:!sketchHost?.runtimeReady?copy.unavailable:entry.reason}:entry);
  const attachments = usePromptInputAttachments(), project = useProjectImportAction();
  return <>{project.dialog}<SharedComposerAddMenu project={project.action} locale={i18n.language} disabled={disabled}
    files={controller.imageInputAvailable ? { run: () => { editor.current?.saveSelection(); attachments.openFileDialog(); } } : undefined}
    plugins={controller.imageInputAvailable ? plugins : []}
    preload={controller.imageInputAvailable && !sketch.newDisabled ? sketch.preload : undefined}
    plan={{ active: controller.planMode, disabled: turnControlsDisabled || controller.skillsLoading || !controller.planSupported,
      reason: !controller.planSupported ? t("chat.composer.planUnavailable") : !controller.planMode && !controller.planAvailable ? controller.skillsError || t("chat.composer.planCheck") : undefined,
      run: () => { void controller.togglePlanMode(); } }} /></>;
}
