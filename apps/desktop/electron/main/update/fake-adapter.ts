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
  private checks = 0;
  private candidate: string | null = null;
  private downloaded: string | null = null;

  constructor(
    private readonly version = "0.1.1",
    private readonly installed: (version: string) => void = () => undefined,
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

  async checkForUpdates(operationId?: number) {
    this.events.emit("checking-for-update");
    await Promise.resolve();
    const versions = this.version.split(",");
    this.candidate = versions[Math.min(this.checks++, versions.length - 1)]!;
    this.events.emit("update-available", { version: this.candidate, operationId });
  }

  async downloadUpdate(operationId?: number) {
    if (!this.candidate) throw new Error("UPDATE_CANDIDATE_STALE");
    const version = this.candidate;
    for (const percent of [12, 58, 100]) {
      this.events.emit("download-progress", {
        percent, operationId,
        transferred: percent,
        total: 100,
      });
      await new Promise((resolve) => setTimeout(resolve, this.stepDelayMs));
    }
    this.downloaded = version;
    this.events.emit("update-downloaded", { version, operationId });
  }

  quitAndInstall() {
    if (!this.downloaded || this.downloaded !== this.candidate) throw new Error("UPDATE_CANDIDATE_STALE");
    this.installed(this.downloaded);
  }

  async validateDownloadedCandidate(version?: string) { return this.downloaded === version && version === this.candidate; }
  invalidateCandidate() { this.candidate = null; this.downloaded = null; }

  fail(error: Error) {
    this.events.emit("error", error);
  }
}
