/**
 * [INPUT]: Workbench build flag, localized plugin copy, the plugin bridge and its live list.
 * [OUTPUT]: useWorkbenchSettingsLabels supplies plugin group and enabled settings-page navigation.
 * [POS]: Sidebar navigation seam; disabled builds keep the optional catalog out of the initial chunk.
 */
import { useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { workbenchUiEnabled } from "@ai-chat/ui/lib/workbench-flag";
import { pluginsBridge } from "@/lib/apps/plugins-client";
import { pluginText } from "../copy";
import { hasSettingsPage, usePluginList } from "../use-plugins";
export type WorkbenchSettingsLabels = {
  pluginGroup: string; plugins: string;
  pluginItems: ReadonlyArray<{ id: string; label: string; icon: string | null }>;
};
export const useWorkbenchSettingsLabels: (locale: string) => WorkbenchSettingsLabels | null = workbenchUiEnabled
  ? locale => {
    const workbench = useWorkbenchCopy(locale), plugins = usePluginList(pluginsBridge());
    return { pluginGroup: workbench.plugins.sidebarGroup, plugins: workbench.plugins.sidebarAll,
      pluginItems: (plugins ?? []).filter(hasSettingsPage)
        .map(plugin => ({ id: plugin.id, label: pluginText(plugin.name, workbench), icon: plugin.icon?.builtin ?? null })) };
  } : () => null;
