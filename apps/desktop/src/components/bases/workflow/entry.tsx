/**
 * [INPUT]: Depends on the shared DropdownMenu, the workbench build flag, workbench-copy, the Project's workflow binding and the
 *          lazily loaded setup host.
 * [OUTPUT]: Provides useWorkflowEntry — the Workflow group of a Project Base's ⋯ menu (Set up a workflow… / Workflow
 *           settings) and the setup dialog it opens — plus the lazy WorkflowSetupHost.
 * Disabled Workflow actions explain the plugin state and link to Plugins & Apps.
 * [POS]: One of the three ways into the same dialog (Base ⋯, a row's ▶, Project settings › Workflows; Q3/Q33); the other
 *        menu groups stay where they are. With the flag off the hook is a constant empty result, and the dialog, recipe
 *        and port always load on demand, so the Base header's first-load chunk carries none of them (OPT-30).
 */
import { useState, type ComponentProps, type ReactNode } from "react";
import { SettingsIcon, WorkflowIcon } from "lucide-react";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@ai-chat/ui/components/ui/dropdown-menu";
import { formatWorkbench, useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { workbenchUiEnabled } from "@ai-chat/ui/lib/workbench-flag";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useTurnedOffPlugins } from "@/components/settings/plugins/turned-off";
import { requestSettingsSection } from "@/lib/settings/navigation/settings-navigation";
import { useProjectBinding } from "./bridge";

import { useDeferredModule } from "@ai-chat/ui/hooks/use-deferred-module";
import { DeferredDialog } from "@/components/deferred/status";
const loadSetup = () => import("./setup-host");
function DeferredWorkflowSetup(props: ComponentProps<typeof import("./setup-host").default>) {
  const module = useDeferredModule(loadSetup), Host = module.value?.default;
  const { i18n } = useAppTranslation();
  const copy = useWorkbenchCopy(i18n.language);
  return Host ? <Host {...props} /> : <DeferredDialog title={copy.base.settings} failed={module.failed} retry={module.retry} reloadRequired={module.reloadRequired} onClose={props.onClose} />;
}
export const WorkflowSetupHost = workbenchUiEnabled ? DeferredWorkflowSetup : null;

type Entry = { menuItems: ReactNode; dialog: ReactNode };
const NONE: Entry = { menuItems: null, dialog: null };

function useEntry({ projectId }: { projectId: string | null }): Entry {
  const { i18n } = useAppTranslation();
  const workbench = useWorkbenchCopy(i18n.language);
  const [open, setOpen] = useState<"new" | "edit" | null>(null);
  const binding = useProjectBinding(projectId);
  const disabled = useTurnedOffPlugins().has("workflow");
  if (!projectId) return NONE;
  return {
    menuItems: (
      <>
        <DropdownMenuLabel className="text-muted-foreground text-xs">{workbench.base.menuGroup}</DropdownMenuLabel>
        <DropdownMenuItem disabled={disabled} title={disabled ? workbench.run.startWorkflowOff : undefined} onSelect={() => setOpen("new")}><WorkflowIcon />{workbench.base.setUp}</DropdownMenuItem>
        <DropdownMenuItem disabled={disabled || !binding} onSelect={() => setOpen("edit")}><SettingsIcon />{workbench.base.settings}</DropdownMenuItem>
        {disabled && <><DropdownMenuLabel className="max-w-64 whitespace-normal text-muted-foreground text-xs">{workbench.run.startWorkflowOff}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => requestSettingsSection({ section: "plugins", plugin: "workflow" })}>{formatWorkbench(workbench.plugins.openPlugin, { name: workbench.plugins.builtin.workflow.name })}</DropdownMenuItem></>}
        <DropdownMenuSeparator />
      </>
    ),
    dialog: open && WorkflowSetupHost ? <WorkflowSetupHost projectId={projectId} editing={open === "edit"} onClose={() => setOpen(null)} /> : null,
  };
}

export const useWorkflowEntry: (input: { projectId: string | null }) => Entry =
  workbenchUiEnabled ? useEntry : () => NONE;
