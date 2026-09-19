/**
 * [INPUT]: Node worker_threads parent port and the isolated crypto-worker endpoint.
 * [OUTPUT]: Dedicated worker request handling; refuses execution on the main thread.
 * [POS]: Electron main-owned worker entry, also used by real Node process probes.
 */
import { isMainThread, parentPort } from "node:worker_threads";
import { serveCryptoWorker } from "../index";

if (isMainThread || parentPort === null) throw new Error("sync-encryption-unsupported");
const port = parentPort;
serveCryptoWorker({ postMessage: (message, transfer) => port.postMessage(message, transfer), onMessage: listener => { port.on("message", listener); } });
