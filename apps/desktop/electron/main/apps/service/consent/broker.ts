/**
 * [INPUT]: Depends on the App record, and on ports for the native dialog (with an abort signal), the desktop notification, the clock and
 *          timers, request ids, the Edit Chat notice writer and a change callback for the build status.
 * [OUTPUT]: Provides ExtensionConsentBroker: request (the installer's extension decision), windowOpened, decline (a remote device's only
 *           decision), pending, outcome and close (a quit interrupts, ExtensionConsentInterrupted); ConsentPorts and the pending / outcome shapes.
 * [POS]: apps/service/consent's single settlement point for an extension decision (U06-d, Q-U8): the local dialog, a remote decline and the
 *        30-minute bound all settle through one function, first writer wins. The build waits on it, so every path ends it.
 */
import { APP_BUILD_LIMITS } from "@ai-chat/cloud-protocol/apps/build-status/model";
import type { AppRecord } from "../../../../../shared/ipc/apps/apps-ipc";

export type ConsentBy = "local" | "remote" | "timeout";
export type PendingConsent = Readonly<{ requestId: string; appId: string; extensionCount: number; expiresAt: number }>;
export type ConsentOutcome = Readonly<{ requestId: string; decision: "approved" | "declined"; by: ConsentBy; deviceName?: string }>;
export type DeclinedNotice = Readonly<{ appId: string; requestId: string; by: "remote" | "timeout"; deviceName?: string }>;
export type ConsentPorts = Readonly<{
  /** Shows the dialog on the current window; null when there is none (nothing shown). Abort closes it as a decline. */
  ask(record: Pick<AppRecord, "id" | "displayName">, details: readonly string[], signal: AbortSignal): Promise<boolean> | null;
  /** A notification on the computer, never a window taking focus. */
  notify(record: Pick<AppRecord, "id" | "displayName">): void;
  now(): number;
  timer(ms: number, fire: () => void): () => void;
  changed(appId: string): void;
  declined(notice: DeclinedNotice): Promise<void>;
  requestId(): string;
}>;
type Waiting = PendingConsent & { record: Pick<AppRecord, "id" | "displayName">; details: readonly string[]; asking: boolean;
  controller: AbortController; clear: () => void; resolve: (approved: boolean) => void; reject: (error: Error) => void };
/** Quitting is nobody's decision: the build it held ends as interrupted (the installer records `reason: "interrupted"`), never declined. */
export class ExtensionConsentInterrupted extends Error {
  readonly reason = "interrupted" as const;
  constructor() { super("Bottega closed while the extension decision was waiting"); this.name = "ExtensionConsentInterrupted"; }
}
/** Settled request ids kept per App so a late decline reads already-resolved (D-8). */
const SETTLED_KEPT = 16;

export class ExtensionConsentBroker {
  private readonly waiting = new Map<string, Waiting>();
  private readonly outcomes = new Map<string, ConsentOutcome>();
  private readonly settled = new Map<string, string[]>();
  constructor(private readonly ports: ConsentPorts) {}

  request(record: Pick<AppRecord, "id" | "displayName">, details: readonly string[]): Promise<boolean> {
    const earlier = this.waiting.get(record.id);
    if (earlier) this.settle(earlier, false, "local");
    return new Promise<boolean>((resolve, reject) => {
      const requestId = this.ports.requestId(), expiresAt = this.ports.now() + APP_BUILD_LIMITS.confirmWaitMs, controller = new AbortController();
      const entry: Waiting = { requestId, appId: record.id, extensionCount: Math.max(1, Math.min(details.length, APP_BUILD_LIMITS.extensions)), expiresAt,
        record, details, asking: false, controller, resolve, reject, clear: () => {} };
      entry.clear = this.ports.timer(APP_BUILD_LIMITS.confirmWaitMs, () => this.settle(entry, false, "timeout"));
      this.waiting.set(record.id, entry);
      this.outcomes.delete(record.id);
      this.ports.changed(record.id);
      if (!this.ask(entry)) this.ports.notify(record);
    });
  }
  /** A window opened: every request nobody has been asked yet is asked now, once. */
  windowOpened() { for (const entry of this.waiting.values()) if (!entry.asking) this.ask(entry); }
  decline(appId: string, requestId: string, deviceName: string): "declined" | "already-resolved" | "not-waiting" {
    const entry = this.waiting.get(appId);
    if (entry?.requestId === requestId) { this.settle(entry, false, "remote", deviceName); return "declined"; }
    return this.settled.get(appId)?.includes(requestId) ? "already-resolved" : "not-waiting";
  }
  pending(appId: string): PendingConsent | null {
    const entry = this.waiting.get(appId);
    return entry ? { requestId: entry.requestId, appId, extensionCount: entry.extensionCount, expiresAt: entry.expiresAt } : null;
  }
  /** The last settled decision of the App's latest request; cleared when a new request starts. */
  outcome(appId: string): ConsentOutcome | null { return this.outcomes.get(appId) ?? null; }
  /** Quitting: whatever still waits is interrupted, never decided: no outcome, no notice, and its build stops instead of finishing. */
  close() {
    for (const entry of [...this.waiting.values()]) {
      this.waiting.delete(entry.appId); entry.clear(); entry.controller.abort();
      entry.reject(new ExtensionConsentInterrupted());
      this.ports.changed(entry.appId);
    }
  }

  private ask(entry: Waiting) {
    const answer = this.ports.ask(entry.record, entry.details, entry.controller.signal);
    if (!answer) return false;
    entry.asking = true;
    void answer.then(approved => this.settle(entry, approved, "local"), () => this.settle(entry, false, "local"));
    return true;
  }
  private settle(entry: Waiting, approved: boolean, by: ConsentBy, deviceName?: string) {
    if (this.waiting.get(entry.appId) !== entry) return;
    this.waiting.delete(entry.appId);
    entry.clear(); entry.controller.abort();
    const kept = [...(this.settled.get(entry.appId) ?? []), entry.requestId].slice(-SETTLED_KEPT);
    this.settled.set(entry.appId, kept);
    this.outcomes.set(entry.appId, { requestId: entry.requestId, decision: approved ? "approved" : "declined", by, ...(deviceName ? { deviceName } : {}) });
    entry.resolve(approved);
    this.ports.changed(entry.appId);
    if (by !== "local") void this.ports.declined({ appId: entry.appId, requestId: entry.requestId, by, ...(deviceName ? { deviceName } : {}) }).catch(cause => console.warn("[apps] extension decline notice failed", cause));
  }
}
