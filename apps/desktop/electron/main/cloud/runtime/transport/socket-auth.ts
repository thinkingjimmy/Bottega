/**
 * [INPUT]: Depends on the session token provider, cancellable retry timing and a socket owner's lifecycle callbacks.
 * [OUTPUT]: Provides SocketAuthentication with independent readiness, transient retry and close fencing for each socket.
 * [POS]: Shared authentication lifecycle for the primary and bulk transports; it never replays operations.
 */
import { recoveryDiagnostics } from "../diagnostics/timeline";
import { AuthTransportError } from "../../account/session-client";

export type AuthTiming = { wait(milliseconds: number, signal: AbortSignal): Promise<void>; random(): number };
const RETRY_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000] as const;
export function tokenRetryDelay(attempt: number, random: number) {
  return Math.round(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]! * (0.8 + 0.4 * random));
}
export class SocketAuthentication {
  private authenticated = false;
  private retrying = false;
  private closed = false;
  private lastToken: string | null = null;
  private lifetime = new AbortController();
  private wake: AbortController | null = null;
  private waiters = new Set<() => void>();
  constructor(private readonly token: (force: boolean) => Promise<string | null>, private readonly timing: AuthTiming,
    private readonly changed: (ready: boolean) => void, private readonly failed: (error: unknown) => void,
    private readonly stage: "control-auth" | "bulk-auth" = "control-auth") { recoveryDiagnostics.record({ stage, code: "started" }); }
  ready() { return !this.closed && this.authenticated && !this.retrying; }
  isRetrying() { return this.retrying; }
  networkOnline() { this.wake?.abort(); }
  private notify() { this.changed(this.ready()); for (const waiter of this.waiters) waiter(); }
  accept = (authenticated: boolean) => {
    if (this.closed) return;
    this.authenticated = authenticated;
    if (!authenticated) { recoveryDiagnostics.record({ stage: this.stage, code: "failed" }); this.failed(new AuthTransportError("temporarily-offline")); return; }
    recoveryDiagnostics.record({ stage: this.stage, code: "ready" }); this.notify();
  };
  fetch = async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
    for (let attempt = 0; !this.closed; attempt++) {
      let release = () => {};
      try {
        // A provider may be waiting on an old account's I/O. Closing this owner still settles its SDK callback.
        const cancelled = new Promise<null>(resolve => {
          const cancel = () => resolve(null); release = () => this.lifetime.signal.removeEventListener("abort", cancel);
          this.lifetime.signal.addEventListener("abort", cancel, { once: true });
        });
        const token = await Promise.race([this.token(forceRefreshToken), cancelled]);
        if (this.closed) return null;
        if (!token) { this.failed(new AuthTransportError("temporarily-offline")); return null; }
        // Convex does not report a second auth success for every renewed token. After a failed fetch,
        // a different token therefore needs a new socket's explicit confirmation before work can resume.
        if (this.retrying && this.authenticated && this.lastToken && token !== this.lastToken) {
          recoveryDiagnostics.record({ stage: this.stage, code: "superseded" });
          this.failed(new AuthTransportError("temporarily-offline")); return null;
        }
        this.lastToken = token;
        // The SDK does not emit another true callback when a scheduled refresh returns the same token.
        if (this.retrying) recoveryDiagnostics.record({ stage: this.stage, code: "ready" });
        this.retrying = false; this.notify();
        return token;
      } catch (error) {
        if (this.closed) return null;
        if (error instanceof AuthTransportError && error.kind === "invalid-session") { recoveryDiagnostics.record({ stage: this.stage, code: "invalid-session" }); this.failed(error); return null; }
        this.retrying = true; this.notify();
        const wake = new AbortController(); this.wake = wake;
        const wait = tokenRetryDelay(attempt, this.timing.random());
        recoveryDiagnostics.record({ stage: this.stage, code: "retrying", attempt: attempt + 1, retryAt: Date.now() + wait });
        await this.timing.wait(wait, wake.signal);
        if (this.wake === wake) this.wake = null;
      } finally { release(); }
    }
    return null;
  };
  waitUntilReady(): Promise<void> {
    if (this.ready()) return Promise.resolve();
    if (this.closed) return Promise.reject(new Error("cloud-request-superseded"));
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); this.waiters.delete(check); if (error) reject(error); else resolve(); };
      const check = () => { if (this.closed) finish(new Error("cloud-request-superseded")); else if (this.ready()) finish(); };
      const timer = setTimeout(() => finish(new AuthTransportError("temporarily-offline")), 15_000);
      this.waiters.add(check); check();
    });
  }
  close() {
    if (this.closed) return;
    recoveryDiagnostics.record({ stage: this.stage, code: "closed" });
    this.closed = true; this.lastToken = null; this.lifetime.abort(); this.wake?.abort(); this.wake = null;
    for (const waiter of this.waiters) waiter(); this.waiters.clear();
  }
}
