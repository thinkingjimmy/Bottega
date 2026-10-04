/**
 * [INPUT]: A host-authorized coverage RPC port and the explicit binary codec.
 * [OUTPUT]: createPluginCoverageWorker adapts asynchronous host compute to the existing eraser contract.
 * [POS]: Unprivileged Sketch runtime; it never constructs a Worker or accesses host storage.
 */
import type { WorkerPort } from '../sketch/worker/client';
import type { CoverageResponse } from '../sketch/worker/protocol';
import { decodePluginValue, encodePluginValue } from './codec';
export type PluginCoveragePort = { compute(bytes: Uint8Array, signal: AbortSignal): Promise<Uint8Array>; close?(): void };
export function createPluginCoverageWorker(port: PluginCoveragePort): WorkerPort {
  const controller = new AbortController();
  const worker: WorkerPort = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage(request) {
      if (controller.signal.aborted) return;
      void Promise.resolve().then(() => port.compute(encodePluginValue(request), controller.signal)).then(bytes => {
        if (!controller.signal.aborted) worker.onmessage?.({ data: decodePluginValue(bytes) as CoverageResponse } as MessageEvent<CoverageResponse>);
      }).catch(() => { if (!controller.signal.aborted) worker.onerror?.(new Event('error')); });
    },
    terminate() { controller.abort(); port.close?.(); },
  };
  return worker;
}
