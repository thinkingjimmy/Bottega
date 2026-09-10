/**
 * [INPUT]: Depends on the guarded presence bridge and revisioned native snapshots.
 * [OUTPUT]: Provides persistent boolean/mode commands with pending state and exact retry targets across remounts, plus the task-panel shortcut toggle.
 * [POS]: Renderer presence owner; every preference command is applied by the main presence service.
 */

import type { PresenceDisplayMode, PresenceReason, PresenceSnapshot } from "../../shared/presence-ipc";

export type PresenceField = "login" | "retention";
export type PresenceCommand<T> = Readonly<{ target: T; status: "pending" | "failed" | "blocked"; reason: PresenceReason }>;
type PresenceCommands = { login?: PresenceCommand<boolean>; retention?: PresenceCommand<boolean>; display?: PresenceCommand<PresenceDisplayMode> };
type PresenceState = Readonly<{ presence: PresenceSnapshot | null; commands: PresenceCommands }>;
let value: PresenceState = { presence: null, commands: {} };
const listeners = new Set<() => void>();
let loaded = false;
const notify = () => { for (const listener of listeners) listener(); };
const preference = (snapshot: PresenceSnapshot, field: PresenceField) => field === "login" ? snapshot.preferences.launchAtLogin : snapshot.preferences.keepRunningInBackground;
const publish = (next: PresenceSnapshot) => {
  if (value.presence && next.revision < value.presence.revision) return;
  const commands = { ...value.commands };
  for (const field of ["login", "retention"] as const) {
    const command = commands[field];
    if (command && command.status !== "pending" && preference(next, field) === command.target &&
        next[field].status === (command.target ? "enabled" : "disabled")) delete commands[field];
  }
  const display = commands.display;
  if (display && display.status !== "pending" && next.display.status === "enabled" && next.effectiveDisplayMode === display.target &&
      next.preferences.showTaskStatusAtTop === (display.target === "notch")) delete commands.display;
  value = { ...value, presence: next, commands }; notify();
};
const setCommand = <K extends keyof PresenceCommands>(field: K, command?: PresenceCommands[K]) => {
  const commands = { ...value.commands };
  if (command) commands[field] = command;
  else delete commands[field];
  value = { ...value, commands }; notify();
};
const busy = () => value.presence?.quitting || Object.values(value.commands).some((command) => command?.status === "pending");
const refresh = async () => {
  if (!loaded && window.presence) { loaded = true; window.presence.onChanged(publish); }
  const next = await window.presence?.refresh();
  if (next) publish(next);
};
export const presenceStore = {
  getSnapshot: () => value,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  load() { void refresh().catch(() => {}); },
  async togglePanel() { await window.presence?.togglePanel(); },
  async set(field: PresenceField, target: boolean) {
    if (busy()) return;
    setCommand(field, { target, status: "pending", reason: null });
    try {
      if (!window.presence) throw new Error("PRESENCE_UNAVAILABLE");
      const next = await (field === "login" ? window.presence.setLaunchAtLogin(target) : window.presence.setWindowRetention(target));
      publish(next);
      const status = next[field];
      setCommand(field, status.status === "failed" || status.status === "blocked" ? { target, status: status.status, reason: status.reason } : undefined);
    } catch { setCommand(field, { target, status: "failed", reason: "save-failed" }); }
  },
  async setDisplayMode(target: PresenceDisplayMode) {
    if (busy()) return;
    setCommand("display", { target, status: "pending", reason: null });
    try {
      if (!window.presence) throw new Error("PRESENCE_UNAVAILABLE");
      const next = await window.presence.setDisplayMode(target);
      publish(next);
      const status = next.display;
      setCommand("display", status.status === "failed" || status.status === "blocked" ? { target, status: status.status, reason: status.reason } : undefined);
    } catch { setCommand("display", { target, status: "failed", reason: "save-failed" }); }
  },
};
