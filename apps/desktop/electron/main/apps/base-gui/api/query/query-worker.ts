/**
 * [INPUT]: Depends on Node worker_threads, immutable registered Base snapshots carrying their main-charged byte size, and the Query V1 pure executor
 * [OUTPUT]: Provides the isolated worker message loop for register, evict, and absolute-deadline query operations that yield a typed query_timeout before main terminates the worker, and owns the per-snapshot sorted-plan cache that makes paging cheap
 * [POS]: Off-main execution leaf of api/query/, entered through electron/main/app-gui-query-worker-entry.ts; it owns no authority and cannot read Base storage directly
 */

import { parentPort } from "node:worker_threads";
import type { BaseGuiQueryRequestV1 } from "../../../../../../shared/app-gui/query";
import type { BaseSnapshot } from "../../../../../../shared/bases-ipc";
import { executeBaseGuiQueryV1, type QueryPlanCacheV1 } from "./query-v1";

type WorkerRequest =
  | Readonly<{
      type: "register";
      requestId: string;
      snapshotKey: string;
      snapshot: BaseSnapshot;
      rowsBytes: number;
    }>
  | Readonly<{ type: "evict"; snapshotKey: string }>
  | Readonly<{
      type: "query";
      requestId: string;
      snapshotKey: string;
      request: BaseGuiQueryRequestV1;
      cursorKey: number[];
      queueDeadlineAt: number;
      deadlineAt: number;
    }>;

const SNAPSHOT_LIMIT = 20 * 1024 * 1024;
/* 主进程的 terminate 定时器落在 deadlineAt 上；worker 提前这么多毫秒自己
   以 query_timeout 收场，慢查询就不会连坐整个快照缓存与所有在途查询。 */
const YIELD_MARGIN_MS = 25;

/* 字节体量在 main 注册快照时量过一次，这里只存不再重算。plans 与快照同生
   共死：快照被逐出，为它排好序的计划自然一起消失。 */
const snapshots = new Map<string, Readonly<{
  snapshot: BaseSnapshot;
  rowsBytes: number;
  plans: QueryPlanCacheV1;
}>>();
if (!parentPort) throw new Error("Query worker requires a parent port");

parentPort.on("message", (message: WorkerRequest) => {
  if (message.type === "evict") {
    snapshots.delete(message.snapshotKey);
    return;
  }
  try {
    if (message.type === "register") {
      snapshots.set(message.snapshotKey, {
        snapshot: message.snapshot,
        rowsBytes: message.rowsBytes,
        plans: new Map(),
      });
      respond(message.requestId, true, { registered: true });
      return;
    }
    const entry = snapshots.get(message.snapshotKey);
    if (!entry) {
      throw Object.assign(new Error("Query snapshot is no longer cached"), {
        status: 409,
        code: "query_snapshot_missing",
        outcome: "not-committed",
      });
    }
    if (entry.rowsBytes > SNAPSHOT_LIMIT) {
      throw Object.assign(new Error("Base snapshot exceeds 20 MiB"), {
        status: 413,
        code: "query_budget_exceeded",
        outcome: "not-committed",
      });
    }
    if (Date.now() >= message.queueDeadlineAt) {
      throw Object.assign(new Error("Query expired before worker execution"), {
        status: 429,
        code: "query_queue_timeout",
        outcome: "not-committed",
      });
    }
    if (Date.now() >= message.deadlineAt) {
      throw Object.assign(new Error("Query exceeded its wall budget before worker execution"), {
        status: 408,
        code: "query_timeout",
        outcome: "not-committed",
      });
    }
    parentPort!.postMessage({ requestId: message.requestId, ok: true, started: true });
    respond(
      message.requestId,
      true,
      executeBaseGuiQueryV1(entry.snapshot, message.request, Uint8Array.from(message.cursorKey), {
        deadlineAt: message.deadlineAt - YIELD_MARGIN_MS,
        plans: entry.plans,
      })
    );
  } catch (cause) {
    const error = cause as Error & {
      status?: number;
      code?: string;
      outcome?: "not-committed" | "unknown";
      issues?: unknown[];
    };
    parentPort!.postMessage({
      requestId: message.requestId,
      ok: false,
      error: {
        message: error.message,
        status: error.status,
        code: error.code,
        outcome: error.outcome,
        issues: error.issues,
      },
    });
  }
});

function respond(requestId: string, ok: true, result: unknown) {
  parentPort!.postMessage({ requestId, ok, result });
}
