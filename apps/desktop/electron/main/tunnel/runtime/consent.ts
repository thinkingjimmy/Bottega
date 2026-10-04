/**
 * [INPUT]: DurableJson, the owning computer's native consent dialog and a shared verified supply.
 * [OUTPUT]: TunnelConsent, with availability checks that never download, one durable consent and cancellation when disabled or closed.
 * [POS]: Consent is independent of the default-on plugin switch; remote requests cannot authorize downloads.
 */
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";
import type { TunnelSupply } from "./supply";

const schema = z.object({ version: z.literal(1), consentedAt: z.number().nullable(), turnedOffAt: z.number().nullable() }).strict();
export class TunnelConsent {
  private readonly file: DurableJson<z.infer<typeof schema>>;
  private controller = new AbortController();
  private asking: Promise<boolean> | null = null;
  private closed = false;
  constructor(userData: string, private readonly supply: TunnelSupply, private readonly ask: () => Promise<boolean>) {
    this.file = new DurableJson(join(userData, "tunnel-consent.json"), schema, () => ({ version: 1, consentedAt: null, turnedOffAt: null }));
  }
  initialize() { return this.file.initialize(); }
  enabled = () => !this.closed && this.file.read(value => value.turnedOffAt === null);
  consented = () => this.file.read(value => value.consentedAt !== null);
  turnedOffAt = () => this.file.read(value => value.turnedOffAt);
  async setEnabled(enabled: boolean) {
    if (!enabled) this.controller.abort();
    await this.file.mutate(value => { value.turnedOffAt = enabled ? null : Date.now(); });
    if (enabled && !this.closed) this.controller = new AbortController();
  }
  assertAvailable() {
    if (!this.supply.supported) throw new Error("tunnel-platform-unsupported");
    if (!this.enabled()) throw new Error("tunnel-plugin-disabled");
  }
  async require(origin: "desktop" | "remote") {
    this.assertAvailable();
    const signal = this.controller.signal;
    if (!this.consented()) {
      if (origin !== "desktop") throw new Error("tunnel-download-consent-required");
      this.asking ??= this.ask().finally(() => { this.asking = null; });
      if (!await this.asking) throw new Error("tunnel-download-consent-required");
      signal.throwIfAborted();
      await this.file.mutate(value => { value.consentedAt = Date.now(); });
    }
    signal.throwIfAborted();
    await this.supply.ensure(signal);
  }
  async close() { this.closed = true; this.controller.abort(); await this.file.closeAndFlush(); }
}
