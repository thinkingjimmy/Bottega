/**
 * [INPUT]: Depends on source and transfer contracts plus declared record operation vocabulary.
 * [OUTPUT]: Provides plugin RPC allowlists, heartbeat timing and session lifecycle policy for composer and record surfaces.
 * [POS]: Shared isolated UI capability boundary; declaring an operation never bypasses host scope admission.
 */
export const PLUGIN_COMPOSER_OPERATIONS = ['plugin.open', 'plugin.heartbeat', 'plugin.close', 'plugin.dirty', 'plugin.settings.read',
  'plugin.transfer.begin', 'plugin.transfer.chunk', 'plugin.transfer.commit', 'plugin.transfer.abort',
  'plugin.source.read', 'plugin.compute.coverage'] as const;
export const PLUGIN_SURFACE_OPERATIONS = [...PLUGIN_COMPOSER_OPERATIONS,
  'base.record.read', 'base.results.list', 'base.results.read', 'base.results.report'] as const;
export type PluginSurfaceOperation = (typeof PLUGIN_SURFACE_OPERATIONS)[number];
export const PLUGIN_COMPUTE_CONTRACT = 'sketch.coverage/v1';
export const PLUGIN_SURFACE_LIVENESS = Object.freeze({ heartbeatMs: 3_000, timeoutMs: 15_000 } as const);
export const PLUGIN_RECOVERY_INTERVAL_MS = 400;
export const PLUGIN_TRANSFER_TTL_MS = 60_000;
/** The host reads these policies; plugin code never receives a Chat id or persistence port. */
export const PLUGIN_SURFACE_POLICY = Object.freeze({ compute: 'host-rpc', workerSrc: 'none', dirtyGeneration: 'recover-before-remount',
  recovery: 'device-local', transfer: 'bounded-chunks-atomic-commit' } as const);
