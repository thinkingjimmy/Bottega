/**
 * [INPUT]: Depends on React, preload Exposed window.browser and shared BrowserBridgeApi/tab projections
 * [OUTPUT]: Provides use of BrowserTabs and BrowserTabsController: only snapshot subscription, explicitly synchronized with unified error packing tab action
 * [POS]: The tab status of the chat/browser page is entered; PanelTabs uses it to draw tabs, BrowserPanel uses it to draw navigation, and both share the same projection
 */

import { useEffect, useState } from "react";
import type {
  BrowserBridgeApi,
  BrowserTabsSnapshot,
} from "../../../../shared/browser-ipc";

declare global {
  interface Window {
    browser?: BrowserBridgeApi;
  }
}

const EMPTY: BrowserTabsSnapshot = {
  tabs: [],
  activeTabId: null,
  selectedTabId: null,
  createdTabId: null,
};

export type BrowserTabsController = {
  /** 缺席即非桌面环境；调用方据此降级，而不是各自去摸 window。 */
  bridge: BrowserBridgeApi | undefined;
  snapshot: BrowserTabsSnapshot;
  busy: boolean;
  error: string;
  clearError: () => void;
  /** 包装任意 bridge 调用的 busy/错误归一；导航、停止等由调用方自带语义的动作走它。 */
  run: (task: () => Promise<unknown>) => Promise<void>;
  createTab: (url?: string) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
};

/* ── 为何 snapshot 归 hook 而非组件 ────────────────────────────────
 * 网页 tab 与 Base/Subagents 同住顶部一条 tablist，于是 tab 条（PanelTabs）
 * 和导航栏（BrowserPanel）都要读同一份投影。若各订阅一次，就有两份可能
 * 不同步的真相，且 setVisible 会被调用两遍——显隐是授权语义，重复即危险。
 * 订阅收进这里，上面挂一次，下面只消费。
 * ─────────────────────────────────────────────────────────── */
export function useBrowserTabs(visible: boolean): BrowserTabsController {
  const bridge = window.browser;
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bridge) return;
    return bridge.onTabsChanged(setSnapshot);
  }, [bridge]);

  // onTabsChanged 是纯推送，没有初始拉取：首帧的 tab 条靠 setVisible 的返回值
  // 播种。卸载时必须落回不可见——main 的 activeTabId 是 Agent 读取非自有 tab
  // 的唯一凭据，面板一走，那份可见性授权就得同时收回。
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge
      .setVisible({ visible })
      .then((next) => {
        if (live) setSnapshot(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (visible) void bridge.setVisible({ visible: false });
    };
  }, [bridge, visible]);

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "浏览器操作失败");
    } finally {
      setBusy(false);
    }
  };

  return {
    bridge,
    snapshot,
    busy,
    error,
    clearError: () => setError(""),
    run,
    // createTab 在 main 侧即完成选中与投影，无需追加 activateTab。
    createTab: (url) =>
      void run(async () => {
        await bridge?.createTab(url ? { url } : undefined);
      }),
    activateTab: (tabId) =>
      void run(async () => {
        await bridge?.activateTab({ tabId });
      }),
    closeTab: (tabId) =>
      void run(async () => {
        await bridge?.closeTab({ tabId });
      }),
  };
}
