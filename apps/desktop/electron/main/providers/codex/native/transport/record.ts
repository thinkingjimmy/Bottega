/**
 * [INPUT]: Uses untrusted native protocol values.
 * [OUTPUT]: Exports nativeRecord for plain record projection.
 * [POS]: Shared structural guard; independent of transport and event mapping.
 */
export const nativeRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
