/**
* [INPUT]: Depends on Electron isolated IPC, schema-free Dock budgets and a private main-owned launch identity.
* [OUTPUT]: Exposes only __bottegaDock request/change/failure methods to the launched native main frame.
* [POS]: Dedicated sandboxed Widget preload; author code never receives Electron, Node, tokens or product bridges.
*/
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { DOCK_OPERATIONS, DOCK_RPC_BUDGET, DOCK_SESSION_TIMING, type DockOperation } from '@bottega/contracts/plugins/dock/session/protocol';
import { DOCK_DETAIL_ARGUMENT, DOCK_DETAIL_CHANNEL as CHANNEL, type DockDetailBridge, type DockDetailChange } from '../../../shared/system-dock/widgets/native';
const nonce = process.argv.find(value => value.startsWith(DOCK_DETAIL_ARGUMENT))?.slice(DOCK_DETAIL_ARGUMENT.length);
if (process.isMainFrame && nonce && /^[a-f0-9]{64}$/.test(nonce)) {
  const operations = new Set<string>(DOCK_OPERATIONS), listeners = new Set<(value: DockDetailChange) => void>(), encoder = new TextEncoder();
  let stopped = false, pending = 0, gesture = 0, second = 0, calls = 0, timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
    }
    timer = null;
    listeners.clear();
    ipcRenderer.removeListener(CHANNEL.changed, receive);
    window.removeEventListener('pointerup', input, true);
    window.removeEventListener('keydown', input, true);
  };
  const request = async (operation: DockOperation, payload: unknown = {}): Promise<unknown> => {
    if (stopped) {
      throw new Error('DOCK_SESSION_CLOSED');
    }
    if (!operations.has(operation)) {
      throw new Error('DOCK_OPERATION_DENIED');
    }
    if (pending >= DOCK_RPC_BUDGET.pending) {
      throw new Error('DOCK_RPC_CAPACITY');
    }
    const tick = Math.floor(Date.now() / 1000);
    if (tick !== second) {
      second = tick;
      calls = 0;
    }
    if (++calls > DOCK_RPC_BUDGET.requestsPerSecond) {
      throw new Error('DOCK_RPC_RATE_LIMIT');
    }
    const serialized = JSON.stringify({ operation, payload });
    if (serialized.length > DOCK_RPC_BUDGET.inputBytes || encoder.encode(serialized).byteLength > DOCK_RPC_BUDGET.inputBytes) {
      throw new Error('DOCK_RPC_BUDGET');
    }
    pending++;
    try {
      const result: unknown = await ipcRenderer.invoke(CHANNEL.request, nonce, serialized, operation === 'dock.action' ? gesture : 0);
      if (encoder.encode(JSON.stringify(result ?? null)).byteLength > DOCK_RPC_BUDGET.outputBytes) {
        throw new Error('DOCK_RPC_OUTPUT_BUDGET');
      }
      return result;
    }
    finally {
      pending--;
    }
  };
  function receive(_event: IpcRendererEvent, value: DockDetailChange) {
    if (stopped) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(value);
      }
      catch { /* A callback error does not stop other listeners. */
      }
    }
  }
  function input(event: Event) {
    if (stopped || !event.isTrusted) {
      return;
    }
    gesture++;
    ipcRenderer.send(CHANNEL.gesture, nonce, gesture);
    if (event instanceof KeyboardEvent && event.key === 'Escape') {
      queueMicrotask(() => {
        if (!stopped && !event.defaultPrevented) {
          ipcRenderer.send(CHANNEL.escape, nonce);
        }
      });
    }
  }
  ipcRenderer.on(CHANNEL.changed, receive);
  window.addEventListener('pointerup', input, true);
  window.addEventListener('keydown', input, true);
  window.addEventListener('pagehide', stop, { once: true });
  timer = setInterval(() => {
    if (!stopped) {
      void request('dock.heartbeat', {}).catch(stop);
    }
  }, DOCK_SESSION_TIMING.heartbeatMs);
  contextBridge.exposeInMainWorld('__bottegaDock', {
    request, onChanged(listener) {
      if (stopped) {
        throw new Error('DOCK_SESSION_CLOSED');
      }
      if (listeners.size >= DOCK_RPC_BUDGET.pending) {
        throw new Error('DOCK_SUBSCRIPTION_CAPACITY');
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    fail() {
      if (!stopped) {
        ipcRenderer.send(CHANNEL.fault, nonce);
        stop();
      }
    },
  } satisfies DockDetailBridge);
}
