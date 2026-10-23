/**
 * [INPUT]: Screen CSS units shared by viewport admission and interaction overlays.
 * [OUTPUT]: One viewport hysteresis policy and a separate minimum interaction target.
 * [POS]: Canvas policy source consumed by production residency and module E2E.
 */
export const VIEWPORT_POLICY = { prefetchMarginCssPx: 200, retentionMarginCssPx: 400, releaseDelayMs: 500 } as const;
export const INTERACTION_POLICY = { minTargetCssPx: 44 } as const;
