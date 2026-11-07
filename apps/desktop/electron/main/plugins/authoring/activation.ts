/**
 * [INPUT]: Bound source Chat authority, current ownership checks and the internal platform restoration port.
 * [OUTPUT]: createPluginVersionActivator binds cancellation and exact source ownership to version activation.
 * [POS]: Authoring mutation adapter; native Settings retains its separate main-owned restoration entry.
 */
import type { PluginSourceAuthoringAuthority } from "./unified";

export function createPluginVersionActivator(ports: {
  signal?: AbortSignal;
  assertCurrent(input: PluginSourceAuthoringAuthority & { pluginId: string }): void;
  restore(input: { pluginId: string; revisionId: string }, execution: { signal: AbortSignal; assertCurrent(): void }): Promise<unknown>;
}) {
  return async (pluginId: string, revisionId: string, authority: PluginSourceAuthoringAuthority) => {
    if (!authority?.signal || !authority.sourceRoot) throw new Error("Plugin source authoring authority is required");
    const signal = ports.signal ? AbortSignal.any([ports.signal, authority.signal]) : authority.signal;
    const input = { ...authority, pluginId, signal };
    const assertCurrent = () => { signal.throwIfAborted(); ports.assertCurrent(input); };
    assertCurrent();
    return ports.restore({ pluginId, revisionId }, { signal, assertCurrent });
  };
}
