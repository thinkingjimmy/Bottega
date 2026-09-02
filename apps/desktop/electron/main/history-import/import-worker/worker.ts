/**
 * [INPUT]: Depends on worker_threads, four read-only history adapters, adapter entries, and the closed import-worker protocol
 * [OUTPUT]: Parses and precomputes source revisions off-main one at a time, publishing byte-bounded entry batches only after the previous batch is acknowledged, and abandoning a run on cancellation
 * [POS]: Dedicated external-history parser owner; it has no product Store or SQLite write authority
 */

import { parentPort } from "node:worker_threads";
import { ClaudeHistoryAdapter } from "../claude-adapter";
import { CodexHistoryAdapter } from "../codex-adapter";
import { KimiHistoryAdapter } from "../kimi-adapter";
import { OpencodeHistoryAdapter } from "../opencode-adapter";
import type { HistoryAdapter } from "../adapter";
import {
  normalizeHistoryBlocks,
  prepareHistoryImportEntries,
} from "../../chats/sqlite/import/normalization";
import type {
  ImportWorkerAck,
  ImportWorkerCancel,
  ImportWorkerRequest,
  ImportWorkerResponse,
} from "./protocol";

function adapterFor(home: string, kind: ImportWorkerRequest["entry"]["sourceKind"]): HistoryAdapter {
  const adapters: HistoryAdapter[] = [
    new ClaudeHistoryAdapter(home),
    new CodexHistoryAdapter(home),
    new KimiHistoryAdapter(home),
    new OpencodeHistoryAdapter(home),
  ];
  const adapter = adapters.find((candidate) => candidate.sourceKind === kind);
  if (!adapter) throw new Error(`Unsupported history source: ${kind}`);
  return adapter;
}

if (!parentPort) throw new Error("History import worker requires a parent port");
const port = parentPort;
let tail = Promise.resolve();

type Inbound = ImportWorkerRequest | ImportWorkerAck | ImportWorkerCancel;

/* 一条 port 上跑连续多次解析：cancel 只对当前 requestId 生效，晚到的
   cancel 不会误伤下一条请求。 */
const cancelled = new Set<string>();

port.on("message", (raw: Inbound) => {
  if (raw?.version !== 1) return;
  if (raw.kind === "cancel") {
    cancelled.add(raw.requestId);
    return;
  }
  if (raw.kind !== "parse") return;
  tail = tail.then(async () => {
    try {
      const adapter = adapterFor(raw.home, raw.entry.sourceKind);
      if (!adapter.parseBatches) throw new Error("Built-in history adapter is not stream-capable");
      const batches = adapter.parseBatches(raw.entry);
      let batchIndex = 0;
      let incompleteTail = false;
      while (true) {
        if (cancelled.has(raw.requestId)) throw new Error("History import cancelled");
        let next: Awaited<ReturnType<typeof batches.next>> | null = await batches.next();
        if (next.done) {
          incompleteTail = next.value;
          break;
        }
        let entries = prepareHistoryImportEntries(normalizeHistoryBlocks(next.value));
        port.postMessage({
          version: 1,
          kind: "batch",
          requestId: raw.requestId,
          batchIndex,
          entries,
        } satisfies ImportWorkerResponse);
        entries = [];
        next = null;
        await new Promise<void>((resolve, reject) => {
          /* cancel 可能在解析途中就到了：那时没有 ack 监听器在听，等注册好
             再听就永远等不到第二遍，于是整整 60 秒的超时挡在下一条请求前。 */
          if (cancelled.has(raw.requestId)) {
            reject(new Error("History import cancelled"));
            return;
          }
          const timer = setTimeout(() => {
            port.off("message", ack);
            reject(new Error("History import batch acknowledgement timed out"));
          }, 60_000);
          const ack = (value: Inbound) => {
            if (value?.version !== 1 || value.requestId !== raw.requestId) return;
            if (value.kind === "cancel") {
              clearTimeout(timer);
              port.off("message", ack);
              reject(new Error("History import cancelled"));
              return;
            }
            if (value.kind === "ack" && value.batchIndex === batchIndex) {
              clearTimeout(timer);
              port.off("message", ack);
              resolve();
            }
          };
          port.on("message", ack);
        });
        batchIndex += 1;
      }
      port.postMessage({
        version: 1,
        kind: "done",
        requestId: raw.requestId,
        incompleteTail,
      } satisfies ImportWorkerResponse);
    } catch (cause) {
      port.postMessage({
        version: 1,
        kind: "failure",
        requestId: raw.requestId,
        message: cause instanceof Error ? cause.message : String(cause),
      } satisfies ImportWorkerResponse);
    } finally {
      cancelled.delete(raw.requestId);
    }
  });
});

port.start();
