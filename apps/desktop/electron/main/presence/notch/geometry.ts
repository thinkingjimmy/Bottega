/**
 * [INPUT]: Depends on AppKit screen bounds, visible frames, notch safe sides, and fullscreen/inactive-session facts.
 * [OUTPUT]: Provides menu-bar-centered geometry with flush notch wings and a separate list below the safe area.
 * [POS]: Pure geometry policy between the native helper and panel controller.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type NativeScreen = { id: number; builtin: boolean; primary: boolean; bounds: Rect; visible: Rect;
  topInset: number; left: Rect; right: Rect; fullscreen: boolean; inactive?: boolean };
export function panelGeometry(screens: readonly NativeScreen[]) {
  const screen = screens.find((screen) => screen.builtin && screen.topInset > 0) ?? screens.find((screen) => screen.primary);
  if (!screen || screen.bounds.width < 360 || screen.bounds.height < 240) return null;
  const hasNotch = screen.topInset > 0 && screen.left.width >= 144 && screen.right.width >= 144;
  const menuHeight = Math.max(24, Math.min(32, screen.visible.y - screen.bounds.y));
  const collapsed = hasNotch ? [
    { x: screen.left.x + screen.left.width - 144, y: screen.left.y, width: 144, height: screen.topInset },
    { x: screen.right.x, y: screen.right.y, width: 144, height: screen.topInset },
  ] : [{ x: Math.round(screen.bounds.x + (screen.bounds.width - 296) / 2), y: screen.bounds.y, width: 296, height: menuHeight }];
  const width = Math.min(520, screen.bounds.width - 32);
  // The list stays below both the menu bar and the compact strip, including auto-hidden menu bars.
  const y = Math.max(screen.visible.y, ...collapsed.map((rect) => rect.y + rect.height));
  const expanded = { x: Math.round(screen.bounds.x + (screen.bounds.width - width) / 2), y: Math.round(y + 8), width,
    height: Math.min(472, Math.floor(screen.visible.y + screen.visible.height - y - 16)) };
  return { screenId: screen.id, hidden: screen.fullscreen || Boolean(screen.inactive), expanded, collapsed };
}
