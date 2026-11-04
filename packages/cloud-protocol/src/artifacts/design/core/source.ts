/**
 * [INPUT]: Immutable source members, explicit native indexes and the current system manifest.
 * [OUTPUT]: A validated current native or system manifest; unsupported sources are never converted.
 * [POS]: Single source-format boundary for capture and local/encrypted archive reads.
 */
import { manifestSchema, type DesignManifest } from "../model";
import { readDashboardSource } from "../dashboard/model";
import { projectNativeManifest } from "../native/source";
export function readDesignManifest(files: readonly { path: string; data: Uint8Array }[], documentId: string): DesignManifest {
  const canvas = files.find(file => file.path === "canvas.json"), deck = files.find(file => file.path === "deck.json");
  const dashboard = files.some(file => file.path === "dashboard.json");
  if ([Boolean(canvas), Boolean(deck), dashboard].filter(Boolean).length > 1) throw new Error("Ambiguous document indexes");
  if (dashboard) return manifestSchema.parse(readDashboardSource(files, documentId).manifest);
  if (canvas) {
    if (canvas.data.length > 65_536) throw new Error("Document index exceeds 64 KiB");
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(canvas.data));
    if (raw?.format === "bottega-design-system") {
      const manifest = manifestSchema.parse(raw);
      if (manifest.documentId !== documentId) throw new Error("System document identity does not match its directory");
      return manifest;
    }
  }
  return manifestSchema.parse(projectNativeManifest(files, documentId));
}
