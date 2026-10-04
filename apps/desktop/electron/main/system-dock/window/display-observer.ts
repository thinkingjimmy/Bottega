/**
 * [INPUT]: Depends on Electron's read-only screen directory, shared display facts, geometry eligibility, and an injected clock.
 * [OUTPUT]: Provides DisplayDirectory, a lifetime-scoped catalogue with bounded topology coalescing, and DockClock for deterministic lifecycle integration.
 * [POS]: system-dock/window topology adapter; owned by DockService even while disabled, with no native helper or surface side effects.
 */

import { screen } from "electron";
import type { DockDisplay } from "../../../../shared/system-dock/displays";
import { isSelectableDisplay } from "./geometry";

export type DockClock = {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  now(): number;
};
export const dockClock: DockClock = { setTimeout, clearTimeout, now: Date.now };

export class DisplayDirectory {
  private facts: readonly DockDisplay[] = [];
  private quiet: ReturnType<typeof setTimeout> | null = null;
  private maximum: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  constructor(private readonly changed: () => void, private readonly clock: DockClock) {}
  snapshot() { return this.facts; }
  refresh(): readonly DockDisplay[] {
    const displays = screen.getAllDisplays();
    const primary = displays.length ? screen.getPrimaryDisplay().id : null;
    this.facts = displays.map((display) => {
      const fact = { id: display.id, label: display.label, internal: display.internal, primary: display.id === primary,
        bounds: { ...display.bounds }, workArea: { ...display.workArea }, scaleFactor: display.scaleFactor,
        rotation: display.rotation, selectable: false };
      fact.selectable = isSelectableDisplay(fact);
      return fact;
    }).sort((a, b) => a.id - b.id);
    return this.facts;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.refresh();
    screen.on("display-added", this.changedSoon);
    screen.on("display-removed", this.removed);
    screen.on("display-metrics-changed", this.changedSoon);
  }
  private flush = () => {
    this.clearTimers();
    if (!this.active) return;
    this.refresh();
    this.changed();
  };
  private removed = () => { if (this.active) this.flush(); };
  private changedSoon = () => {
    if (!this.active) return;
    this.refresh();
    if (!this.facts.length) { this.flush(); return; }
    if (this.quiet) this.clock.clearTimeout(this.quiet);
    this.quiet = this.clock.setTimeout(this.flush, 200);
    this.maximum ??= this.clock.setTimeout(this.flush, 1_000);
  };
  private clearTimers() {
    if (this.quiet) this.clock.clearTimeout(this.quiet);
    if (this.maximum) this.clock.clearTimeout(this.maximum);
    this.quiet = null; this.maximum = null;
  }
  close() {
    this.active = false;
    this.clearTimers();
    screen.removeListener("display-added", this.changedSoon);
    screen.removeListener("display-removed", this.removed);
    screen.removeListener("display-metrics-changed", this.changedSoon);
  }
}
