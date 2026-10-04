/**
 * [INPUT]: Depends on the workbench build flag, workbench-copy, the plugins bridge and the plugin list hook with its text resolver.
 * [OUTPUT]: Provides useWorkbenchSettingsLabels — the sidebar labels for Agent configs and the Plugins group (its "All plugins" entry and
 *           one entry per turned-on plugin that has settings, plus Memory setup/recovery; each opens that plugin's settings page), or null when the flag is off.
 * [POS]: Keeps workbench-copy out of the sidebar's first-load chunk: with the flag off the hook is a constant null and the
 *        catalog import is dropped at build time (OPT-30).
 */
import { useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { workbenchUiEnabled } from "@ai-chat/ui/lib/workbench-flag";
import { pluginsBridge } from "@/lib/apps/plugins-client";
import { pluginText } from "@/components/settings/plugins/copy";
import { hasSettingsPage, usePluginList } from "@/components/settings/plugins/use-plugins";

export type WorkbenchSettingsLabels = {
  agentConfigs: string;
  pluginGroup: string;
  plugins: string;
  /** Settings entries, including Memory while off so setup and recovery remain reachable. */
  pluginItems: ReadonlyArray<{ id: string; label: string; icon: string | null }>;
};

export const useWorkbenchSettingsLabels: (locale: string) => WorkbenchSettingsLabels | null = workbenchUiEnabled
  ? locale => {
      const workbench = useWorkbenchCopy(locale);
      const plugins = usePluginList(pluginsBridge());
      return { agentConfigs: workbench.agentConfigs.title, pluginGroup: workbench.plugins.sidebarGroup, plugins: workbench.plugins.sidebarAll,
        pluginItems: (plugins ?? []).filter(hasSettingsPage)
          .map(plugin => ({ id: plugin.id, label: pluginText(plugin.name, workbench), icon: plugin.icon?.builtin ?? null })) };
    }
  : () => null;
