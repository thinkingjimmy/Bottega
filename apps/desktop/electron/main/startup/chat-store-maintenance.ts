/**
 * [INPUT]: Depends on the ChatStore queued maintenance gate and its warning channel
 * [OUTPUT]: Provides start/stop for the periodic chat-store invariant gate: once ~60 s after the window is ready, then every 6 h, on unref'd timers
 * [POS]: The only production caller of the maintenance gate; the composition root owns when it starts and the shutdown chain owns when it stops
 */

import type { ChatStore } from "../chats/chat-store";
import { asError } from "../errors";

/* ── 不变量闸门必须真的在产品里跑过 ──────────────────────────────
 * 它此前只有 benchmark 一个调用者，于是「账本自洽」这句话从未在用户机器
 * 上被验证过一次。首次延后到窗口就绪之后 60 秒——启动那一段的磁盘与 CPU
 * 属于第一屏；此后每 6 小时一次。两个定时器都 unref：它们不该把进程从
 * 退出边缘拽回来。失败走既有 warning 通道，不弹窗、不阻断。
 * ────────────────────────────────────────────────────────── */
const FIRST_DELAY_MS = 60_000;
const INTERVAL_MS = 6 * 60 * 60_000;

const stops: Array<() => void> = [];

export function startChatStoreMaintenance(store: ChatStore) {
  const run = async () => {
    try {
      const report = await store.runMaintenance();
      if (report.integrity !== "ok" || report.domainInvariants !== "ok") {
        throw new Error(
          `integrity=${report.integrity} invariants=${report.domainInvariants}`
        );
      }
    } catch (cause) {
      const error = asError(cause);
      console.error("[chats] maintenance gate failed", error);
      store.pushWarning(`聊天账本自检未通过：${error.message}`);
    }
  };
  const first = setTimeout(() => {
    void run();
    const repeating = setInterval(() => void run(), INTERVAL_MS);
    repeating.unref();
    stops.push(() => clearInterval(repeating));
  }, FIRST_DELAY_MS);
  first.unref();
  stops.push(() => clearTimeout(first));
}

export function stopChatStoreMaintenance() {
  for (const stop of stops.splice(0)) stop();
}
