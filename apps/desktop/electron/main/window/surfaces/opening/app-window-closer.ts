/**
 * [INPUT]: Depends on registered App windows and injected reclaim/current-window checks.
 * [OUTPUT]: Provides AppWindowCloser with coalesced native closes and at most two fresh exports after a restored source-revision conflict.
 * [POS]: window/surfaces/opening native-close owner; all residence, capsule and attachment checks stay in the existing migration coordinator.
 */
import type { ProductWindowRecord } from "../window-registry";

type Ports = {
  reclaim(record: ProductWindowRecord): Promise<void>;
  current(record: ProductWindowRecord): boolean;
};

export class AppWindowCloser {
  private readonly flights = new Map<string, Promise<void>>();
  constructor(private readonly ports: Ports) {}
  pending(record: ProductWindowRecord) { return this.flights.has(record.windowId); }
  close(record: ProductWindowRecord): Promise<void> {
    const pending = this.flights.get(record.windowId);
    if (pending) return pending;
    const flight = this.perform(record).finally(() => { this.flights.delete(record.windowId); });
    this.flights.set(record.windowId, flight);
    return flight;
  }
  private async perform(record: ProductWindowRecord): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try { await this.ports.reclaim(record); return; }
      catch (cause) {
        // Reclaim has already restored the source. Read a fresh capsule without weakening its CAS checks.
        if (attempt >= 2 || !(cause instanceof Error) || cause.message !== "COMPOSER_SOURCE_REVISION_CONFLICT"
          || !this.ports.current(record)) throw cause;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }
}
