/**
 * [INPUT]: Depends on the guarded `window.systemDockSettings` bridge and revisioned Settings → Dock snapshots.
 * [OUTPUT]: Provides `dockSettingsStore` (revision-ordered snapshot, one pending command, the failed command for retry, optimistic preference patch), `effectivePreferences`, and the setup/import session calls the page drives.
 * [POS]: Renderer owner of Settings → Dock state; main applies every command and answers with the authoritative snapshot, so the renderer never claims a result main has not reported.
 */

import type { DockSettingsSnapshot, DockSetupPreview, ConflictChoice, SetupConfirm, SystemDockSettingsBridge } from "../../shared/system-dock/ipc";
import type { DockLocalState, DockMode, DockPreferencePatch } from "../../shared/system-dock/local-state";

declare global { interface Window { systemDockSettings?: SystemDockSettingsBridge } }

export type DockSettingsCommand = "setup" | "preference" | "mode" | "disable" | "restore" | "resume" | "reset" | "resolve" | "import";
export type DockSettingsState = Readonly<{
  snapshot: DockSettingsSnapshot | null;
  loadFailed: boolean;
  pending: DockSettingsCommand | null;
  failed: DockSettingsCommand | null;
  /** The preference patch in flight, shown immediately and dropped once main answers. */
  optimistic: DockPreferencePatch | null;
  /** Main's error code for the last failed command (e.g. `DOCK_LAYOUT_REVISION_CHANGED`), when it named one. */
  failedCode: string | null;
}>;

let value: DockSettingsState = { snapshot: null, loadFailed: false, pending: null, failed: null, optimistic: null, failedCode: null };
const listeners = new Set<() => void>();
let subscribed: { bridge: SystemDockSettingsBridge; stop: () => void } | null = null;
const set = (patch: Partial<DockSettingsState>) => { value = { ...value, ...patch }; for (const listener of listeners) listener(); };
const publish = (next: DockSettingsSnapshot) => {
  if (value.snapshot && next.revision < value.snapshot.revision) return;
  set({ snapshot: next, loadFailed: false });
};
const bridge = () => {
  if (!window.systemDockSettings) throw new Error("SYSTEM_DOCK_SETTINGS_UNAVAILABLE");
  return window.systemDockSettings;
};

async function run(command: DockSettingsCommand, action: (api: SystemDockSettingsBridge) => Promise<DockSettingsSnapshot>, optimistic: DockPreferencePatch | null = null) {
  // One command at a time: every Dock command can change what the next one means (mode, phase, layout).
  if (value.pending) return null;
  set({ pending: command, failed: null, optimistic, failedCode: null });
  try {
    const next = await action(bridge());
    publish(next);
    set({ pending: null, optimistic: null });
    return next;
  } catch (cause) {
    const failedCode = /\b(DOCK_[A-Z_]+)\b/.exec(cause instanceof Error ? cause.message : "")?.[1] ?? null;
    set({ pending: null, failed: command, optimistic: null, failedCode });
    return null;
  }
}

/** Saved preferences with an in-flight patch applied, so a switch never snaps back while saving. */
export function effectivePreferences(state: DockSettingsState): DockLocalState | null {
  const base = state.snapshot?.state;
  if (!base) return null;
  const patch = state.optimistic;
  if (!patch) return base;
  const { showRunning, ...rest } = patch;
  const mode = state.snapshot!.actualMode ?? base.preferredMode;
  return { ...base, ...Object.fromEntries(Object.entries(rest).filter(([, entry]) => entry !== undefined)),
    ...(showRunning === undefined ? {} : { showRunningByMode: { ...base.showRunningByMode, [mode]: showRunning } }) } as DockLocalState;
}

export const dockSettingsStore = {
  getSnapshot: () => value,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  load() {
    const api = window.systemDockSettings;
    if (!api) return;
    /* Revisions are only comparable within one bridge; a replaced bridge (window reload, tests)
       starts a fresh stream instead of being ignored as "older". */
    if (subscribed?.bridge !== api) {
      subscribed?.stop();
      value = { snapshot: null, loadFailed: false, pending: null, failed: null, optimistic: null, failedCode: null };
      subscribed = { bridge: api, stop: api.onChanged(publish) };
    }
    void api.snapshot().then(publish, () => set({ loadFailed: true }));
  },
  dismissFailure() { set({ failed: null }); },
  setPreference: (patch: DockPreferencePatch) => run("preference", (api) => api.setPreference(patch), patch),
  setMode: (mode: DockMode) => run("mode", (api) => api.setMode(mode)),
  disable: () => run("disable", (api) => api.disable()),
  restoreSystemDock: () => run("restore", (api) => api.restoreSystemDock()),
  resume: () => run("resume", (api) => api.resume()),
  resetLayout: () => run("reset", (api) => api.resetLayout()),
  resolveConflict: (choice: ConflictChoice) => run("resolve", (api) => api.resolveConflict(choice)),
  confirmSetup: (input: SetupConfirm) => run("setup", (api) => api.confirmSetup(input)),
  confirmImport: (sessionId: string, selected: readonly string[]) => run("import", (api) => api.confirmImport({ sessionId, selected: [...selected] })),
  /* Session calls return previews, not snapshots; the page owns their lifetime and cancels on leave. */
  beginSetup: (mode: DockMode): Promise<DockSetupPreview> => bridge().beginSetup(mode),
  importCandidates: (): Promise<DockSetupPreview> => bridge().importCandidates(),
  cancelSetup: (sessionId: string) => bridge().cancelSetup(sessionId).catch(() => undefined),
  openRecoverySettings: () => bridge().openRecoverySettings().catch(() => undefined),
};
