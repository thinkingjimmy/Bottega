/**
 * [INPUT]: Depends on HTTP Date header values with the device times a request was sent and answered.
 * [OUTPUT]: Provides ServerTimeOffset: record(dateHeader, sentAt, receivedAt) and now() (server time, or null with no trusted sample).
 * [POS]: Account-level server clock for presence (TASK-20 T20-9b); fed by the hosts from responses they make anyway, no protocol field.
 */
/** A sample slower than this says too little about when the server wrote its Date. */
const MAX_RTT_MS = 10_000;
/** The lowest-RTT sample wins within this window, so one slow response cannot skew the offset; after it, a fresh one may replace it. */
const WINDOW_MS = 5 * 60_000;
export class ServerTimeOffset {
  private best: { offset: number; rtt: number; at: number } | null = null;
  constructor(private readonly deviceNow: () => number = () => Date.now()) {}
  /** A missing or invalid header, or a slow round trip, changes nothing. */
  record(dateHeader: string | null | undefined, sentAt: number, receivedAt: number) {
    const server = dateHeader ? Date.parse(dateHeader) : NaN, rtt = receivedAt - sentAt;
    if (!Number.isFinite(server) || rtt < 0 || rtt > MAX_RTT_MS) return;
    // Date has one-second resolution: the server's moment is somewhere in that second, so take its middle.
    const offset = server + 500 - (sentAt + rtt / 2);
    if (!this.best || rtt <= this.best.rtt || receivedAt - this.best.at > WINDOW_MS) this.best = { offset, rtt, at: receivedAt };
  }
  /** Server time now, or null when no sample is trusted (the caller keeps the device clock). */
  now(): number | null { return this.best ? this.deviceNow() + this.best.offset : null; }
  offset(): number | null { return this.best?.offset ?? null; }
}
