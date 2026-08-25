/**
 * [INPUT]: Depends on node: crypto and Electron WebContents' navigation/destruction events
 * [OUTPUT]: Provides RendererIdentity, `bindRendererIdentity`, `rendererIdentity` and `onRendererRotated`The only "what renderer session" on the main page is the "what renderer session" rule
 * [POS]: The window module's session ID is unlocked; The surface/management lease is suspended above it, navigation or reloading means the entire batch is invalid
 */

import { randomUUID } from "node:crypto";

export type RendererIdentity = Readonly<{
  webContentsId: number;
  /** 每次导航/重载都换一把；main 重启后全新 */
  rendererSessionId: string;
}>;

/** 只取本模块需要的那几个事件；注入边界让轮换语义可在纯 Node 中验证。 */
export type RendererIdentitySource = {
  id: number;
  on(
    event: "did-start-navigation" | "destroyed",
    listener: (...args: unknown[]) => void
  ): unknown;
};

type NavigationDetails = { isMainFrame?: boolean; isSameDocument?: boolean };

const sessions = new Map<number, string>();
const rotationListeners = new Set<(previous: RendererIdentity) => void>();

/**
 * 绑定一次即可。轮换的判据是「主帧发生了一次真实导航」——同文档 hash 变化不算，
 * 否则一次锚点跳转就会把用户手里的 surface lease 全部作废。
 */
export function bindRendererIdentity(contents: RendererIdentitySource) {
  if (sessions.has(contents.id)) return;
  sessions.set(contents.id, randomUUID());
  contents.on("did-start-navigation", (...args: unknown[]) => {
    const details = (args.at(-1) ?? {}) as NavigationDetails;
    if (details.isMainFrame === false || details.isSameDocument === true) return;
    rotate(contents.id);
  });
  contents.on("destroyed", () => {
    rotate(contents.id);
    sessions.delete(contents.id);
  });
}

/**
 * 未绑定的 webContents 也必须拿到一个**确定**的 id：返回一个随机值而不是空串，
 * 让「没绑定」表现为「谁也匹配不上」，而不是「所有人都匹配」。
 */
export function rendererIdentity(webContentsId: number): RendererIdentity {
  const rendererSessionId = sessions.get(webContentsId);
  return rendererSessionId
    ? { webContentsId, rendererSessionId }
    : { webContentsId, rendererSessionId: `unbound-${randomUUID()}` };
}

/** 订阅轮换：拿到的是**旧**身份，撤销要按它做，而不是按当前值。 */
export function onRendererRotated(
  listener: (previous: RendererIdentity) => void
) {
  rotationListeners.add(listener);
  return () => rotationListeners.delete(listener);
}

function rotate(webContentsId: number) {
  const previous = sessions.get(webContentsId);
  if (!previous) return;
  sessions.set(webContentsId, randomUUID());
  for (const listener of rotationListeners) {
    listener({ webContentsId, rendererSessionId: previous });
  }
}

/** 测试与主进程重启之间共用的复位点；生产只在窗口销毁时被动收敛。 */
export function resetRendererIdentities() {
  sessions.clear();
  rotationListeners.clear();
}
