/**
 * [INPUT]: Depends on zod only.
 * [OUTPUT]: Provides the machine-local DockLocalState schema/defaults (enable, preferred mode, replacement intent, consent version, display, visibility, handle, shortcut, scale, privacy mask, per-mode running area, native bindings) and the replacement phase/registration vocabularies.
 * [POS]: shared/system-dock local facts; never synced, never uploaded (INV-06). Three lifetimes stay separate: intent (replacementEnabled), this run's takeover (phase), and the system registration fact (INV-02).
 */

import { z } from "zod";

export const DOCK_CONSENT_VERSION = 1;
export const DOCK_MODES = ["replace", "coexist"] as const;
export type DockMode = (typeof DOCK_MODES)[number];
/** Runtime takeover of this process; never persisted as a promise of the next run. */
export type ReplacementPhase = "inactive" | "preparing" | "active" | "restoring" | "suspended";
/** SMAppService facts exactly as the OS reports them; anything else is rejected, not coerced. */
export const RECOVERY_REGISTRATION = ["not-registered", "enabled", "requires-approval", "not-found"] as const;
export type RecoveryRegistration = (typeof RECOVERY_REGISTRATION)[number];
export type SuspendReason = "external-change" | "managed" | "journal-corrupt" | "agent-unhealthy" | "renderer-failed" | "entry-unreachable"
  | "empty-layout" | "registration-disabled" | "unsupported" | "write-failed" | "owned-elsewhere" | "display-unavailable" | "user-restored";

const nativeBindingSchema = z.object({ path: z.string().min(1).max(4096), bundleIdentifier: z.string().max(255).nullable() }).strict();
export const dockLocalStateSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  preferredMode: z.enum(DOCK_MODES),
  replacementEnabled: z.boolean(),
  consentVersion: z.number().int().positive().nullable(),
  displayPreference: z.object({ displayId: z.number().int().nullable() }).strict(),
  edge: z.literal("bottom"),
  visibility: z.enum(["autohide", "pinned"]),
  showHandle: z.boolean(),
  shortcut: z.string().max(64).nullable(),
  scale: z.number().min(0.75).max(1.5),
  privacyMask: z.boolean(),
  showRunningByMode: z.object({ replace: z.boolean(), coexist: z.boolean() }).strict(),
  coexistenceFallback: z.enum(["above-system-dock", "hide"]),
  /* Installation-local resolution of pinned native/Bottega Apps; item IDs only, no synced data. */
  nativeBindings: z.record(z.string().max(64), nativeBindingSchema),
}).strict();
export type DockLocalState = z.infer<typeof dockLocalStateSchema>;

export const DEFAULT_DOCK_LOCAL_STATE: DockLocalState = Object.freeze({
  version: 1, enabled: false, preferredMode: "replace", replacementEnabled: false, consentVersion: null,
  displayPreference: { displayId: null }, edge: "bottom", visibility: "autohide", showHandle: true,
  shortcut: "Alt+Shift+Command+D", scale: 1, privacyMask: false,
  showRunningByMode: { replace: true, coexist: false }, coexistenceFallback: "above-system-dock", nativeBindings: {},
}) as DockLocalState;

/** Fields the renderer may patch directly; mode, replacement intent, consent and bindings go through dedicated flows. */
export const dockPreferencePatchSchema = z.object({
  displayPreference: dockLocalStateSchema.shape.displayPreference.optional(),
  visibility: dockLocalStateSchema.shape.visibility.optional(),
  showHandle: z.boolean().optional(),
  shortcut: dockLocalStateSchema.shape.shortcut.optional(),
  scale: dockLocalStateSchema.shape.scale.optional(),
  privacyMask: z.boolean().optional(),
  showRunning: z.boolean().optional(),
  coexistenceFallback: dockLocalStateSchema.shape.coexistenceFallback.optional(),
}).strict();
export type DockPreferencePatch = z.infer<typeof dockPreferencePatchSchema>;

export function parseDockLocalState(value: unknown): DockLocalState | null {
  const result = dockLocalStateSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function applyPreferencePatch(state: DockLocalState, patch: DockPreferencePatch, mode: DockMode): DockLocalState {
  const { showRunning, ...rest } = patch;
  const next = { ...state, ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) } as DockLocalState;
  if (showRunning !== undefined) next.showRunningByMode = { ...state.showRunningByMode, [mode]: showRunning };
  return dockLocalStateSchema.parse(next);
}
