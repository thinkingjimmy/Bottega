/**
 * [INPUT]: Depends on the renderer's navigator/userAgentData APIs only; no IPC
 * [OUTPUT]: Provides isApplePlatform (mac/iOS detection), the single check that keyboard-shortcut labels (Cmd vs Ctrl) and window-decoration choice (traffic lights vs native title bar) both key off of
 * [POS]: Sole source of truth for renderer platform differences; used by lib/shortcuts and the sidebar/page-shell chrome so they never compute platform independently
 */

/* 不缓存：一次短字符串正则，调用频次是「渲染时每处一次」量级；缓存换来的
   是测试里 stub navigator 之后拿到上一次结果的陷阱。桌面端 Apple 即 macOS。 */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as { userAgentData?: { platform?: string } })
    .userAgentData;
  return /mac|iphone|ipad/i.test(data?.platform || navigator.userAgent);
}
