/**
 * [INPUT]: Fulfilled main-owned authoring results and immutable revision records; no manifest/schema runtime imports.
 * [OUTPUT]: Bounded mutation receipts and revision-ID cursor pages containing metadata only.
 * [POS]: Agent tool output boundary; native UI full detail and revision APIs remain authoritative.
 */
const digest = /^sha256:[a-f0-9]{64}$/;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : undefined;
export function authoringReceipt(pluginId: string, operation: string, value: unknown) {
  const record = object(value), rawDiagnostics = Array.isArray(record.diagnostics) ? record.diagnostics : [];
  const diagnostics = rawDiagnostics.slice(0, 4).map(value => {
    const item = object(value);
    return { message: text(typeof value === "string" ? value : item.message, 512), code: text(item.code, 64), path: text(item.path, 256) };
  });
  const receipt: Record<string, unknown> = { pluginId, operation,
    status: text(record.status, 64) ?? (record.ok === false || record.valid === false ? "failed" : "completed") };
  for (const key of ["activeRevision", "availableRevision", "acceptedRevision", "revisionId", "manifestDigest"]) {
    const value = record[key]; if (value === null || typeof value === "string" && digest.test(value)) receipt[key] = value;
  }
  for (const key of ["ok", "valid", "changed"]) if (typeof record[key] === "boolean") receipt[key] = record[key];
  if (typeof record.error === "string") receipt.error = text(record.error, 2048);
  if (typeof record.pnpm === "string") receipt.pnpm = text(record.pnpm, 32);
  if (rawDiagnostics.length) {
    receipt.diagnostics = diagnostics; receipt.diagnosticCount = rawDiagnostics.length;
    receipt.diagnosticsTruncated = rawDiagnostics.length > diagnostics.length;
  }
  // Projection must never turn a completed mutation into an oversized tool-result failure.
  while (Buffer.byteLength(JSON.stringify(receipt)) > 16_384) {
    if (diagnostics.length) { diagnostics.pop(); receipt.diagnosticsTruncated = true; }
    else if (typeof receipt.error === "string" && receipt.error.length > 256) receipt.error = receipt.error.slice(0, Math.floor(receipt.error.length / 2));
    else { delete receipt.error; delete receipt.diagnostics; break; }
  }
  return receipt;
}
export function authoringVersionPage(pluginId: string, value: unknown, args: Record<string, unknown>) {
  if (!Array.isArray(value)) throw new Error("Plugin revision metadata is unavailable");
  const limit = args.limit ?? 10;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Plugin revision page limit is invalid");
  const rows = value.map(value => {
    const item = object(value), manifest = object(item.manifest);
    if (typeof item.revisionId !== "string" || !digest.test(item.revisionId) || typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt) ||
      typeof item.sourceVersion !== "number" || !Number.isSafeInteger(item.sourceVersion)) throw new Error("Plugin revision metadata is invalid");
    return { revisionId: item.revisionId, createdAt: item.createdAt, sourceVersion: item.sourceVersion,
      version: text(manifest.version, 128), ...(typeof item.valid === "boolean" ? { valid: item.valid } : {}) };
  }).sort((a, b) => b.createdAt - a.createdAt || a.revisionId.localeCompare(b.revisionId));
  const cursor = args.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || !digest.test(cursor))) throw new Error("Plugin revision cursor is invalid");
  const at = cursor === undefined ? -1 : rows.findIndex(item => item.revisionId === cursor);
  if (cursor !== undefined && at < 0) throw new Error("Plugin revision cursor is unavailable; start a new version page");
  const items = rows.slice(at + 1, at + 1 + limit);
  return { pluginId, items, total: rows.length, nextCursor: at + 1 + items.length < rows.length ? items.at(-1)!.revisionId : null };
}
