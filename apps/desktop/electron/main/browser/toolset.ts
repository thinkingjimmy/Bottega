/**
 * [INPUT]: Depends on BrowserPanelService/CdpHarness, the shared BrowserAction and builtin-tool domain specs, the BuiltinToolset contract, and the main error vocabulary (statusError)
 * [OUTPUT]: Provides canAccess and createBrowserToolset; read/write tab authorization is decided once per call from the lease chat (own tabs; the person's tab only while the person selected it and it shows; never another Chat's, E3-01), and browser_tabs reports which tabs are sleeping
 * [POS]: The only adapter between the browser domain and the builtin-tool platform; handlers never trust renderer identity or an Agent-claimed owner
 */

import {
  BUILTIN_TOOL_DOMAINS,
  type BrowserAction,
} from "../../../shared/builtin-tools";
import { statusError } from "../ipc/errors";
import type { BuiltinToolset } from "../tools/registry";
import { BrowserPanelService } from "./browser-service";
import { CdpHarness } from "./cdp-harness";

type BrowserAccessTab = {
  tabId: string;
  ownerChatId: string | null;
};

/**
 * E3-01 (Jimmy, 2026-09-26): a Chat reads and writes its own tabs; it reads the person's tab only while the person has selected it
 * themselves and it is showing (`personTabId`); another Chat's tab is never readable. Writes stay with the owning Chat.
 */
export function canAccess(
  tab: BrowserAccessTab,
  leaseChatId: string,
  personTabId: string | null,
  mode: "read" | "write"
) {
  if (tab.ownerChatId === leaseChatId) return true;
  return mode === "read" && tab.ownerChatId === null && tab.tabId === personTabId;
}

/** 工具结果信封（tab_id/url/title/JSON 结构）的预留；url/title 另有截断上限兜底。 */
const RESULT_ENVELOPE_BYTES = 4_096;
const wireUrl = (url: string) => url.slice(0, 2_048);
const wireTitle = (title: string) => title.slice(0, 512);

export function createBrowserToolset(
  browser: BrowserPanelService,
  harness: CdpHarness
): BuiltinToolset {
  const wireBudget = (leaseBudget: number) =>
    Math.min(
      BUILTIN_TOOL_DOMAINS.browser.logicalResultByteLimit,
      leaseBudget
    ) - RESULT_ENVELOPE_BYTES;
  const requireAccess = (
    tabId: string,
    chatId: string,
    mode: "read" | "write"
  ) => {
    const tab = browser.requireTab(tabId);
    if (!canAccess(tab, chatId, browser.personReadableTabId, mode)) {
      throw statusError(
        403,
        mode === "write"
          ? "该 tab 非本会话所有，不能操作；请用 browser_open 以同一 URL 重开后再操作"
          : tab.ownerChatId !== null
            ? "该 tab 属于另一个 Section，不能在这里读取；需要时用 browser_open 自己打开页面。"
            : "该 tab 由用户打开；只有用户亲自在 Browser 面板中选中并显示它时才能读取。可以请用户点选它，或用 browser_open 自己打开页面。"
      );
    }
    return tab;
  };
  return {
    browser_open: async (args, context) => {
      const tab = await browser.createTab({
        url: args.url as string,
        ownerChatId: context.lease.chatId,
      });
      return {
        tab_id: tab.tabId,
        url: wireUrl(tab.url),
        title: wireTitle(tab.title),
        snapshot: await harness.snapshot(
          tab.tabId,
          wireBudget(context.lease.resultByteBudget)
        ),
      };
    },
    browser_snapshot: async (args, context) => {
      const tabId = args.tab_id as string;
      const tab = requireAccess(tabId, context.lease.chatId, "read");
      return {
        tab_id: tabId,
        url: wireUrl(tab.url),
        title: wireTitle(tab.title),
        snapshot: await harness.snapshot(
          tabId,
          wireBudget(context.lease.resultByteBudget)
        ),
      };
    },
    browser_act: async (args, context) => {
      const tabId = args.tab_id as string;
      requireAccess(tabId, context.lease.chatId, "write");
      return harness.act(
        tabId,
        args.actions as BrowserAction[],
        context.signal,
        wireBudget(context.lease.resultByteBudget)
      );
    },
    browser_tabs: (args, context) => {
      void args;
      return browser
        .snapshot()
        .tabs.filter((tab) =>
          canAccess(tab, context.lease.chatId, browser.personReadableTabId, "read")
        )
        .map((tab) => ({
          tab_id: tab.tabId,
          url: wireUrl(tab.url),
          title: wireTitle(tab.title),
          owned: tab.ownerChatId === context.lease.chatId,
          sleeping: tab.sleeping,
        }));
    },
    browser_close: (args, context) => {
      const tabId = args.tab_id as string;
      requireAccess(tabId, context.lease.chatId, "write");
      harness.detach(tabId);
      browser.closeTab(tabId);
      return { closed: true, tab_id: tabId };
    },
  };
}
