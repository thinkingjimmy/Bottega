/**
 * [INPUT]: Depends on the native bridge port (preference-service read of persistent tiles), NativeApps resolution and icon keys, and the shared layout draft types.
 * [OUTPUT]: Provides readImportCandidates: a read-only, session-scoped projection of the system Dock's pinned items into import candidates (Finder and verified Downloads normalized to system entries; recents, files, URLs and spacers skipped with a reason; managed/unavailable reads explained) with mode-dependent preselection, and the confirmed-draft builder.
 * [POS]: system-dock/native import adapter (3.3, DCK-46); candidates never persist, never upload, and are never written back to the system Dock (INV-01/06).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ImportCandidate } from "../../../../shared/system-dock/ipc";
import type { DockItemDraft } from "../../../../shared/system-dock/layout";
import type { DockMode } from "../../../../shared/system-dock/local-state";
import type { NativeApps } from "./apps";
import type { NativePort } from "./bridge";
import type { PersistentTile } from "./protocol";

export type ImportSession = { candidates: ImportCandidate[]; drafts: Map<string, DockItemDraft>; readFailure: "unavailable" | "managed" | "unknown" | null };

function note(tile: PersistentTile): ImportCandidate["note"] {
  if (tile.tileType.includes("recent")) return "recent-apps";
  if (tile.tileType.includes("spacer")) return "spacer";
  if (tile.tileType.includes("url")) return "url";
  return tile.section === "others" || tile.tileType.includes("directory") ? "file" : "unknown";
}
export async function readImportCandidates(input: { native: NativePort; apps: NativeApps; mode: DockMode; downloadsPath?: string }): Promise<ImportSession> {
  const downloads = input.downloadsPath ?? join(homedir(), "Downloads");
  const session: ImportSession = { candidates: [], drafts: new Map(), readFailure: null };
  let read;
  try { read = await input.native.request({ op: "dock-persistent-apps" }); } catch { session.readFailure = "unavailable"; return session; }
  if (read.status === "managed") session.readFailure = "managed";
  else if (read.status === "unavailable") { session.readFailure = "unavailable"; return session; }
  const seen = new Set<string>();
  let index = 0;
  for (const tile of read.tiles) {
    const key = `c${index++}`;
    const label = tile.label ?? tile.bundleIdentifier ?? "";
    // Finder is already the first system entry; a verified pinned Downloads folder becomes the system entry.
    if (tile.bundleIdentifier === "com.apple.finder") continue;
    if (tile.section === "others" && tile.path && tile.path.replace(/\/$/, "") === downloads) {
      if (seen.has("system.downloads")) continue; seen.add("system.downloads");
      session.drafts.set(key, { kind: "system", entry: "system.downloads" });
      session.candidates.push({ key, label, bundleIdentifier: null, iconKey: input.apps.iconKey(tile.path), status: "ok", note: null, preselected: input.mode === "replace" });
      continue;
    }
    if (tile.section !== "apps" || !tile.tileType.includes("file") || (!tile.bundleIdentifier && !tile.path)) {
      session.candidates.push({ key, label, bundleIdentifier: null, iconKey: null, status: "unsupported", note: note(tile), preselected: false });
      continue;
    }
    const resolved = await input.apps.resolve(tile.bundleIdentifier ? { bundleIdentifier: tile.bundleIdentifier } : { path: tile.path });
    const identity = resolved?.bundleIdentifier ?? tile.bundleIdentifier ?? tile.path!;
    if (seen.has(identity)) continue; seen.add(identity);
    const status: ImportCandidate["status"] = resolved ? "ok" : "unresolved";
    const bundleIdentifier = resolved?.bundleIdentifier ?? tile.bundleIdentifier;
    if (bundleIdentifier) session.drafts.set(key, { kind: "native-app", platform: "darwin", bundleIdentifier, localApp: null, label: resolved?.name ?? label });
    session.candidates.push({ key, label: resolved?.name ?? label, bundleIdentifier, iconKey: input.apps.iconKey(resolved?.path ?? tile.path),
      status: bundleIdentifier ? status : "unsupported", note: bundleIdentifier ? null : "unknown", preselected: input.mode === "replace" && status === "ok" && Boolean(bundleIdentifier) });
  }
  return session;
}
/** Only confirmed keys become drafts, in the system Dock's relative order (3.3). */
export function confirmedDrafts(session: ImportSession, selected: readonly string[]): DockItemDraft[] {
  const chosen = new Set(selected);
  return session.candidates.filter((candidate) => chosen.has(candidate.key) && session.drafts.has(candidate.key)).map((candidate) => session.drafts.get(candidate.key)!);
}
