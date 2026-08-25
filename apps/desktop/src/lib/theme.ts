/**
 * [INPUT]: Depends on settings-client valid subject prefix/subscription ((Electron go main broadcast, browser return system preferences) with documentElement classList
 * [OUTPUT]: Provides ResolvedTheme, applyResolvedTheme, resolvedThemeStore and initializeTheme
 * [POS]: The renderer's valid theme landing point; Preference is given to the main, which only receives the bulb and hangs it `.dark`Not auto, decided
 */

import { initialDarkTheme, subscribeResolvedTheme } from "./settings-client";

export type ResolvedTheme = "light" | "dark";

type ThemeRoot = Pick<HTMLElement, "classList">;

let resolved: ResolvedTheme = "light";
const listeners = new Set<() => void>();

export function applyResolvedTheme(
  theme: ResolvedTheme,
  root: ThemeRoot = document.documentElement
) {
  root.classList.toggle("dark", theme === "dark");
}

/* ============================================================
 * 与 lib/settings-store 同款：只导出 store 不导出 hook，lib/ 保持
 * React-free，消费方自行 useSyncExternalStore。类的开合由 initializeTheme
 * 的常驻订阅负责，组件挂没挂载都不影响。
 * ============================================================ */
export const resolvedThemeStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): ResolvedTheme => resolved,
};

/* 初值必须同步可读：它随建窗参数到达 preload，故首帧就是对的。
   此后的每一次变化——用户切档、或 auto 档下系统外观变了——都由
   main 解析成同一个布尔广播下来，这里永远只做一件事。 */
export function initializeTheme(
  initialDark: boolean = initialDarkTheme(),
  subscribe: (
    callback: (isDark: boolean) => void
  ) => () => void = subscribeResolvedTheme,
  root?: ThemeRoot
) {
  const commit = (isDark: boolean) => {
    resolved = isDark ? "dark" : "light";
    applyResolvedTheme(resolved, root);
    for (const listener of listeners) listener();
  };
  commit(initialDark);
  return subscribe(commit);
}
