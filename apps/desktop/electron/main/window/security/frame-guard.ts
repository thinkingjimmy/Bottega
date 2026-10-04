/**
 * [INPUT]: Depends on the URL standard library and the type of Electron WebFrameMain
 * [OUTPUT]: Provides devRendererUrl (the only reader of ELECTRON_RENDERER_URL: honoured in an unpackaged run only), urlMatchesRenderer (string determination) and rendererMatches (host determination)
 * [POS]: apps/desktop/electron/main/window/security; The only source to protect the identity of the rendering process of Electron main, IPC shared with the Navigation Security Baseline
 */

import type { WebFrameMain } from "electron";

/**
 * The dev server a development run loads the renderer from. A packaged build always loads its bundled files, whatever the
 * environment says: otherwise any local process that launches Bottega with ELECTRON_RENDERER_URL could point the privileged
 * renderer, preload bridge included, at an arbitrary URL (F-15). This is the only place that variable is read.
 */
export function devRendererUrl(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return isPackaged ? undefined : env.ELECTRON_RENDERER_URL || undefined;
}

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
