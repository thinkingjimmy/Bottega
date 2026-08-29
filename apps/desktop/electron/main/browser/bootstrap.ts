/**
 * [INPUT]: Depends on Electron WebContentsView/session, BrowserPanelService/CdpHarness, Chrome import, trusted IPC and main window
 * [OUTPUT]: Provides installing BrowserPanel Returns BrowserRuntime: view Factory, tool kernel, window registration and security shutdown
 * [POS]: The main/browser platform combination root; index only has one runtime, no Browser IPC, CDP or Chrome path details
 */

import { join } from "node:path";
import {
  BrowserWindow,
  WebContentsView,
  session,
  type Session,
} from "electron";
import {
  BROWSER_IMPORT_CHANNEL,
  importChromeCookiesSchema,
  previewCookieDomainsSchema,
} from "../../../shared/browser-import-ipc";
import { BROWSER_PARTITION } from "../../../shared/browser-ipc";
import { rendererIpc } from "../ipc-registrar";
import {
  BrowserPanelService,
  type BrowserViewPort,
  type BrowserWindowPort,
} from "./browser-service";
import { CdpHarness } from "./cdp-harness";
import {
  importChromeCookies,
  previewChromeCookieDomains,
} from "./chrome-import/cookies";
import {
  detectChromeProfiles,
  resolveChromeProfilePath,
} from "./chrome-import/profiles";
import {
  assertPlatformCapability,
  resolvePlatformCapabilities,
} from "../../../shared/platform-capabilities";

export type BrowserRuntime = ReturnType<typeof installBrowserPanel>;

export function installBrowserPanel(chromeRoot: string) {
  const browserSession = session.fromPartition(BROWSER_PARTITION);
  const service = new BrowserPanelService({
    createView: () =>
      new WebContentsView({
        webPreferences: {
          session: browserSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      }) as unknown as BrowserViewPort,
  });
  const harness = new CdpHarness(service);

  return {
    service,
    harness,
    register(window: BrowserWindow, rendererUrl: string) {
      service.register(window as unknown as BrowserWindowPort, rendererUrl);
      registerChromeImport(window, rendererUrl, chromeRoot, browserSession);
    },
    shutdown: () => service.shutdown(),
  };
}

function registerChromeImport(
  window: BrowserWindow,
  rendererUrl: string,
  chromeRoot: string,
  browserSession: Session
) {
  const support = resolvePlatformCapabilities(process.platform);
  const requireChromeImport = () =>
    assertPlatformCapability(support, "chromeImport");
  rendererIpc(window, rendererUrl, "拒绝非主窗口的浏览器导入请求")
    .roles("main")
    .handle(BROWSER_IMPORT_CHANNEL.availability, () => ({
      available: support.capabilities.chromeImport,
    }))
    .handle(BROWSER_IMPORT_CHANNEL.detectProfiles, () => {
      requireChromeImport();
      return detectChromeProfiles(chromeRoot);
    })
    .handle(BROWSER_IMPORT_CHANNEL.previewCookieDomains, (raw) => {
      requireChromeImport();
      const { profileDirectory } = previewCookieDomainsSchema.parse(raw);
      return previewChromeCookieDomains(
        resolveChromeProfilePath(chromeRoot, profileDirectory)
      );
    })
    .handle(BROWSER_IMPORT_CHANNEL.importCookies, (raw) => {
      requireChromeImport();
      const input = importChromeCookiesSchema.parse(raw);
      return importChromeCookies({
        profilePath: resolveChromeProfilePath(
          chromeRoot,
          input.profileDirectory
        ),
        domains: input.domains,
        cookieStore: browserSession.cookies,
      });
    });
}

export const defaultChromeRoot = (
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform
) => {
  const suffixes: Partial<Record<NodeJS.Platform, string[]>> = {
    darwin: ["Library", "Application Support", "Google", "Chrome"],
    win32: ["AppData", "Local", "Google", "Chrome", "User Data"],
    linux: [".config", "google-chrome"],
  };
  return join(homeDirectory, ...(suffixes[platform] ?? [".chrome-unavailable"]));
};
