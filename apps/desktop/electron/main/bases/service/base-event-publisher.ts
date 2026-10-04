/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and canonical Base snapshots/events, the live renderer event bus, and an optional registered main BrowserWindow fallback
 * [OUTPUT]: Provides bounded Base change projection plus process-global and fallback-window event delivery, and main-process subscribers (every local or synced change)
 * [POS]: Bases event delivery adapter; BasesService owns mutations while this module owns payload budgeting and renderer publication
 */

import type { BrowserWindow } from "electron";
import { BASE_EVENT_BYTE_LIMIT, BASES_CHANNEL, type BaseChangedEvent, type BasesEvent, type BaseSnapshot } from "../../../../shared/bases/model/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-core/model/owner-key";
import { rendererEventBus } from "../../window/surfaces/renderer-event-bus";

export class BaseEventPublisher {
  private window: BrowserWindow | null = null;
  private readonly listeners = new Set<(event: BasesEvent) => void>();

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
      ...structuredClone(delta),
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

  /** Main-process subscribers see every change the renderer sees, local or synced. */
  subscribe(listener: (event: BasesEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(event: BasesEvent) {
    this.onEvent?.(structuredClone(event));
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch (cause) { console.error("[bases] event subscriber failed", cause); }
    }
    const delivered = rendererEventBus.broadcast(BASES_CHANNEL.event, event);
    if (!delivered && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(BASES_CHANNEL.event, event);
    }
  }
}
