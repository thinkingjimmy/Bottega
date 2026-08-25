/**
 * [INPUT]: Depends on the URL standard library and the type of Electron WebFrameMain
 * [OUTPUT]: Provides urlMatchesRenderer (string determination) and rendererMatches (host determination)
 * [POS]: The only source to protect the identity of the rendering process of Electron main, IPC shared with the Navigation Security Baseline
 */

import type { WebFrameMain } from "electron";

/** URL 是否与渲染入口同源；file: 协议按 pathname 精确比对。 */
export function urlMatchesRenderer(value: string, rendererUrl: string) {
  try {
    const actual = new URL(value);
    const expected = new URL(rendererUrl);
    if (expected.protocol === "file:") {
      return actual.protocol === "file:" && actual.pathname === expected.pathname;
    }
    return actual.origin === expected.origin;
  } catch {
    return false;
  }
}

/** 帧必须是顶层主帧且 URL 匹配渲染入口，任一不满足即拒绝。 */
export function rendererMatches(
  frame: WebFrameMain | null,
  rendererUrl: string
) {
  if (!frame || frame !== frame.top) return false;
  return urlMatchesRenderer(frame.url, rendererUrl);
}
