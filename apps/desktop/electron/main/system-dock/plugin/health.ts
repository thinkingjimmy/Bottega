/**
 * [INPUT]: Depends on the authoritative Dock settings snapshot and plugin health/effect contracts.
 * [OUTPUT]: Provides localized Dock health and read-only, mode-aware disable effects.
 * [POS]: Dock plugin projection; no native calls, authorization or persistence occur here.
 */
import type { PluginHealth } from "@bottega/contracts/plugins/catalog";
import type { PluginEffectKind } from "@bottega/contracts/plugins/impact";
import type { LocalizedText } from "@bottega/contracts/plugins/text";
import type { DockSettingsSnapshot } from "../../../../shared/system-dock/ipc";
import { dockText } from "./descriptor";

export function dockHealth(snapshot: DockSettingsSnapshot, ready: boolean): PluginHealth {
  const recoveryFailed = snapshot.recovery.pending || snapshot.recovery.lastResult === "failed" || snapshot.registration === "unknown";
  const paused = snapshot.phase === "suspended" || snapshot.suspendReason !== null;
  const active = snapshot.state.enabled && snapshot.actualMode !== null;
  const stopped = snapshot.state.enabled && !active;
  return {
    level: recoveryFailed ? "error" : !snapshot.capability.supported || !ready || paused || stopped ? "attention" : "ok",
    summary: dockText(recoveryFailed ? "recoveryPending" : !ready ? "loading" : !snapshot.capability.supported ? "unsupported" : paused ? "phase.suspended" : stopped ? "phase.inactive" : active ? "running" : "off"),
    facts: [
      { label: dockText("labels.mode"), value: dockText(snapshot.actualMode ?? "off") },
      { label: dockText("labels.phase"), value: dockText(`phase.${snapshot.actualMode === "coexist" && snapshot.phase === "inactive" ? "active" : snapshot.phase}`) },
      { label: dockText("labels.registration"), value: dockText(`registration.${snapshot.registration}`) },
      { label: dockText("labels.accessibility"), value: dockText(`permission.${snapshot.accessibility}`) },
      { label: dockText("labels.automation"), value: dockText(`permission.${snapshot.automation}`) },
      { label: dockText("labels.recovery"), value: dockText(`recovery.${snapshot.recovery.lastResult}`) },
      { label: dockText("labels.sync"), value: dockText(`sync.${snapshot.sync.state}`) },
      { label: dockText("labels.replacement"), value: dockText("replacementPending") },
    ], checkedAt: ready ? Date.now() : null,
  };
}
export function dockEffects(snapshot: DockSettingsSnapshot): Array<{ kind: PluginEffectKind; count: number; label: LocalizedText }> {
  const effects: ReturnType<typeof dockEffects> = [];
  if (snapshot.recovery.pending || snapshot.actualMode === "replace" && ["preparing", "active", "restoring"].includes(snapshot.phase)) {
    effects.push({ kind: "system-dock-restored", count: 1, label: dockText("effects.restore") });
  }
  if (["enabled", "requires-approval", "unknown"].includes(snapshot.registration)) {
    effects.push({ kind: "dock-agent-unregistered", count: 1, label: dockText("effects.unregister") });
  }
  if (snapshot.state.enabled || snapshot.actualMode) {
    effects.push({ kind: "dock-widgets-hidden", count: 1, label: dockText("effects.hide") });
  }
  return effects;
}
