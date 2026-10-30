/**
* [INPUT]: Depends on native detail lifecycle types, exact scope keys and on-demand host loading.
* [OUTPUT]: Provides a lazy DockWidgetDetailPort without loading native execution or RPC validators for builtin/summary-only users.
* [POS]: Main composition boundary; late imports recheck the current panel/slot and cannot reopen a closed target.
*/
import type { BrowserWindow } from 'electron';
import type { DockDetailSlot } from '../../../../../shared/system-dock/widgets/native';
import type { DockWidgetDetailPort, WidgetDetailPorts } from './ports';
import { widgetDetailKey } from './scope';
export function createDockWidgetDetail(ports: WidgetDetailPorts): DockWidgetDetailPort {
  let host: DockWidgetDetailPort | null = null, pending: Promise<void> | null = null, panel: BrowserWindow | null = null, itemId: string | null = null, slot: DockDetailSlot | null = null, closed = false;
  const failed = new Set<string>();
  const load = () => {
    if (closed || host || pending) {
      return;
    }
    const task = import('./host').then(({ DockWidgetDetailHost }) => {
      if (closed) {
        return;
      }
      host = new DockWidgetDetailHost(ports);
      host.presented(panel, itemId);
      const source = itemId ? ports.source(itemId) : null;
      if (slot && source && widgetDetailKey(source) === slot.key) {
        host.bounds(slot);
      }
    }).catch(() => {
      if (slot) {
        while (failed.size >= 100) {
          failed.delete(failed.values().next().value!);
        }
        failed.add(slot.key);
      }
    }).finally(() => {
      if (pending === task) {
        pending = null;
      }
      ports.changed();
    });
    pending = task;
  };
  return {
    presented(window, id) {
      panel = window;
      itemId = id;
      if (slot?.itemId !== id) {
        slot = null;
      }
      host?.presented(window, id);
    },
    bounds(value) {
      if (closed || itemId !== value.itemId || !panel || panel.isDestroyed() || !panel.isVisible()) {
        return;
      }
      const source = ports.source(value.itemId);
      if (!source || widgetDetailKey(source) !== value.key) {
        return;
      }
      slot = value;
      if (host) {
        host.bounds(value);
      }
      else if (!failed.has(value.key)) {
        load();
      }
    },
    retry(id, key) {
      if (host) {
        host.retry(id, key);
      }
      else {
        const source = ports.source(id);
        if (!source || widgetDetailKey(source) !== key) {
          throw new Error('DOCK_DETAIL_SCOPE_CHANGED');
        }
        failed.delete(key);
        load();
      }
    },
    reconcile() {
      host?.reconcile();
    },
    presentation(source) {
      const key = widgetDetailKey(source);
      return host?.presentation(source) ?? { key, state: failed.has(key) ? 'failed' : pending ? 'loading' : 'available' };
    },
    health() {
      return host?.health() ?? { detail: { views: 0, sessions: 0, timers: 0, requests: Number(pending !== null) } };
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      panel = null;
      itemId = null;
      slot = null;
      await pending;
      await host?.close();
      failed.clear();
    },
  };
}
