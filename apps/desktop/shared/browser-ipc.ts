/**
 * [INPUT]: Depends on zod; Receive the browser tabs, navigation, viewpoints, visibility and stop batch requests of the renderer
 * [OUTPUT]: Provides Browser IPC channel, https://www.pcc.org/URL/request schema, tab Projects with BrowserBridgeApi
 * [POS]: The user can access the server's server and the server's serverMain holds tabs Truth, the renderer only consumes projections
 */

import { z } from "zod";

export const BROWSER_PARTITION = "persist:agent-browser";
export const BROWSER_DEFAULT_URL = "https://www.google.com/";
export const BROWSER_TAB_LIMIT = 10;

export const browserTabIdSchema = z.string().regex(/^browser-[A-Za-z0-9_-]{8,80}$/);

export const browserUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "浏览器只允许 http(s) 地址");

export const browserCreateTabSchema = z
  .object({ url: browserUrlSchema.optional() })
  .strict();
export const browserTabRequestSchema = z
  .object({ tabId: browserTabIdSchema })
  .strict();
export const browserNavigateSchema = z
  .object({ tabId: browserTabIdSchema, url: browserUrlSchema })
  .strict();
export const browserViewportSchema = z
  .object({
    x: z.number().finite().min(0),
    y: z.number().finite().min(0),
    width: z.number().finite().min(0),
    height: z.number().finite().min(0),
  })
  .strict();
export const browserVisibleSchema = z
  .object({ visible: z.boolean() })
  .strict();

export type BrowserViewport = z.infer<typeof browserViewportSchema>;

export type BrowserTabProjection = {
  tabId: string;
  ownerChatId: string | null;
  url: string;
  title: string;
  faviconUrl?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  agentActive: boolean;
  agentAction?: string;
};

export type BrowserTabsSnapshot = {
  tabs: BrowserTabProjection[];
  /** 仅面板可见时存在，表达用户此刻正在看的网页。 */
  activeTabId: string | null;
  /** 面板隐藏后仍保留选择，用于再次显示时恢复同一 tab。 */
  selectedTabId: string | null;
  /** 仅 createTab 那一次投影携带新 tab id；renderer 据此判定「新 tab 出现」，不必自建已知集合。 */
  createdTabId: string | null;
};

export const BROWSER_CHANNEL = {
  createTab: "browser:create-tab",
  closeTab: "browser:close-tab",
  activateTab: "browser:activate-tab",
  navigate: "browser:navigate",
  goBack: "browser:go-back",
  goForward: "browser:go-forward",
  reload: "browser:reload",
  setViewport: "browser:set-viewport",
  setVisible: "browser:set-visible",
  stopAgentBatch: "browser:stop-agent-batch",
  tabsChanged: "browser:tabs-changed",
} as const;

export type BrowserBridgeApi = {
  createTab(input?: { url?: string }): Promise<BrowserTabProjection>;
  closeTab(input: { tabId: string }): Promise<BrowserTabsSnapshot>;
  activateTab(input: { tabId: string }): Promise<BrowserTabsSnapshot>;
  navigate(input: { tabId: string; url: string }): Promise<BrowserTabProjection>;
  goBack(input: { tabId: string }): Promise<void>;
  goForward(input: { tabId: string }): Promise<void>;
  reload(input: { tabId: string }): Promise<void>;
  setViewport(input: BrowserViewport): Promise<void>;
  setVisible(input: { visible: boolean }): Promise<BrowserTabsSnapshot>;
  stopAgentBatch(input: { tabId: string }): Promise<boolean>;
  onTabsChanged(callback: (snapshot: BrowserTabsSnapshot) => void): () => void;
};

/** 地址栏只补全裸域名；显式危险 scheme 不做猜测。 */
export function normalizeBrowserUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    ? value
    : `https://${value}`;
  const parsed = browserUrlSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
