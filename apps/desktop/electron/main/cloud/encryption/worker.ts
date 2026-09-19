/**
 * [INPUT]: Native Node worker threads, the shared worker resource limits, and the packaged, fixed E2EE worker entry.
 * [OUTPUT]: A lazy main-owned crypto facade with termination-backed KDF cancellation.
 * [POS]: Desktop process boundary; renderer never owns a Worker or receives key material.
 */
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createCryptoWorkerOwner } from "@ai-chat/cloud-crypto";
import type { CryptoScope } from "@ai-chat/cloud-protocol/encryption";
import { WORKER_RESOURCE_LIMITS } from "../../worker-limits";
export function createDesktopCryptoWorker(source: Pick<CryptoScope, "sourceEnvironment" | "sourceAccountId">) {
  return createCryptoWorkerOwner({ source, createWorker() {
    const worker = new Worker(join(__dirname, "sync-crypto-worker-entry.js"), { resourceLimits: { ...WORKER_RESOURCE_LIMITS } });
    return { postMessage: (request, transfer) => worker.postMessage(request, transfer),
      onMessage(listener) { worker.on("message", listener); return () => { worker.off("message", listener); }; },
      onError(listener) { worker.on("error", listener); return () => { worker.off("error", listener); }; },
      terminate: () => worker.terminate().then(() => undefined) };
  } });
}
