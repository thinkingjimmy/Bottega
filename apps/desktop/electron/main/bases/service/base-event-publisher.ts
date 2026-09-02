/**
 * [INPUT]: Depends on canonical Base snapshots/events, the live renderer event bus, and an optional registered main BrowserWindow fallback
 * [OUTPUT]: Provides bounded Base change projection plus process-global and fallback-window event delivery
 * [POS]: Bases event delivery adapter; BasesService owns mutations while this module owns payload budgeting and renderer publication
 */

import type { BrowserWindow } from "electron";
import {
  BASE_EVENT_BYTE_LIMIT,
  BASES_CHANNEL,
  ownerKeyOf,
  type BaseChangedEvent,
  type BasesEvent,
  type BaseSnapshot,
} from "../../../../shared/bases-ipc";
import { rendererEventBus } from "../../window/surfaces/renderer-event-bus";

const clone = <T>(value: T): T => structuredClone(value);

export class BaseEventPublisher {
  private window: BrowserWindow | null = null;

  constructor(private readonly onEvent?: (event: BasesEvent) => void) {}

  bind(window: BrowserWindow) {
    this.window = window;
  }

  unbind(window: BrowserWindow) {
    if (this.window === window) this.window = null;
  }

  changed(
    snapshot: BaseSnapshot,
    delta: Pick<BaseChangedEvent, "meta" | "upserts" | "removedRowIds">
  ) {
    const full: BaseChangedEvent = {
      type: "base-changed",
      ownerKey: ownerKeyOf(snapshot.meta.owner),
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      revision: snapshot.meta.revision,
      ...clone(delta),
    };
    this.publish(
      Buffer.byteLength(JSON.stringify(full), "utf8") <= BASE_EVENT_BYTE_LIMIT
        ? full
        : {
            type: "base-changed",
            ownerKey: full.ownerKey,
            ownerInstanceId: full.ownerInstanceId,
            revision: full.revision,
          }
    );
  }

  publish(event: BasesEvent) {
    this.onEvent?.(clone(event));
    const delivered = rendererEventBus.broadcast(BASES_CHANNEL.event, event);
    if (!delivered && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(BASES_CHANNEL.event, event);
    }
  }
}
