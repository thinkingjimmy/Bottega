/**
 * [INPUT]: Depends on BrowserPanelService/CdpHarness, shared browser action and builtin tool context
 * [OUTPUT]: Provides canAccess with createBrowserToolset, and performs the read-write authorization tab by lease chat in a single point
 * [POS]: The only layer of adaptation of the browser domain to the built-in tool platform; The handler does not accept the renderer identity or the Agent self-identification owner
 */

import {
  BUILTIN_TOOL_DOMAINS,
  type BrowserAction,
} from "../../../shared/builtin-tools";
import type { BuiltinToolset } from "../tools/registry";
import { BrowserPanelService } from "./browser-service";
import { CdpHarness } from "./cdp-harness";

export type BrowserAccessTab = {
  tabId: string;
  ownerChatId: string | null;
};

export function canAccess(
  tab: BrowserAccessTab,
  leaseChatId: string,
  activeTabId: string | null,
  mode: "read" | "write"
) {
  if (tab.ownerChatId === leaseChatId) return true;
  return mode === "read" && tab.tabId === activeTabId;
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
    if (!canAccess(tab, chatId, browser.activeTabId, mode)) {
      throw statusError(
        403,
        mode === "write"
          ? "该 tab 非本会话所有，不能操作；请用 browser_open 以同一 URL 重开后再操作"
          : "当前会话不能读取该 tab；请让用户先在第三栏显示它，或用 browser_open 重开"
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
          canAccess(tab, context.lease.chatId, browser.activeTabId, "read")
        )
        .map((tab) => ({
          tab_id: tab.tabId,
          url: wireUrl(tab.url),
          title: wireTitle(tab.title),
          owned: tab.ownerChatId === context.lease.chatId,
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

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
