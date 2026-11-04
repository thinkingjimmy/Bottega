/**
 * [INPUT]: Untrusted retained manifest metadata.
 * [OUTPUT]: Identifies unsupported formats without parsing their retired content model.
 * [POS]: Preservation boundary; an unsupported record can never authorize execution.
 */
export function unsupportedDesignManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const manifest = value as Record<string, unknown>;
  if (manifest.format === "bottega-design-system") return false;
  return manifest.format !== "bottega-design" || !["canvas-dc/v3", "slides/v4", "dashboard/v1"].includes(String(manifest.contentFormat));
}
