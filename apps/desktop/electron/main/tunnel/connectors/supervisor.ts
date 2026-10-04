/**
 * [INPUT]: Owned connector launches, native fetch contracts, a proxy readiness challenge and bounded edge requests.
 * [OUTPUT]: ConnectorSupervisor, shared reference counts, at most one unpublished warm preview, readiness and crash state.
 * [POS]: Transport-only owner; authorization gates close before this owner terminates a connector.
 */
import { setTimeout as delay } from "node:timers/promises";
import type { ConnectorProcess } from "./process";
export type ConnectorState = "registering" | "edge" | "warm" | "open" | "failed" | "closed";
export type ConnectorView = { key: string; state: ConnectorState; checkedAt: number | null };
type Entry = ConnectorView & { process: ConnectorProcess | null; hostname: string | null; controller: AbortController;
  consumers: number; flight: Promise<void>; proxyPort: number; challenge: string; changed: () => void };
const HOST = /^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/;
export class ConnectorSupervisor {
  private readonly entries = new Map<string, Entry>();
  private warmKey: string | null = null;
  private closed = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private checking = false;
  constructor(private readonly launch: (port: number) => Promise<ConnectorProcess>, private readonly fetcher: typeof fetch = fetch) {
    this.timer = setInterval(() => { void this.checkWarm(); }, 60_000); this.timer.unref();
  }
  private async checkWarm() {
    if (this.closed || this.checking) return;
    const entry = this.warmKey ? this.entries.get(this.warmKey) : null;
    if (!entry || entry.consumers || entry.state !== "warm" || !entry.hostname) return;
    this.checking = true;
    try {
      // The standalone Node RequestInit omits cache; Request still defines its supported values.
      const options: RequestInit & Pick<Request, "cache"> = { redirect: "error", cache: "no-store", signal: AbortSignal.any([entry.controller.signal, AbortSignal.timeout(1500)]) };
      const response = await this.fetcher(`https://${entry.hostname}/__bottega/ready`, options);
      if (response.status !== 200 || await response.text() !== entry.challenge) throw new Error("tunnel-edge-unavailable");
      entry.checkedAt = Date.now(); entry.changed();
    } catch {
      if (!entry.controller.signal.aborted && !entry.consumers) {
        await this.stop(entry.key);
        if (!this.closed) await this.warm(entry.key, entry.proxyPort, entry.challenge, entry.changed).catch(() => undefined);
      }
    } finally { this.checking = false; }
  }
  views(): ConnectorView[] { return [...this.entries.values()].map(({ key, state, checkedAt }) => ({ key, state, checkedAt })); }
  async warm(key: string, proxyPort: number, challenge: string, changed: () => void) {
    if (this.warmKey && this.warmKey !== key && !this.entries.get(this.warmKey)?.consumers) await this.stop(this.warmKey);
    this.warmKey = key;
    await this.prepare(key, proxyPort, challenge, changed).flight;
  }
  async acquire(key: string, proxyPort: number, challenge: string, changed: () => void) {
    const entry = this.prepare(key, proxyPort, challenge, changed);
    entry.consumers++;
    try {
      await entry.flight;
      if (entry.controller.signal.aborted || !entry.hostname || entry.state === "failed") throw new Error("preview-tunnel-unavailable");
      entry.state = "open"; entry.changed();
      return entry.hostname;
    } catch (error) { entry.consumers--; if (!entry.consumers) await this.stop(key); throw error; }
  }
  async release(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (--entry.consumers <= 0) await this.stop(key);
  }
  private prepare(key: string, proxyPort: number, challenge: string, changed: () => void) {
    if (this.closed) throw new Error("tunnel-plugin-disabled");
    const prior = this.entries.get(key);
    if (prior) {
      if (prior.proxyPort !== proxyPort || prior.challenge !== challenge) throw new Error("tunnel-target-changed");
      return prior;
    }
    const entry: Entry = { key, proxyPort, challenge, changed, state: "registering", checkedAt: null, consumers: 0, process: null, hostname: null,
      controller: new AbortController(), flight: Promise.resolve() };
    this.entries.set(key, entry);
    entry.flight = this.connect(entry);
    entry.flight.catch(() => undefined);
    return entry;
  }
  private async connect(entry: Entry): Promise<void> {
    const signal = entry.controller.signal;
    for (let attempt = 0; attempt < 3; attempt++) {
      let process: ConnectorProcess | null = null;
      try {
        signal.throwIfAborted(); entry.state = "registering"; entry.changed();
        process = entry.process = await this.launch(entry.proxyPort);
        if (signal.aborted) { await process.close(); signal.throwIfAborted(); }
        let exited = false; void process.exited.then(() => { exited = true; });
        for (let poll = 0; poll < 120; poll++) {
          signal.throwIfAborted();
          if (exited) throw new Error("preview-tunnel-unavailable");
          if (!entry.hostname) {
            try {
              const response = await this.fetcher(`${process.metrics}/quicktunnel`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]), redirect: "error" });
              const text = await response.text();
              if (text.length > 2048) throw new Error("tunnel-host-invalid");
              const hostname = (JSON.parse(text) as { hostname?: string }).hostname;
              if (response.ok && hostname && HOST.test(hostname)) { entry.hostname = hostname; entry.state = "edge"; entry.changed(); }
            } catch { /* Registration may still be pending. */ }
          }
          if (entry.hostname) {
            try {
              const options: RequestInit & Pick<Request, "cache"> = { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]), redirect: "error", cache: "no-store" };
              const response = await this.fetcher(`https://${entry.hostname}/__bottega/ready`, options);
              if (response.status === 200 && await response.text() === entry.challenge) {
                entry.checkedAt = Date.now(); entry.state = entry.consumers ? "open" : "warm"; entry.changed();
                void process.exited.then(() => {
                  if (signal.aborted) return;
                  entry.hostname = null;
                  if (entry.consumers) { entry.state = "failed"; entry.changed(); return; }
                  entry.flight = this.connect(entry); entry.flight.catch(() => undefined);
                });
                return;
              }
            } catch { /* The edge may lag the local registration. */ }
          }
          await delay(500, undefined, { signal });
        }
      } catch (error) { if (signal.aborted) throw error; }
      await process?.close(); entry.process = null; entry.hostname = null;
      if (attempt < 2) await delay(2000 * 2 ** attempt, undefined, { signal });
    }
    entry.state = "failed"; entry.changed(); throw new Error("preview-tunnel-unavailable");
  }
  async stop(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.controller.abort(); entry.state = "closed"; entry.hostname = null; entry.changed();
    await entry.process?.close();
    await entry.flight.catch(() => undefined);
    if (this.entries.get(key) === entry) this.entries.delete(key);
    if (this.warmKey === key) this.warmKey = null;
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    const results = await Promise.allSettled([...this.entries.keys()].map(key => this.stop(key)));
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "tunnel-close-failed");
  }
}
