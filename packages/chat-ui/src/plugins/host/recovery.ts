/**
 * [INPUT]: Host-scoped recovery ports and an admitted Surface environment lifetime.
 * [OUTPUT]: recoveryForScope serializes custody and fences terminal recovery before asynchronous cleanup.
 * [POS]: Modal recovery adapter; a failed cleanup cannot resurrect a saved/discarded document in this host lifetime.
 */
import type { PluginHostScope, PluginRecoveryPort, PluginSurfaceEnvironment } from './contracts';
type Scope = PluginHostScope & { pluginId: string; attachmentId?: string };
const owners = new WeakMap<PluginSurfaceEnvironment, Map<string, PluginRecoveryPort>>();
export function recoveryForScope(environment: PluginSurfaceEnvironment, scope: Scope): PluginRecoveryPort {
  let scopes = owners.get(environment);
  if (!scopes) { scopes = new Map(); owners.set(environment, scopes); }
  const key = JSON.stringify([scope.ownerDeviceId, scope.chatId, scope.incarnationId, scope.pluginId, scope.attachmentId ?? null]);
  const existing = scopes.get(key); if (existing) return existing;
  const port = environment.recovery(scope);
  let tail = Promise.resolve(), terminal = false, epoch = 0;
  const serial = <T,>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work); tail = result.then(() => {}, () => {}); return result;
  };
  const custody: PluginRecoveryPort = {
    read: () => serial(async () => terminal ? null : port.read()),
    write: source => {
      const captured = epoch;
      return serial(async () => { await port.write(source); if (captured === epoch) terminal = false; });
    },
    remove: () => {
      // Fence immediately; even a hung or rejected durable cleanup must not expose the old source on reopening.
      terminal = true; epoch++;
      return serial(() => port.remove());
    },
  };
  scopes.set(key, custody); return custody;
}
