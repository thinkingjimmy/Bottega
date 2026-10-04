/**
 * [INPUT]: Depends on the machine-local Dock edge vocabulary.
 * [OUTPUT]: Provides read-only logical display facts, placement reasons and the authoritative presentation projection.
 * [POS]: shared/system-dock runtime display contract; never persisted or included in the portable layout.
 */

import type { DockEdge } from "./local-state";

export type DockRect = { x: number; y: number; width: number; height: number };
export type DockDisplay = {
  id: number;
  /** Raw Electron label; display copy may decorate it, but selection validation compares this exact value. */
  label: string;
  internal: boolean;
  primary: boolean;
  bounds: DockRect;
  workArea: DockRect;
  scaleFactor: number;
  rotation: number;
  selectable: boolean;
};
export type DockHiddenBy =
  | "disabled" | "unsupported" | "user" | "locked-or-sleeping"
  | "not-ready" | "renderer-failed" | "coexist-hide"
  | "no-display" | "no-space" | "autohide" | "transition";
export type DockPresentation =
  | { presentation: "shown" | "handle"; hiddenBy: null }
  | { presentation: "hidden"; hiddenBy: DockHiddenBy };
export type DockPlacementReason = "primary" | "external" | "selected" | "unavailable" | "target-changed" | "no-space" | "no-display";
export type DockPlacementStatus = DockPresentation & {
  effectiveDisplayId: number | null;
  edge: DockEdge;
  reason: DockPlacementReason;
  sharedEdge: boolean;
  placementRevision: number;
};
