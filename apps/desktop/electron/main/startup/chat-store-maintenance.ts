/**
 * [INPUT]: Depends on the ChatStore queued maintenance gate, the shared Chat-storage failure taxonomy, and an injected storage-failure publisher
 * [OUTPUT]: Provides runChatStoreMaintenanceOnce, which turns a failed gate into one typed self-check-failed storage failure and logs repaired projection drift, plus start/stop for the periodic gate (once ~60 s after the window is ready, then every 6 h, on unref'd timers)
 * [POS]: The only production caller of the maintenance gate; the composition root owns when it starts and who receives its failures, the shutdown chain owns when it stops
 */

import {
  chatStorageFailure,
  FAILURE_DIAGNOSTIC_CHAR_LIMIT,
  type ChatStorageFailure,
} from "../../../shared/product-failure";
import type { ChatStore } from "../chats/chat-store";
import { asError } from "../errors";

type MaintenanceStore = Pick<ChatStore, "runMaintenance">;
type ReportStorageFailure = (failure: ChatStorageFailure) => void;

/* ── 不变量闸门必须真的在产品里跑过 ──────────────────────────────
 * 它此前只有 benchmark 一个调用者，于是「账本自洽」这句话从未在用户机器
 * 上被验证过一次。首次延后到窗口就绪之后 60 秒——启动那一段的磁盘与 CPU
 * 属于第一屏；此后每 6 小时一次。两个定时器都 unref：它们不该把进程从
 * 退出边缘拽回来。
 * ────────────────────────────────────────────────────────── */
const FIRST_DELAY_MS = 60_000;
const INTERVAL_MS = 6 * 60 * 60_000;

const stops: Array<() => void> = [];

/* 闸门失败不再是一句灰字：它走类型化的 Chat-storage 失败通道，渲染层用
   五语给出标题、解释、解决办法与「在 GitHub 反馈」按钮，技术详情随 issue
   一起带走。闸门自己修好的投影漂移只记日志——用户改不了它，开发者要看见。 */
export async function runChatStoreMaintenanceOnce(
  store: MaintenanceStore,
  report: ReportStorageFailure
) {
  try {
    const result = await store.runMaintenance();
    if (result.integrity !== "ok" || result.domainInvariants !== "ok") {
      throw new Error(
        `integrity=${result.integrity} invariants=${result.domainInvariants}`
      );
    }
    if (result.sourceProjection.repaired > 0) {
      console.warn(
        "[chats] maintenance gate repaired search projection drift",
        result.sourceProjection
      );
    }
    return result;
  } catch (cause) {
    const error = asError(cause);
    console.error("[chats] maintenance gate failed", error);
    report(chatStorageFailure("self-check-failed", {
      version: 1,
      kind: "diagnostic",
      message: (error.message || error.name).slice(0, FAILURE_DIAGNOSTIC_CHAR_LIMIT),
    }));
    return null;
  }
}

export function startChatStoreMaintenance(
  store: MaintenanceStore,
  report: ReportStorageFailure
) {
  const run = () => void runChatStoreMaintenanceOnce(store, report);
  const first = setTimeout(() => {
    run();
    const repeating = setInterval(run, INTERVAL_MS);
    repeating.unref();
    stops.push(() => clearInterval(repeating));
  }, FIRST_DELAY_MS);
  first.unref();
  stops.push(() => clearTimeout(first));
}

export function stopChatStoreMaintenance() {
  for (const stop of stops.splice(0)) stop();
}
