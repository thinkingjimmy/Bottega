/**
 * [INPUT]: Depends on React and the main window's plugins bridge.
 * [OUTPUT]: Provides usePluginList — the catalog's plugin views, reloaded on every `plugins:changed` (null while loading, [] when it
 *           could not be read) — usePluginDetail for one plugin's detail with its own reload, and hasSettingsPage (whether the Settings
 *           sidebar lists a plugin, so its settings page exists). Only the newest requested read may update either projection.
 * [POS]: All plugins, the plugin pages and the Settings sidebar's Plugins group read the catalog through these hooks, so a switch in one
 *        place is seen everywhere without a second source.
 */
import { useCallback, useEffect, useState } from "react";
import type { PluginDetail, PluginView, PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";

/** A turned-on plugin with settings gets a sidebar entry; Memory keeps its entry while off so setup and recovery stay reachable. */
export const hasSettingsPage = (plugin: Pick<PluginView, "id" | "enabled" | "hasSettings">) => plugin.hasSettings && (plugin.enabled || plugin.id === "memory");

export function usePluginList(bridge: PluginsBridge | null) {
  const [plugins, setPlugins] = useState<PluginView[] | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      void bridge.list().then(
        next => { if (live && current === generation) setPlugins(next); },
        () => { if (live && current === generation) setPlugins(previous => previous ?? []); });
    };
    load();
    const stop = bridge.onChanged(load);
    return () => { live = false; stop(); };
  }, [bridge]);
  return plugins;
}

export function usePluginDetail(bridge: PluginsBridge | null, pluginId: string) {
  const [state, setState] = useState<{ id: string; detail: PluginDetail | null; error: string | null }>({ id: pluginId, detail: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      void bridge.detail(pluginId).then(
        detail => { if (live && current === generation) setState({ id: pluginId, detail, error: null }); },
        (error: unknown) => { if (live && current === generation) setState(previous => ({ id: pluginId, detail: previous.id === pluginId ? previous.detail : null, error: String((error as Error)?.message ?? error) })); });
    };
    load();
    const stop = bridge.onChanged(load);
    return () => { live = false; stop(); };
  }, [bridge, pluginId, attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { detail: state.id === pluginId ? state.detail : null, error: state.id === pluginId ? state.error : null, retry };
}
