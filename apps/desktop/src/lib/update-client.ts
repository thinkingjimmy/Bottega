/**
 * [INPUT]: Depends on shared update IPC and the preload-exposed window.update bridge
 * [OUTPUT]: Provides updateStore, appInfoStore, and never-rejecting update commands for renderer components
 * [POS]: The renderer's single update client; About and Sidebar share one subscription and one snapshot
 */

import type {
  AppInfo,
  UpdateBridgeApi,
  UpdateSnapshot,
} from "../../shared/update-ipc";

declare global {
  interface Window {
    update?: UpdateBridgeApi;
  }
}

/* 版本号只有 package.json 一个真相源，main 经 IPC 下发。这里绝不写字面量：
   写一次就多一份会在下次 bump 后静默说谎的副本，空串诚实表示"还不知道"。 */
const fallback: UpdateSnapshot = Object.freeze({
  phase: "idle",
  currentVersion: "",
  availableVersion: null,
  progress: null,
  checkedAt: null,
  error: null,
  lastError: null,
  automaticInstall: false,
});

type Listener = () => void;

class UpdateStore {
  private value = fallback;
  private readonly listeners = new Set<Listener>();
  private loaded = false;
  private unsubscribe: (() => void) | null = null;

  getSnapshot = () => this.value;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  ensureLoaded() {
    if (this.loaded || !window.update) return;
    this.loaded = true;
    this.unsubscribe = window.update.onChanged((snapshot) => this.publish(snapshot));
    void this.settle(window.update.snapshot());
  }

  check() {
    return window.update
      ? this.settle(window.update.check())
      : Promise.resolve(this.value);
  }

  downloadAndInstall() {
    return window.update
      ? this.settle(window.update.downloadAndInstall())
      : Promise.resolve(this.value);
  }

  /**
   * 命令一律不向调用方抛。用户可见状态的唯一真相源是 main 推来的快照——
   * 真实失败 main 已写成 `phase: "error"` 从订阅到达；能走到这里的拒绝只有
   * "当前状态不允许"（按钮渲染与 IPC 往返之间相位变了）。让它冒成
   * unhandledRejection 既不改变界面，也污染控制台。
   */
  private settle(command: Promise<UpdateSnapshot>) {
    return command.then(
      (snapshot) => {
        this.publish(snapshot);
        return snapshot;
      },
      () => this.value
    );
  }

  private publish(snapshot: UpdateSnapshot) {
    this.value = snapshot;
    for (const listener of this.listeners) listener();
  }
}

class AppInfoStore {
  private value: AppInfo | null = null;
  private flight: Promise<AppInfo | null> | null = null;
  private readonly listeners = new Set<Listener>();

  getSnapshot = () => this.value;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  ensureLoaded() {
    if (this.value || this.flight || !window.update) return;
    this.flight = window.update
      .appInfo()
      .then((value) => {
        this.value = value;
        for (const listener of this.listeners) listener();
        return value;
      })
      /* 无人 await 这条 flight：失败必须留在这里，不能冒成 unhandledRejection。
         About 已有 appInfo 缺席时的降级渲染（版本占位 + canonical LICENSE 链接）。 */
      .catch(() => null)
      .finally(() => {
        this.flight = null;
      });
  }
}

export const updateStore = new UpdateStore();
export const appInfoStore = new AppInfoStore();
export const RELEASE_URL = "https://github.com/thinkingjimmy/Bottega/releases/latest";
