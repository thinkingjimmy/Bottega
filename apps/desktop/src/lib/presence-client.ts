/**
 * [INPUT]: Depends on the guarded presence bridge, settings mutation owner, and external-store subscriptions.
 * [OUTPUT]: Provides revision-ordered native presence plus renderer-lifetime command targets, pending/failure states, explicit retries, and panel opening commands.
 * [POS]: Presence settings state owner; component remounts cannot discard in-flight commands or separate an error from its target.
 */

import type { PresenceReason, PresenceSnapshot } from "../../shared/presence-ipc";
import { settingsStore } from "./settings-store";

export type PresenceField = "login" | "retention" | "top";
type PresenceCommand = Readonly<{ target: boolean; status: "pending" | "failed" | "blocked"; reason: PresenceReason }>;
type PresenceState = Readonly<{
  presence: PresenceSnapshot | null;
  commands: Partial<Record<PresenceField, PresenceCommand>>;
}>;
let value: PresenceState = { presence: null, commands: {} };
const listeners = new Set<() => void>();
let loaded = false;
const notify = () => { for (const listener of listeners) listener(); };
const preference = (snapshot: PresenceSnapshot, field: PresenceField) => field === "login" ? snapshot.preferences.launchAtLogin :
  field === "retention" ? snapshot.preferences.keepRunningInBackground : snapshot.preferences.showTaskStatusAtTop;
const publish = (next: PresenceSnapshot) => {
  if (value.presence && next.revision < value.presence.revision) return;
  const commands = { ...value.commands };
  for (const field of ["login", "retention", "top"] as const) {
    const command = commands[field];
    if (command && command.status !== "pending" && preference(next, field) === command.target &&
        next[field].status === (command.target ? "enabled" : "disabled")) delete commands[field];
  }
  value = { ...value, presence: next, commands }; notify();
};
const setCommand = (field: PresenceField, command?: PresenceCommand) => {
  const commands = { ...value.commands };
  if (command) commands[field] = command;
  else delete commands[field];
  value = { ...value, commands }; notify();
};
const refresh = async () => {
  if (!loaded && window.presence) { loaded = true; window.presence.onChanged(publish); }
  const next = await window.presence?.refresh();
  if (next) publish(next);
  return next;
};
export const presenceStore = {
  getSnapshot: () => value,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  load() {
    void refresh().catch(() => {});
  },
  async openPanel() { await window.presence?.openPanel(); },
  async togglePanel() { await window.presence?.togglePanel(); },
  async set(field: PresenceField, enabled: boolean, saveFailure: string) {
    if (value.presence?.quitting || Object.values(value.commands).some((command) => command?.status === "pending")) return;
    setCommand(field, { target: enabled, status: "pending", reason: null });
    try {
      if (!window.presence) throw new Error("PRESENCE_UNAVAILABLE");
      let next: PresenceSnapshot | undefined;
      if (field === "top") {
        await settingsStore.update({ showTaskStatusAtTop: enabled }, saveFailure);
        if (settingsStore.getSnapshot().error) throw new Error("PRESENCE_SAVE_FAILED");
        next = await refresh();
      } else {
        next = await (field === "login" ? window.presence.setLaunchAtLogin(enabled) : window.presence.setWindowRetention(enabled));
        publish(next);
      }
      const status = value.presence?.[field] ?? next?.[field];
      if (status?.status === "failed" || status?.status === "blocked") {
        setCommand(field, { target: enabled, status: status.status, reason: status.reason });
      } else {
        setCommand(field);
      }
    } catch {
      setCommand(field, { target: enabled, status: "failed", reason: "save-failed" });
    }
  },
};
