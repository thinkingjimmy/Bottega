/**
 * [INPUT]: Depends on WindowRegistry publication and product window role records
 * [OUTPUT]: Provides RendererEventBus for role-, app-, and broadcast-scoped clone-safe event delivery
 * [POS]: Window surfaces event router; new multi-window code does not grow another service-local BrowserWindow pointer
 */

import type { ProductWindowRole } from "../../../../shared/window-surfaces-ipc";
import { type WindowRegistry, windowRegistry } from "./window-registry";

export class RendererEventBus {
  constructor(private readonly registry: WindowRegistry = windowRegistry) {}

  toRole(role: ProductWindowRole, channel: string, value: unknown) {
    return this.registry.publish(channel, value, (record) => record.role === role);
  }

  toApp(appId: string, channel: string, value: unknown) {
    return this.registry.publish(channel, value, (record) => record.appId === appId);
  }

  broadcast(channel: string, value: unknown) {
    return this.registry.publish(channel, value);
  }
}

export const rendererEventBus = new RendererEventBus();
