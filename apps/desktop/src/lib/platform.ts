/**
 * [INPUT]: Depends on the navigator of the renderer (the user can use the browser to synchronize the hOSt OS with the user's browser, without IPC)
 * [OUTPUT]: Provides is ApplePlatform (mac/iOS) and keyboard layout (Mac vs Ctrl) and window decoration (Red Green Light vs Native Title) share the same quality
 * [POS]: The only true source of renderer platform differences; Previously, as a private function, it was stored in shortcuts.ts, where the window decoration was collected when Windows was adapted, avoiding two navigators that could determine drifting
 */

/* 不缓存：一次短字符串正则，调用频次是「渲染时每处一次」量级；缓存换来的
   是测试里 stub navigator 之后拿到上一次结果的陷阱。桌面端 Apple 即 macOS。 */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as { userAgentData?: { platform?: string } })
    .userAgentData;
  return /mac|iphone|ipad/i.test(data?.platform || navigator.userAgent);
}
