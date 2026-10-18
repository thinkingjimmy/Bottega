/**
 * [INPUT]: Depends on optional plugin stage/system requirement metadata and localized workbench copy.
 * [OUTPUT]: Provides PluginStage and PluginRequirement for catalog cards, introductions and settings.
 * [POS]: Shared plugin metadata presentation, independent of summary truncation and runtime state.
 */
import type { PluginView } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import type { WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { pluginText } from "../copy";

export function PluginStage({ plugin, workbench }: { plugin: Pick<PluginView, "releaseStage">; workbench: WorkbenchCopy }) {
  return plugin.releaseStage ? <span data-plugin-stage={plugin.releaseStage}
    className="shrink-0 rounded border border-foreground/15 px-1.5 py-0.5 font-medium text-muted-foreground text-[10px] leading-none">{workbench.plugins.stageAlpha}</span> : null;
}

export function PluginRequirement({ plugin, workbench }: { plugin: Pick<PluginView, "systemRequirement">; workbench: WorkbenchCopy }) {
  return plugin.systemRequirement ? <p data-plugin-requirement="" className="text-muted-foreground text-xs leading-[18px]">
    {pluginText(plugin.systemRequirement, workbench)}</p> : null;
}
