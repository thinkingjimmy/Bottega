/**
 * [INPUT]: No runtime dependencies.
 * [OUTPUT]: The closed record Surface operation vocabulary.
 * [POS]: Lightweight leaf shared by Surface loaders and record payload contracts.
 */
export const RECORD_SURFACE_OPERATIONS = ["plugin.open", "plugin.heartbeat", "plugin.close", "plugin.settings.read",
  "base.record.read", "base.results.list", "base.results.read", "base.results.report"] as const;
