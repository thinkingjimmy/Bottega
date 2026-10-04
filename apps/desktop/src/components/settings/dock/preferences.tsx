/**
 * [INPUT]: Depends on React, the desktop i18n provider, Settings primitives, the shared Select control and a native range, the Dock settings store with optimistic preferences, and the Dock local-state defaults.
 * [OUTPUT]: Provides `DockPlacement` (main-owned display directory, three edges and exception-only status), `DockAppearance` (visibility, handle, size 75–150 %, coexistence fallback), `DockBehavior` (keyboard shortcut recorder with key caps, open Apps for the current mode, privacy mask, Accessibility for restoring minimized windows) plus the pure `acceleratorProblem` / `acceleratorGlyphs` / `acceleratorFromEvent` helpers.
 * [POS]: settings/dock preference sections; pending requests lock controls while edge radios retain keyboard focus; display selections keep the last main-confirmed value.
 */

import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { PanelBottom, PanelLeft, PanelRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { SettingsBadge, SettingsButton, SettingsList, SettingsRow, SettingsSection, SettingsSwitch } from "../settings-layout";
import { dockSettingsStore, effectivePreferences, type DockSettingsState } from "@/lib/platform/system-dock-settings-client";
import type { DockDisplay } from "../../../../shared/system-dock/displays";
import { DEFAULT_DOCK_LOCAL_STATE, type DockEdge } from "../../../../shared/system-dock/local-state";

const MODIFIERS: Record<string, string> = { command: "⌘", cmd: "⌘", commandorcontrol: "⌘", cmdorctrl: "⌘", super: "⌘", meta: "⌘",
  control: "⌃", ctrl: "⌃", alt: "⌥", option: "⌥", altgr: "⌥", shift: "⇧" };
const NAMED_KEYS = new Set(["space", "tab", "backspace", "delete", "insert", "return", "enter", "up", "down", "left", "right", "home", "end",
  "pageup", "pagedown", "escape", "esc", "plus"]);

/** Light Electron accelerator check: at least one modifier and exactly one final key (main still owns registration conflicts). */
export function acceleratorProblem(value: string): "modifier" | "key" | null {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  const modifiers = parts.slice(0, -1);
  const key = parts.at(-1)?.toLowerCase() ?? "";
  if (!modifiers.length || modifiers.some((part) => !(part.toLowerCase() in MODIFIERS))) return "modifier";
  if (key in MODIFIERS || !(/^[a-z0-9]$/.test(key) || /^f([1-9]|1\d|2[0-4])$/.test(key) || NAMED_KEYS.has(key) || /^[`\-=[\]\\;',./]$/.test(key))) return "key";
  return null;
}
export function acceleratorGlyphs(value: string) {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  const order = ["⌃", "⌥", "⇧", "⌘"];
  const glyphs = parts.slice(0, -1).map((part) => MODIFIERS[part.toLowerCase()] ?? part).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const key = parts.at(-1) ?? "";
  return glyphs.join("") + (key.length === 1 ? key.toUpperCase() : key);
}

const CODE_KEYS: Record<string, string> = { Space: "Space", Tab: "Tab", Enter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`" };
/** An Electron accelerator from a physical key press (layout-independent `code`), or null while only modifiers are held. */
export function acceleratorFromEvent(event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5)
    : /^F([1-9]|1\d|2[0-4])$/.test(event.code) ? event.code : CODE_KEYS[event.code];
  if (!key) return null;
  return [event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Command", key].filter(Boolean).join("+");
}

function KeyCaps({ value }: { value: string }) {
  const glyphs = acceleratorGlyphs(value);
  const caps = [...glyphs.matchAll(/[\u2303\u2325\u21e7\u2318]|[^\u2303\u2325\u21e7\u2318]+/g)].map((match) => match[0]);
  return <span className="flex gap-1" aria-hidden="true">{caps.map((cap, index) => <kbd key={index}
    className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-background px-1.5 font-sans text-xs shadow-[0_0_0_1px_var(--color-border),0_1px_0_var(--color-border)]">{cap}</kbd>)}</span>;
}

function ShortcutRow({ value, disabled }: { value: string | null; disabled: boolean }) {
  const { t } = useAppTranslation();
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<"modifier" | "key" | null>(null);
  const save = (next: string | null) => { setRecording(false); setProblem(null); if (next !== value) void dockSettingsStore.setPreference({ shortcut: next }); };
  const record = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.stopPropagation();
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === "Escape") { setRecording(false); setProblem(null); return; }
    if (plain && (event.key === "Backspace" || event.key === "Delete")) { save(null); return; }
    const next = acceleratorFromEvent(event.nativeEvent);
    if (!next) return;
    const issue = acceleratorProblem(next);
    if (issue) setProblem(issue); else save(next);
  };
  const fallback = DEFAULT_DOCK_LOCAL_STATE.shortcut;
  return <SettingsRow label={t("systemDock.settings.shortcut")} htmlFor="dock-shortcut" description={<>
    <span className="block">{recording ? t("systemDock.settings.shortcutRecordingHint")
      : value ? t("systemDock.settings.shortcutCurrent", { keys: acceleratorGlyphs(value) }) : t("systemDock.settings.shortcutNone")}</span>
    {problem && <span className="mt-1 block text-destructive" role="alert">{t(problem === "modifier" ? "systemDock.settings.shortcutNeedsModifier" : "systemDock.settings.shortcutNeedsKey")}</span>}
    {fallback && value !== fallback && !recording && <span className="mt-2 flex"><SettingsButton variant="outline" disabled={disabled}
      onClick={() => save(fallback)}>{t("systemDock.settings.shortcutReset", { keys: acceleratorGlyphs(fallback) })}</SettingsButton></span>}
  </>} control={<span className="flex items-center gap-2">
    {value && !recording && <KeyCaps value={value} />}
    {/* While recording, the button itself owns the keyboard; leaving it cancels, so a stray key never lands elsewhere. */}
    <SettingsButton id="dock-shortcut" variant="outline" disabled={disabled} aria-describedby="dock-shortcut-description" aria-pressed={recording}
      className={recording ? "ring-2 ring-ring/40" : undefined}
      onClick={() => { setProblem(null); setRecording((current) => !current); }} onKeyDown={recording ? record : undefined}
      onBlur={() => setRecording(false)}>
      {t(recording ? "systemDock.settings.shortcutRecording" : "systemDock.settings.shortcutChange")}</SettingsButton>
  </span>} />;
}

function usePreferences(state: DockSettingsState) {
  const prefs = effectivePreferences(state);
  const snapshot = state.snapshot!;
  const mode = snapshot.actualMode ?? prefs?.preferredMode ?? "coexist";
  return { prefs, snapshot, mode, disabled: state.pending !== null, set: dockSettingsStore.setPreference };
}

export function DockAppearance({ state }: { state: DockSettingsState }) {
  const { t } = useAppTranslation();
  const { prefs, mode, disabled, set } = usePreferences(state);
  const [scale, setScale] = useState<number | null>(null);
  if (!prefs) return null;
  const shownScale = scale ?? Math.round(prefs.scale * 100);
  const commitScale = () => {
    if (scale === null) return;
    setScale(null);
    if (scale !== Math.round(prefs.scale * 100)) void set({ scale: scale / 100 });
  };
  return <SettingsSection title={t("systemDock.settings.appearanceTitle")}>
    <SettingsList>
      <SettingsRow label={t("systemDock.settings.visibility")} htmlFor="dock-visibility" description={t(prefs.visibility === "autohide" ? "systemDock.settings.visibilityAutohideDescription" : "systemDock.settings.visibilityPinnedDescription")}
        control={<Select value={prefs.visibility} disabled={disabled} onValueChange={(value) => void set({ visibility: value as typeof prefs.visibility })}>
          <SelectTrigger id="dock-visibility" size="lg" aria-describedby="dock-visibility-description"><SelectValue /></SelectTrigger>
          <SelectContent align="end" className="text-sm">
            <SelectItem value="autohide">{t("systemDock.settings.visibilityAutohide")}</SelectItem>
            <SelectItem value="pinned">{t("systemDock.settings.visibilityPinned")}</SelectItem>
          </SelectContent>
        </Select>} />
      <SettingsRow label={t("systemDock.settings.showHandle")} htmlFor="dock-handle" description={t("systemDock.settings.showHandleDescription")}
        control={<SettingsSwitch id="dock-handle" label={t("systemDock.settings.showHandle")} describedBy="dock-handle-description" checked={prefs.showHandle}
          disabled={disabled || prefs.visibility === "pinned"} onToggle={(showHandle) => void set({ showHandle })} />} />
      <SettingsRow label={t("systemDock.settings.size")} htmlFor="dock-size" description={t("systemDock.settings.sizeValue", { percent: shownScale })}
        control={<input id="dock-size" type="range" className="w-44 accent-foreground" min={75} max={150} step={5} value={shownScale} disabled={disabled}
          aria-describedby="dock-size-description" aria-valuetext={t("systemDock.settings.sizeValue", { percent: shownScale })}
          onChange={(event) => setScale(Number(event.target.value))}
          // One write per gesture: the thumb previews locally and only its release (or a key press) saves.
          onPointerUp={commitScale} onKeyUp={commitScale} onBlur={commitScale} />} />
      {mode === "coexist" && <SettingsRow label={t("systemDock.settings.fallback")} htmlFor="dock-fallback" description={t("systemDock.settings.fallbackDescription")}
        control={<Select value={prefs.coexistenceFallback} disabled={disabled} onValueChange={(value) => void set({ coexistenceFallback: value as typeof prefs.coexistenceFallback })}>
          <SelectTrigger id="dock-fallback" size="lg" aria-describedby="dock-fallback-description"><SelectValue /></SelectTrigger>
          <SelectContent align="end" className="text-sm">
            <SelectItem value="above-system-dock">{t("systemDock.settings.fallbackAbove")}</SelectItem>
            <SelectItem value="hide">{t("systemDock.settings.fallbackHide")}</SelectItem>
          </SelectContent>
        </Select>} />}
    </SettingsList>
  </SettingsSection>;
}

export function DockBehavior({ state }: { state: DockSettingsState }) {
  const { t } = useAppTranslation();
  const { prefs, snapshot, mode, disabled, set } = usePreferences(state);
  if (!prefs) return null;
  return <SettingsSection title={t("systemDock.settings.behaviorTitle")}>
    <SettingsList>
      {/* Keyed by the saved value: a new shortcut from main starts a fresh, error-free recorder. */}
      <ShortcutRow key={prefs.shortcut ?? ""} value={prefs.shortcut} disabled={disabled} />
      <SettingsRow label={t("systemDock.settings.showRunning")} htmlFor="dock-running"
        description={t(mode === "replace" ? "systemDock.settings.showRunningReplace" : "systemDock.settings.showRunningCoexist")}
        control={<SettingsSwitch id="dock-running" label={t("systemDock.settings.showRunning")} describedBy="dock-running-description"
          checked={prefs.showRunningByMode[mode]} disabled={disabled} onToggle={(showRunning) => void set({ showRunning })} />} />
      <SettingsRow label={t("systemDock.settings.privacyMask")} htmlFor="dock-mask" description={t("systemDock.settings.privacyMaskDescription")}
        control={<SettingsSwitch id="dock-mask" label={t("systemDock.settings.privacyMask")} describedBy="dock-mask-description" checked={prefs.privacyMask}
          disabled={disabled} onToggle={(privacyMask) => void set({ privacyMask })} />} />
      {snapshot.accessibility !== "unsupported" && <SettingsRow label={t("systemDock.settings.accessibilityLabel")}
        badge={snapshot.accessibility === "granted" ? undefined : <SettingsBadge tone="muted">{t("systemDock.settings.accessibilityOff")}</SettingsBadge>}
        description={t(snapshot.accessibility === "granted" ? "systemDock.settings.accessibilityGranted" : "systemDock.settings.accessibilityMissing")} control={null} />}
    </SettingsList>
  </SettingsSection>;
}

const EDGES = ["left", "bottom", "right"] as const;
const EDGE_ICONS = { left: PanelLeft, bottom: PanelBottom, right: PanelRight };
const displayKey = (id: number, label: string | null) => JSON.stringify([id, label]);

export function DockPlacement({ state }: { state: DockSettingsState }) {
  const { t } = useAppTranslation();
  const { prefs, snapshot, disabled, set } = usePreferences(state);
  if (!prefs) return null;
  const saved = snapshot.state.displayPreference;
  const displays = snapshot.displays.filter((display) => display.selectable);
  const name = (display: DockDisplay) => display.label || t(display.internal ? "systemDock.placement.builtIn" : "systemDock.placement.externalName");
  const describe = (display: DockDisplay) => {
    const sameName = displays.filter((item) => name(item) === name(display));
    return [name(display) + (sameName.length > 1 ? ` (${sameName.findIndex((item) => item.id === display.id) + 1})` : ""),
      ...(display.internal && display.label ? [t("systemDock.placement.builtIn")] : []), ...(display.primary ? [t("systemDock.placement.primaryBadge")] : []),
      `${Math.round(display.workArea.width)} × ${Math.round(display.workArea.height)}`].join(" · ");
  };
  const value = saved.displayId !== null ? displayKey(saved.displayId, saved.label) : saved.preferExternal ? "external" : "primary";
  const unavailable = saved.displayId !== null && !displays.some((display) => display.id === saved.displayId && display.label === saved.label);
  const select = (next: string) => {
    if (next === "primary" || next === "external") { void set({ displaySelection: { kind: next } }); return; }
    const display = displays.find((item) => displayKey(item.id, item.label) === next);
    if (display) void set({ displaySelection: { kind: "display", displayId: display.id, label: display.label } });
  };
  const placement = snapshot.placement;
  const effective = snapshot.displays.find((display) => display.id === placement.effectiveDisplayId);
  const currentName = effective ? name(effective) : t("systemDock.placement.availableDisplay");
  const messages: string[] = [];
  const inactive = placement.presentation === "hidden" && ["disabled", "unsupported", "not-ready"].includes(placement.hiddenBy);
  if (!inactive && placement.reason === "unavailable" && effective) messages.push(t(saved.preferExternal && saved.displayId === null
    ? "systemDock.placement.externalMissingHint" : "systemDock.placement.disconnectedHint", { display: currentName }));
  if (!inactive && placement.reason === "target-changed") messages.push(t("systemDock.placement.changedHint", { display: currentName }));
  if (placement.reason === "no-display") messages.push(t("systemDock.placement.noDisplayHint"));
  if (placement.reason === "no-space" && (!inactive || !effective)) messages.push(t(effective
    ? "systemDock.placement.noSpaceFallbackHint" : "systemDock.placement.noSpaceHint", { display: currentName }));
  if (snapshot.panelSpaceUnavailable) messages.push(t("systemDock.placement.panelSpaceHint"));
  if (placement.sharedEdge) messages.push(t("systemDock.placement.sharedHint"));
  if (placement.presentation === "hidden") {
    const hiddenKey = {
      disabled: "disabledHint", unsupported: "unsupportedHint", user: "userHiddenHint", "locked-or-sleeping": "lockedHint",
      "not-ready": "waitingHint", "renderer-failed": "failedRendererHint", "coexist-hide": "coexistHiddenHint",
      "no-display": "noDisplayHint", "no-space": "noSpaceHint", autohide: "autoHiddenHint", transition: "waitingHint",
    }[placement.hiddenBy];
    const message = t(`systemDock.placement.${hiddenKey}`);
    if (!messages.includes(message)) messages.push(message);
  }
  if (state.pending === "preference" && state.optimistic?.displaySelection) messages.push(t("systemDock.placement.pendingHint"));
  const canRestore = saved.displayId !== null || saved.preferExternal;
  const offerHandle = placement.sharedEdge || (placement.presentation === "hidden" && placement.hiddenBy === "autohide");
  return <SettingsSection title={t("systemDock.placement.title")}>
    <SettingsList>
      <SettingsRow label={t("systemDock.settings.display")} htmlFor="dock-display" description={t("systemDock.placement.displayHint")}
        control={<Select value={value} disabled={disabled} onValueChange={select}>
          <SelectTrigger id="dock-display" size="lg" className="max-w-80" aria-describedby="dock-display-description"><SelectValue /></SelectTrigger>
          <SelectContent align="end" className="max-w-[min(34rem,90vw)] text-sm">
            <SelectItem value="primary">{t("systemDock.placement.primary")}</SelectItem>
            <SelectItem value="external">{t("systemDock.placement.external")}</SelectItem>
            <div role="group" aria-label={t("systemDock.placement.displays")}><div aria-hidden="true" className="px-2 py-1 text-xs text-muted-foreground">{t("systemDock.placement.displays")}</div>
              {unavailable && <SelectItem value={value} disabled>{t("systemDock.placement.unavailable", { name: saved.label || t("systemDock.placement.selectedDisplay") })}</SelectItem>}
              {displays.map((display) => <SelectItem key={display.id} value={displayKey(display.id, display.label)}>{describe(display)}</SelectItem>)}
            </div>
          </SelectContent>
        </Select>} />
      <SettingsRow label={t("systemDock.placement.edge")} control={<div role="radiogroup" aria-label={t("systemDock.placement.edge")} className="flex gap-2">
        {EDGES.map((edge) => {
          const Icon = EDGE_ICONS[edge];
          return <button key={edge} id={`dock-edge-${edge}`} type="button" role="radio" aria-checked={prefs.edge === edge} aria-disabled={disabled}
            className={`flex min-w-20 flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${prefs.edge === edge ? "border-foreground bg-foreground/5" : disabled ? "border-border" : "border-border hover:bg-muted"}`}
            onKeyDown={(event) => {
              const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
              if (!direction) return;
              event.preventDefault();
              if (disabled) return;
              const next = EDGES[(EDGES.indexOf(edge) + direction + EDGES.length) % EDGES.length]!;
              document.getElementById(`dock-edge-${next}`)?.focus();
              void set({ edge: next });
            }} tabIndex={prefs.edge === edge ? 0 : -1} onClick={() => { if (!disabled) void set({ edge: edge as DockEdge }); }}>
            <Icon className="size-6" aria-hidden="true" /><span>{t(`systemDock.placement.${edge}`)}</span>
          </button>;
        })}
      </div>} />
    </SettingsList>
    {messages.length > 0 && <div data-placement-status="" className="space-y-2 text-sm text-muted-foreground" role="status" aria-live="polite">
      {messages.map((message) => <p key={message}>{message}</p>)}
      {(canRestore || (offerHandle && !prefs.showHandle)) && <div className="flex flex-wrap gap-2">
        {canRestore && <SettingsButton variant="outline" disabled={disabled} onClick={() => void set({ displaySelection: { kind: "primary" } })}>{t("systemDock.placement.primary")}</SettingsButton>}
        {offerHandle && !prefs.showHandle && <SettingsButton variant="outline" disabled={disabled} onClick={() => void set({ showHandle: true })}>{t("systemDock.settings.showHandle")}</SettingsButton>}
      </div>}
    </div>}
  </SettingsSection>;
}
