/**
 * [INPUT]: Agent configuration dialog props, deferred module loading and shared modal feedback.
 * [OUTPUT]: AgentConfigDialog loads the editor only when opened and offers failure retry.
 * [POS]: Small settings entry preserving the list and unsaved parent state during editor loading.
 */
import type { ComponentProps } from "react";
import { useDeferredModule } from "@ai-chat/ui/hooks/use-deferred-module";
import { DeferredDialog } from "@/components/deferred/status";
const loadDialog = () => import("./config-dialog");
export function AgentConfigDialog(props: ComponentProps<typeof import("./config-dialog").AgentConfigDialog>) {
  const module = useDeferredModule(loadDialog, props.open), Dialog = module.value?.AgentConfigDialog;
  if (!props.open) return null;
  return Dialog ? <Dialog {...props} /> : <DeferredDialog title={props.editing ? props.workbench.agentConfigs.editTitle : props.workbench.agentConfigs.newTitle}
    failed={module.failed} retry={module.retry} reloadRequired={module.reloadRequired} onClose={() => props.onOpenChange(false)} />;
}
