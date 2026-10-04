/**
 * [INPUT]: Depends on the workbench build flag, the main window's plugins bridge, provider identity and workbench-copy.
 * [OUTPUT]: Provides useTurnedOffPlugins (the ids of plugins turned off, from ordered catalog reads) and useProviderTurnedOff — for a Chat's Provider, the notice and action label when its plugin is turned off
 *           in Plugins (its action opens that plugin's detail page), else null.
 * [POS]: Lets the composer refuse a send up front with the real reason instead of a generic service failure. With the flag
 *        off the hook is a constant null, so neither the catalog nor the bridge enters the composer's first-load chunk.
 */
import { useEffect, useState } from "react";
import { formatWorkbench, useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { workbenchUiEnabled } from "@ai-chat/ui/lib/workbench-flag";
import { backendLabel } from "@/lib/agent/agent-backends";
import { pluginsBridge } from "@/lib/apps/plugins-client";

const EMPTY = new Set<string>();
function useDisabledPlugins() {
  const [off, setOff] = useState<ReadonlySet<string>>(EMPTY);
  useEffect(() => {
    const bridge = pluginsBridge();
    if (!bridge) return;
    let live = true, generation = 0;
    const load = () => {
      const request = ++generation;
      void bridge.list().then(list => {
        if (live && request === generation) setOff(new Set(list.flatMap(plugin => !plugin.enabled ? [plugin.id] : [])));
      }, () => undefined);
    };
    const stop = bridge.onChanged(load);
    load();
    return () => { live = false; stop(); };
  }, []);
  return off;
}
export const useTurnedOffPlugins = workbenchUiEnabled ? useDisabledPlugins : () => EMPTY;

function useTurnedOff(providerId: string, locale: string) {
  const workbench = useWorkbenchCopy(locale);
  const off = useTurnedOffPlugins();
  if (!off.has(providerId)) return null;
  return { message: formatWorkbench(workbench.plugins.chatTurnedOff, { provider: backendLabel(providerId) }), action: formatWorkbench(workbench.plugins.openPlugin, { name: backendLabel(providerId) }) };
}

export const useProviderTurnedOff: (providerId: string, locale: string) => { message: string; action: string } | null =
  workbenchUiEnabled ? useTurnedOff : () => null;
