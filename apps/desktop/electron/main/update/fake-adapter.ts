/**
 * [INPUT]: Depends on EventEmitter, optional E2E version/progress values, and an installation receipt callback
 * [OUTPUT]: Provides FakeUpdateAdapter for deterministic un-packaged update flow tests
 * [POS]: The explicit E2E-only updater; production adapter selection can never reach it in a packaged app
 */

import { EventEmitter } from "node:events";
import type {
  UpdateAdapter,
  UpdateAdapterEvents,
} from "./adapter";

export class FakeUpdateAdapter implements UpdateAdapter {
  private readonly events = new EventEmitter();

  constructor(
    private readonly version = "0.1.1",
    private readonly installed: () => void = () => undefined,
    private readonly stepDelayMs = 40
  ) {}

  on<K extends keyof UpdateAdapterEvents>(
    event: K,
    listener: UpdateAdapterEvents[K]
  ) {
    this.events.on(event, listener);
  }

  off<K extends keyof UpdateAdapterEvents>(
    event: K,
    listener: UpdateAdapterEvents[K]
  ) {
    this.events.off(event, listener);
  }

  async checkForUpdates() {
    this.events.emit("checking-for-update");
    await Promise.resolve();
    this.events.emit("update-available", { version: this.version });
  }

  async downloadUpdate() {
    for (const percent of [12, 58, 100]) {
      this.events.emit("download-progress", {
        percent,
        transferred: percent,
        total: 100,
      });
      await new Promise((resolve) => setTimeout(resolve, this.stepDelayMs));
    }
    this.events.emit("update-downloaded", { version: this.version });
  }

  quitAndInstall() {
    this.installed();
  }

  fail(error: Error) {
    this.events.emit("error", error);
  }
}
