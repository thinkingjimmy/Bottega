/**
 * [INPUT]: Depends on shared UI shortcut mechanics, native defaults, settings, platform keys, React hooks, and the shared modal keyboard scope.
 * [OUTPUT]: Provides ShortcutId/SHORTCUT_IDS/SHORTCUT_DEFAULTS, resolveShortcut/matchesBinding/matchShortcut, bindingGlyphs/shortcutKeys, useShortcutBindings/useShortcutKeys, conflictingShortcutIds, captureBinding and useGlobalShortcuts
 * [POS]: Renderer shortcut matching and controls: defaults live in shared/shortcuts/bindings, user overrides live in settings.json (absent=default, null=disabled), resolution happens at event/render time so there is no stale closure; matching is exact on shift because rebinding lets any combo gain a second owner
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  captureShortcut,
  createShortcutDispatcher,
  matchesShortcut,
  shortcutGlyphs,
  shortcutConflicts,
  type CaptureResult,
} from "@ai-chat/ui/lib/shortcuts/model";
import type { ShortcutBinding } from "../../shared/settings-ipc";
export type { CaptureResult };
import { isApplePlatform } from "./platform";
import { settingsStore } from "./settings-store";
import { hasModalKeyboardScope } from "./modal-keyboard/scope";

export type { ShortcutBinding };

import {
  SHORTCUT_DEFAULTS,
  SHORTCUT_IDS,
  resolveShortcut,
  type ShortcutId,
  type ShortcutOverrides,
} from "../../shared/shortcuts/bindings";
export { SHORTCUT_DEFAULTS, SHORTCUT_IDS, resolveShortcut };
export type { ShortcutId, ShortcutOverrides };

const EMPTY_OVERRIDES: ShortcutOverrides = {};

/** 事件时/渲染时都读这份活覆写：settings 未载入前回落默认表。 */
function liveOverrides(): ShortcutOverrides {
  return (
    settingsStore.getSnapshot().settings?.keyboardShortcuts ?? EMPTY_OVERRIDES
  );
}

/* ⌥ 组合一律不认:那一片是系统与别家应用的地盘,把它也吃下来等于偷键。
   shift 精确匹配:可改绑之后 ⌘⇧K 随时可能有第二个主人,宽容即歧义。 */
export function matchesBinding(
  event: KeyboardEvent,
  binding: ShortcutBinding | null,
): boolean {
  return matchesShortcut(event, binding);
}

export function matchShortcut(
  event: KeyboardEvent,
  id: ShortcutId,
  overrides: ShortcutOverrides = liveOverrides(),
): boolean {
  return matchesBinding(event, resolveShortcut(id, overrides));
}

/* ── 键帽渲染 ──────────────────────────────────────────────────── */

export function bindingGlyphs(binding: ShortcutBinding): string[] {
  return shortcutGlyphs(binding, isApplePlatform());
}

/** null = 已停用,调用方据此隐藏键帽提示。 */
export function shortcutKeys(
  id: ShortcutId,
  overrides: ShortcutOverrides = liveOverrides(),
): string[] | null {
  const binding = resolveShortcut(id, overrides);
  return binding ? bindingGlyphs(binding) : null;
}

function resolveAll(
  overrides: ShortcutOverrides,
): Readonly<Record<ShortcutId, ShortcutBinding | null>> {
  return Object.fromEntries(
    SHORTCUT_IDS.map((id) => [id, resolveShortcut(id, overrides)]),
  ) as Record<ShortcutId, ShortcutBinding | null>;
}

/** 订阅设置快照的响应式全表：设置页与键帽展示位共用。 */
export function useShortcutBindings(): Readonly<
  Record<ShortcutId, ShortcutBinding | null>
> {
  const snapshot = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
  );
  useEffect(() => settingsStore.ensureLoaded(), []);
  const overrides = snapshot.settings?.keyboardShortcuts;
  return useMemo(() => resolveAll(overrides ?? EMPTY_OVERRIDES), [overrides]);
}

export function useShortcutKeys(id: ShortcutId): string[] | null {
  const binding = useShortcutBindings()[id];
  return binding ? bindingGlyphs(binding) : null;
}

/* ── 冲突判定 ──────────────────────────────────────────────────── */

/** 启用中的绑定按 key+shift 分组,≥2 者互列对方;停用行不参战。 */
export function conflictingShortcutIds(
  bindings: Readonly<Record<ShortcutId, ShortcutBinding | null>>,
): ReadonlyMap<ShortcutId, ShortcutId[]> {
  return shortcutConflicts(SHORTCUT_IDS, bindings);
}

/* ── 录制校验 ──────────────────────────────────────────────────────
 * q/w/r 按下去是退出、关窗、重载——绑上等于给用户一颗必炸的键。
 * m/h 与缩放三键是 Electron 隐式菜单的地盘。统一跨平台一张表:
 * macOS 下这些组合根本到不了 window keydown(菜单先吃),这道拦截
 * 主要防 Windows/Linux;录制中按 ⌘Q 仍会退出应用,无菜单手术不可避免。
 * ────────────────────────────────────────────────────────────── */
const RESERVED_SHORTCUT_KEYS: ReadonlySet<string> = new Set([
  "q",
  "w",
  "r",
  "m",
  "h",
  "+",
  "-",
  "=",
  "0",
]);

export function captureBinding(event: KeyboardEvent): CaptureResult {
  return captureShortcut(event, {
    reserved: (binding) => RESERVED_SHORTCUT_KEYS.has(binding.key),
  });
}

/**
 * 挂一个 window keydown,按表分派。表里有键但本次没给 handler 的,
 * continue 而非 return——同键多主(双 ⌘F)时,先到而无人处理的 id
 * 不许吞掉后到者;全都没人处理才落回系统,不 preventDefault。
 */
export function useGlobalShortcuts(
  handlers: Partial<Record<ShortcutId, () => void>>,
): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    settingsStore.ensureLoaded();
    const onKeyDown = createShortcutDispatcher({ ids: SHORTCUT_IDS,
      binding: id => resolveShortcut(id, liveOverrides()), handler: id => latest.current[id], modalScope: hasModalKeyboardScope });
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
