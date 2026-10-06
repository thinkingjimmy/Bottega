/**
 * [INPUT]: Depends on the plugin catalog bridge, shared plugin controls, Settings feedback and localized workbench copy.
 * [OUTPUT]: Provides useMemoryPluginControl with the canonical plugin switch, failure notice and disable confirmation.
 * [POS]: Memory page chrome adapter; available before runtime setup and independent of the service switch in the page body.
 */
import { useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { SettingsAlert } from "@/components/settings/settings-layout";
import { PluginControl } from "@/components/settings/plugins/detail/about";
import { usePluginList } from "@/components/settings/plugins/use-plugins";
import { usePluginSwitch } from "@/components/settings/plugins/turn-off";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { pluginsBridge } from "@/lib/apps/plugins-client";

export function useMemoryPluginControl() {
  const bridge = pluginsBridge();
  const { i18n } = useAppTranslation();
  const locale = i18n.language;
  const workbench = useWorkbenchCopy(locale);
  const plugins = usePluginList(bridge);
  const switching = usePluginSwitch({ bridge, workbench, locale, plugins });
  const plugin = plugins?.find(item => item.id === "memory");
  return {
    control: plugin ? <PluginControl plugin={plugin} workbench={workbench} switching={switching} onSetup={() => undefined} /> : null,
    feedback: switching.failed ? <SettingsAlert>{switching.failed}</SettingsAlert> : null,
    dialog: switching.dialog,
  };
}
