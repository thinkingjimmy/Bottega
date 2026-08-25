/**
 * [INPUT]: Free, pure function
 * [OUTPUT]: Provides SETTINGS_ROUTE_PREFIX/MEMORY_SETTINGS_PATH, with SettingsOverlaySection/SettingsDestination (overlay ranks include General/Shortcuts/Backends/Personalization/Browser/Tools/Skills/Extensions/Usage/Archive), settingsExitTarget and settingsRouteSection/activeSettingsSection
 * [POS]: The renderer sets the only parameter for "stay" and "high brightness"; main.tsx navigate only by conclusion, sidebar only by conclusion than a value
 */

export const SETTINGS_ROUTE_PREFIX = "/settings/";

/* 设置的两条真实路由：常量与判据同住一处，路由的事只有这一个知情人。 */
export const MEMORY_SETTINGS_PATH = "/settings/memory";
export const ARCHIVE_SETTINGS_PATH = "/settings/archive";
export const TOOLS_SETTINGS_PATH = "/settings/tools";
/* Skill 仓库与 Agent Plugins 曾各占一条路由。它们共享全部状态（同一份
   snapshot、同一套 IPC、同一张卡片），拆开的唯一依据是「包里装了什么」
   ——而那正是安装之前谁也答不上的问题。合成 /settings/extensions 一条。 */
export const EXTENSIONS_SETTINGS_PATH = "/settings/extensions";

/** 覆盖层能承载的档位：盖在当前路由之上，关掉即回到原地。 */
export type SettingsOverlaySection =
  | "general"
  | "shortcuts"
  | "backends"
  | "personalization"
  | "browser"
  | "tools"
  | "skills"
  | "extensions"
  | "usage"
  | "archive";

/** 设置的全部目的地：覆盖层七档 + 走真实路由的 Memory。 */
export type SettingsDestination = SettingsOverlaySection | "memory";

/* ============================================================
 * 「我在设置里吗」有两份真相：覆盖层的 settingsSection，以及路由。
 * 覆盖层盖在当前路由之上，关掉即回到原地，无需导航（null）。
 * 而路由把你原来站的位置换掉了，出去就得按历史退回去（-1）。
 *
 * 这个差异曾整个缺席：Memory 升为真实路由之后，「Back to app」仍只
 * 清覆盖层——而那一刻它本就是 null，于是按下去什么也不会发生。
 * 出口不完整比出口难看糟糕得多：用户会以为应用卡死了。
 *
 * location.key 仍是初始值，说明这一条就是历史的第一格（深链、引导
 * 跳转直接落在设置上），没有「原来」可退，才回落到首页。
 * ============================================================ */

export function settingsExitTarget(
  pathname: string,
  locationKey: string
): "/" | -1 | null {
  if (!pathname.startsWith(SETTINGS_ROUTE_PREFIX)) return null;
  return locationKey === "default" ? "/" : -1;
}

/** 路由这一侧的真相：这条路径本身站在哪一档设置上。 */
export function settingsRouteSection(
  pathname: string
): SettingsDestination | null {
  if (pathname === MEMORY_SETTINGS_PATH) return "memory";
  if (pathname === ARCHIVE_SETTINGS_PATH) return "archive";
  if (pathname === TOOLS_SETTINGS_PATH) return "tools";
  if (pathname === EXTENSIONS_SETTINGS_PATH) return "extensions";
  return null;
}

/* ============================================================
 * 「我此刻在哪一档」曾也有两份真相，且能同时为真：点过 Memory 之后
 * 再点 General，覆盖层换了而路由仍停在 /settings/memory，于是侧栏
 * 同时点亮两档——Memory 看起来永远激活。
 *
 * 折成一个值之后，「同时亮两档」在类型上就说不出来了：覆盖层盖在
 * 路由之上，谁在上面谁就是当前档。侧栏因此不必知道哪一档走路由、
 * 哪一档走覆盖层，五个档位一律只比这一个值。
 * ============================================================ */

export function activeSettingsSection(
  overlay: SettingsOverlaySection | null,
  pathname: string
): SettingsDestination | null {
  return overlay ?? settingsRouteSection(pathname);
}
