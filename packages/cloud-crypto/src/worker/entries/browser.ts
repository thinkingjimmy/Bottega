/**
 * [INPUT]: Dedicated browser Worker globals and the isolated crypto-worker endpoint.
 * [OUTPUT]: Worker-only request handling with no page or IndexedDB secret ownership.
 * [POS]: Locally bundled browser Worker entry; never weakens the renderer policy.
 */
import { serveCryptoWorker } from "../index";
import type { CryptoWorkerRequest } from "../model";

const worker = globalThis as unknown as {
  document?: unknown;
  importScripts?: unknown;
  postMessage(value: unknown, transfer?: ArrayBuffer[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<CryptoWorkerRequest>) => void): void;
};
if (worker.document !== undefined || typeof worker.importScripts !== "function" || typeof worker.postMessage !== "function") throw new Error("sync-encryption-unsupported");
serveCryptoWorker({ postMessage: (message, transfer) => worker.postMessage(message, transfer), onMessage: listener => worker.addEventListener("message", event => listener(event.data)) });
