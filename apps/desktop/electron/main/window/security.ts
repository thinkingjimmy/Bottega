/**
 * [INPUT]: Depends on Electron BrowserWindow/session/frame API, shared i18n, Apps origin Whitelist and renderer URLs protected
 * [OUTPUT]: Provides navigation locks, WebRTC exit blocks, minimum authorization policies and ReactGrab entry in base-gui, double-double zero exceptions), https is the only external link to the output
 * [POS]: The main/window browsing context security boundaries; Business entrance shall not be allowed to free up navigation or authorization on its own
 */

import {
  dialog,
  session,
  shell,
  webFrameMain,
  type BrowserWindow,
  type WebFrameMain,
} from "electron";
import type { AppsService } from "../apps/apps-service";
import { urlMatchesRenderer } from "../frame-guard";
import type { AppLocale } from "../../../shared/i18n/locale";
import { translate } from "../../../shared/i18n/runtime";

const TRUSTED_EXTERNAL_HOSTS = new Set(["github.com", "learn.chatgpt.com"]);
const iframeOrigins = new WeakMap<WebFrameMain, string>();

function isAllowedAppOrigin(apps: AppsService, value: string) {
  try {
    return apps.isAllowedOrigin(new URL(value).origin);
  } catch {
    return false;
  }
}

// base-gui 是 Agent 写的页面：产品权能（ReactGrab 注入）一律不进，
// 与 gateway 侧「HTML 不注入」构成同一不变量的两半——注入经 executeJavaScript
// 走 main，不受页面 CSP 约束，漏掉这半边等于白设。
function isBaseGuiFrameUrl(apps: AppsService, value: string) {
  try {
    return apps.isBaseGuiOrigin(new URL(value).origin);
  } catch {
    return false;
  }
}

function inheritedIframeOrigin(frame: WebFrameMain) {
  let ancestor = frame.parent;
  while (ancestor && ancestor !== ancestor.top) {
    const origin = iframeOrigins.get(ancestor);
    if (origin) return origin;
    ancestor = ancestor.parent;
  }
  return undefined;
}

export function lockNavigation(
  window: BrowserWindow,
  rendererUrl: string,
  apps: AppsService,
  locale: () => AppLocale = () => "en"
) {
  // base-gui 是 Agent 写的代码，CSP 的 connect-src 管不到 WebRTC 数据通道
  // （Chromium 150 不认 CSP3 `webrtc 'block'`，实测见 dev/base-gui-csp-probe.cjs）。
  // 收紧到 disable_non_proxied_udp 后 ICE 候选实测清零；产品 renderer 本就不用 WebRTC。
  window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  window.webContents.on("will-navigate", (event) => {
    if (!urlMatchesRenderer(event.url, rendererUrl)) event.preventDefault();
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) {
      if (!urlMatchesRenderer(event.url, rendererUrl)) event.preventDefault();
      return;
    }
    const nextOrigin = (() => {
      try {
        return new URL(event.url).origin;
      } catch {
        return "";
      }
    })();
    if (!event.frame || !isAllowedAppOrigin(apps, nextOrigin)) {
      event.preventDefault();
      return;
    }
    const fixedOrigin =
      iframeOrigins.get(event.frame) ?? inheritedIframeOrigin(event.frame);
    if (fixedOrigin && fixedOrigin !== nextOrigin) {
      event.preventDefault();
      return;
    }
    iframeOrigins.set(event.frame, fixedOrigin ?? nextOrigin);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(window, url, locale()).catch((error) =>
      console.warn("[external] window.open 被拒绝", error)
    );
    return { action: "deny" };
  });
  window.webContents.on(
    "did-frame-navigate",
    (
      _event,
      url,
      _httpResponseCode,
      _httpStatusText,
      isMain,
      frameProcessId,
      frameRoutingId
    ) => {
      if (isMain || !isAllowedAppOrigin(apps, url)) return;
      if (isBaseGuiFrameUrl(apps, url)) return;
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      const injection = frame && apps.getReactGrabInjection();
      if (!frame || !injection) return;
      void frame
        .executeJavaScript(injection)
        .catch((error) =>
          console.warn("[apps] react-grab injection failed", error)
        );
    }
  );
}

export function configurePermissions(apps: AppsService) {
  // 例外只给 web 型 App；base-gui 全权限拒绝，不继承任何既有放宽
  const isClipboardException = (permission: string, origin: string) =>
    permission === "clipboard-sanitized-write" &&
    isAllowedAppOrigin(apps, origin) &&
    !apps.isBaseGuiOrigin(origin);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(isClipboardException(permission, details.requestingUrl));
    }
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) =>
      isClipboardException(permission, requestingOrigin)
  );
}

export async function openExternalSafely(
  window: BrowserWindow,
  rawUrl: string,
  locale: AppLocale = "en"
) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("只允许打开 HTTPS 外链");
  if (!TRUSTED_EXTERNAL_HOSTS.has(url.hostname)) {
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: [
        translate(locale, "common.cancel"),
        translate(locale, "common.continue"),
      ],
      defaultId: 0,
      cancelId: 0,
      title: translate(locale, "settings.native.externalLinkTitle"),
      message: translate(locale, "settings.native.externalLinkMessage"),
      detail: url.href,
    });
    if (result.response !== 1) return;
  }
  await shell.openExternal(url.href);
}
