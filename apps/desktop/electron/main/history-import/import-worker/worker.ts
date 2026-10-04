/**
 * [INPUT]: Depends on worker_threads, four read-only history adapters built on the source roots main resolved from the fence table, adapter entries, and the closed import-worker protocol
 * [OUTPUT]: Answers scans, warm-ups and complete parses (cancellable) beside the stream, and parses and precomputes source revisions one run at a time, publishing byte-bounded entry batches only after the previous batch is acknowledged, abandoning a run on cancellation
 * [POS]: The only thread that reads another Agent's history (TASK-11 D10); it has no product Store or SQLite write authority, and keeps one adapter set per roots for its life
 */

import { parentPort } from "node:worker_threads";
import { ClaudeHistoryAdapter } from "../adapters/claude-adapter";
import { CodexHistoryAdapter } from "../adapters/codex-adapter";
import { KimiHistoryAdapter } from "../adapters/kimi-adapter";
import { OpencodeHistoryAdapter } from "../adapters/opencode-adapter";
import type { HistoryAdapter } from "../adapters/adapter";
import {
  normalizeHistoryBlocks,
  prepareHistoryImportEntries,
} from "../../chats/sqlite/import/normalization";
import type { HistorySourceKind } from "../../../../shared/ipc/content/history-import-ipc";
import type {
  HistorySourceRoots,
  ImportWorkerAck,
  ImportWorkerCall,
  ImportWorkerCancel,
  ImportWorkerRequest,
  ImportWorkerResponse,
} from "./protocol";

/* One set of adapters per roots, kept for the worker's life: Codex's identity index (warm) and head cache answer the scans that follow. */
const adapterSets = new Map<string, HistoryAdapter[]>();
function adapterFor(roots: HistorySourceRoots, kind: HistorySourceKind): HistoryAdapter {
  const key = JSON.stringify(roots);
  let adapters = adapterSets.get(key);
  if (!adapters) adapterSets.set(key, adapters = [new ClaudeHistoryAdapter(roots.claude), new CodexHistoryAdapter(roots.codex),
    new KimiHistoryAdapter(roots.kimi), new OpencodeHistoryAdapter(roots.opencode)]);
  const adapter = adapters.find((candidate) => candidate.sourceKind === kind);
  if (!adapter) throw new Error(`Unsupported history source: ${kind}`);
  return adapter;
}

const failure = (requestId: string, cause: unknown): ImportWorkerResponse => {
  const code = (cause as { code?: unknown } | null)?.code;
  return { version: 1, kind: "failure", requestId, message: cause instanceof Error ? cause.message : String(cause), ...(typeof code === "string" ? { code } : {}) };
};

if (!parentPort) throw new Error("History import worker requires a parent port");
const port = parentPort;
let tail = Promise.resolve();

type Inbound = ImportWorkerRequest | ImportWorkerCall | ImportWorkerAck | ImportWorkerCancel;
/* An answered call in flight, by requestId: a cancel aborts it. */
const calls = new Map<string, AbortController>();

/* 一条 port 上跑连续多次解析：cancel 只对当前 requestId 生效，晚到的
   cancel 不会误伤下一条请求。 */
const cancelled = new Set<string>();

port.on("message", (raw: Inbound) => {
  if (raw?.version !== 1) return;
  if (raw.kind === "cancel") {
    const call = calls.get(raw.requestId);
    if (call) call.abort(new Error("History import cancelled"));
    else cancelled.add(raw.requestId);
    return;
  }
  if (raw.kind === "call") {
    const controller = new AbortController();
    calls.set(raw.requestId, controller);
    void (async () => {
      const adapter = adapterFor(raw.roots, raw.sourceKind);
      if (raw.op === "scan") return adapter.scanProject(raw.root, raw.depth);
      if (raw.op === "warm") { await adapter.warm?.(); return null; }
      return adapter.parse(raw.entry, controller.signal);
    })().then((value) => port.postMessage({ version: 1, kind: "answer", requestId: raw.requestId, value } satisfies ImportWorkerResponse),
      (cause) => port.postMessage(failure(raw.requestId, cause)))
      .finally(() => calls.delete(raw.requestId));
    return;
  }
  if (raw.kind !== "parse") return;
  tail = tail.then(async () => {
    try {
      const adapter = adapterFor(raw.roots, raw.entry.sourceKind);
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
      port.postMessage(failure(raw.requestId, cause));
    } finally {
      cancelled.delete(raw.requestId);
    }
  });
});

port.start();
