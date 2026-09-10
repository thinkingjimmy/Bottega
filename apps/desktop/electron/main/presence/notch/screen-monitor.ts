/**
 * [INPUT]: Depends on native screen/focus transport and real-notch geometry policy.
 * [OUTPUT]: Provides background-scoped screen observation and notch availability independently of panel windows.
 * [POS]: Shared screen owner consumed by PresenceService and TaskPanelController.
 */

import type { NotchCapability } from "../../../../shared/presence-ipc";
import { panelGeometry, type NativeScreen } from "./geometry";
import type { NativeScreenBridge } from "./native-bridge";

type NativePort = Pick<NativeScreenBridge, "start" | "close" | "command" | "rememberFocus">;
export type PresenceScreenSource = Pick<PresenceScreenMonitor, "screens" | "capability" | "start" | "stop" | "onChanged" | "command" | "rememberFocus">;

export class PresenceScreenMonitor {
  private native: NativePort | null = null;
  private flight: Promise<void> | null = null;
  private generation = 0;
  private value: readonly NativeScreen[] = [];
  private state: NotchCapability;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly supported: boolean, private readonly create: (receive: (screens: NativeScreen[]) => void, failed: () => void) => NativePort) {
    this.state = this.initial();
  }
  private initial(): NotchCapability { return this.supported ? { status: "checking", reason: null } : { status: "unavailable", reason: "platform" }; }
  screens() { return this.value; }
  capability() { return this.state; }
  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish() { for (const listener of this.listeners) listener(); }
  start(): Promise<void> {
    if (!this.supported) return Promise.resolve();
    if (this.flight) return this.flight;
    if (this.native) return Promise.resolve();
    const generation = ++this.generation;
    this.state = this.initial(); this.publish();
    const failed = () => {
      if (generation !== this.generation) return;
      this.generation++;
      this.native?.close(); this.native = null; this.value = [];
      this.state = { status: "unavailable", reason: "native-unavailable" }; this.publish();
    };
    this.native = this.create((screens) => {
      if (generation !== this.generation) return;
      this.value = screens;
      this.state = panelGeometry(screens) ? { status: "available", reason: null } : {
        status: "unavailable", reason: screens.some((screen) => screen.builtin && screen.topInset > 0) ? "screen-unavailable" : "no-notch",
      };
      this.publish();
    }, failed);
    const flight = this.native.start().catch(failed).finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
    return flight;
  }
  stop() {
    this.generation++; this.native?.close(); this.native = null; this.flight = null; this.value = []; this.state = this.initial(); this.publish();
  }
  command(command: "restore-focus" | "refresh") { this.native?.command(command); }
  rememberFocus() { return this.native?.rememberFocus() ?? Promise.reject(new Error("NATIVE_FOCUS_UNAVAILABLE")); }
}
