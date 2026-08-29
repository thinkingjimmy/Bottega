/**
 * [INPUT]: Depends on standard JavaScript property descriptors and Electron's serializable main-world execution contract
 * [OUTPUT]: Provides immutable WebRTC denial plus fail-closed preload initialization and the main-frame product-bridge decision
 * [POS]: Main/window WebRTC security kernel executed by the one product preload in every root, OOPIF, and srcdoc frame
 */

export const RTC_LOCKDOWN_GLOBALS = Object.freeze([
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "RTCDataChannel",
  "RTCIceCandidate",
  "RTCSessionDescription",
]);

/** This arrow is serialized into a frame's main world. Keep it closure-free. */
export const lockRtcGlobals = (globalNames: readonly string[]) => {
  for (const name of globalNames) {
    try {
      Object.defineProperty(globalThis, name, {
        configurable: false,
        get() {
          throw new DOMException("WebRTC is disabled", "SecurityError");
        },
        set() {
          throw new DOMException("WebRTC is disabled", "SecurityError");
        },
      });
    } catch {
      // 同一 document 重复安装时描述符已不可配置，下面统一验证其拒绝语义。
    }
  }
  return globalNames.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (
      descriptor?.configurable !== false ||
      typeof descriptor.get !== "function" ||
      typeof descriptor.set !== "function"
    ) {
      return false;
    }
    try {
      descriptor.get.call(globalThis);
      return false;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "SecurityError") {
        return false;
      }
    }
    try {
      descriptor.set.call(globalThis, undefined);
      return false;
    } catch (error) {
      return error instanceof DOMException && error.name === "SecurityError";
    }
  });
};

export const RTC_LOCKDOWN_SOURCE = `(${lockRtcGlobals.toString()})(${JSON.stringify(RTC_LOCKDOWN_GLOBALS)});`;

export type RtcMainWorldExecutor = (script: {
  func: typeof lockRtcGlobals;
  args: [readonly string[]];
}) => unknown;

export function initializePreloadFrame(
  execute: RtcMainWorldExecutor,
  isMainFrame: boolean,
  failClosed: (error: unknown) => never
) {
  try {
    if (
      execute({ func: lockRtcGlobals, args: [RTC_LOCKDOWN_GLOBALS] }) !== true
    ) {
      throw new Error("WebRTC main-world lockdown was not installed");
    }
    return isMainFrame;
  } catch (error) {
    return failClosed(error);
  }
}
