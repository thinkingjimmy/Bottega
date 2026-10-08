/**
 * [INPUT]: AccountFacade identity and computer watches, plus browser visibility and network recovery events.
 * [OUTPUT]: Provides one shared computer-list owner per facade with retained facts, freshness, bounded retries and generation fences.
 * [POS]: Presentation subscription lifecycle used by useAccountComputers; it does not grant execution authority.
 */
import type { CloudComputer } from "@ai-chat/cloud-protocol";
import type { AccountFacade, AccountSnapshot, Unsubscribe } from "../contracts";

const RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;
const FIRST_VALUE_MS = 15_000;
type ComputerSnapshot = {
  computers: CloudComputer[] | null;
  freshness: "unknown" | "current" | "stale";
  updatedAt: number | null;
  nextRetryAt: number | null;
};
const empty: ComputerSnapshot = { computers: null, freshness: "unknown", updatedAt: null, nextRetryAt: null };
const owners = new WeakMap<AccountFacade, ComputerSubscription>();

export function accountComputerSubscription(account: AccountFacade) {
  let owner = owners.get(account);
  if (!owner) { owner = new ComputerSubscription(account); owners.set(account, owner); }
  return owner;
}

class ComputerSubscription {
  private listeners = new Set<() => void>();
  private value = empty;
  private identity: string | null = null;
  private accountState: AccountSnapshot["state"] | null = null;
  private stopAccount: Unsubscribe | null = null;
  private stopWatch: Unsubscribe | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private firstValueTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private failures = 0;

  constructor(private readonly account: AccountFacade) {}
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.open();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.close(); };
  };
  /** Coalesce foreground, pageshow and online delivered in the same browser turn. */
  retry = () => {
    if (!this.ready() || !this.visible() || this.resumeTimer !== null) return;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.ready() && this.visible()) this.start();
    }, 0);
  };
  private visible() { return typeof document === "undefined" || document.visibilityState !== "hidden"; }
  private ready() { return this.listeners.size > 0 && this.accountState === "ready" && this.identity !== null && Boolean(this.account.computers); }
  private publish(value: ComputerSnapshot) {
    this.value = value;
    for (const listener of [...this.listeners]) listener();
  }
  private clearTimers() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.firstValueTimer !== null) clearTimeout(this.firstValueTimer);
    if (this.resumeTimer !== null) clearTimeout(this.resumeTimer);
    this.retryTimer = this.firstValueTimer = this.resumeTimer = null;
  }
  private releaseWatch() {
    this.generation++;
    const stop = this.stopWatch; this.stopWatch = null;
    stop?.();
  }
  private accountChanged = () => {
    const snapshot = this.account.snapshot();
    const identity = snapshot.profile ? JSON.stringify([snapshot.profile.userId, snapshot.deviceId]) : null;
    if (identity === this.identity && snapshot.state === this.accountState) return;
    this.clearTimers(); this.releaseWatch();
    const changed = identity !== this.identity;
    this.identity = identity; this.accountState = snapshot.state; this.failures = 0;
    this.publish(changed ? empty : { ...this.value, freshness: this.value.computers ? "stale" : "unknown", nextRetryAt: null });
    if (this.ready()) this.start();
  };
  private open() {
    this.stopAccount = this.account.subscribe(this.accountChanged);
    this.accountChanged();
    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", this.retry);
      window.addEventListener("pageshow", this.retry);
      window.addEventListener("online", this.retry);
    }
  }
  private close() {
    this.clearTimers(); this.releaseWatch(); this.stopAccount?.(); this.stopAccount = null;
    this.identity = null; this.accountState = null; this.value = empty; this.failures = 0;
    if (typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", this.retry);
      window.removeEventListener("pageshow", this.retry);
      window.removeEventListener("online", this.retry);
    }
  }
  private start() {
    this.clearTimers(); this.releaseWatch();
    if (!this.ready()) return;
    const generation = this.generation;
    let received = false;
    this.publish({ ...this.value, freshness: this.value.computers ? "stale" : "unknown", nextRetryAt: null });
    const current = () => this.ready() && generation === this.generation;
    try {
      const stop = this.account.computers!(computers => {
        if (!current()) return;
        received = true; this.failures = 0;
        if (this.firstValueTimer !== null) clearTimeout(this.firstValueTimer);
        this.firstValueTimer = null;
        this.publish({ computers, freshness: "current", updatedAt: this.account.serverNow?.() ?? Date.now(), nextRetryAt: null });
      }, () => { if (current()) this.failed(); });
      // A port may fail before returning its unsubscribe handle.
      if (current()) this.stopWatch = stop; else stop();
      if (current() && !received) this.firstValueTimer = setTimeout(() => { if (current()) this.failed(); }, FIRST_VALUE_MS);
    } catch { if (current()) this.failed(); }
  }
  private failed() {
    this.clearTimers(); this.releaseWatch();
    const delay = RETRY_MS[Math.min(this.failures++, RETRY_MS.length - 1)]!;
    const resume = this.ready() && this.visible();
    this.publish({ ...this.value, freshness: "stale", nextRetryAt: resume ? Date.now() + delay : null });
    if (resume) this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.ready() && this.visible()) this.start(); }, delay);
  }
}
