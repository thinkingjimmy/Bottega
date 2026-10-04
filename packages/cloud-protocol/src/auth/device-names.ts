/**
 * [INPUT]: Depends on authenticated device-page and current-account checks supplied by the host.
 * [OUTPUT]: Provides one bounded, coalesced device-name reader per account with cancellation-safe delivery and a short cache.
 * [POS]: Transport-neutral display helper; IDs never grant access and unknown names remain null.
 */
import type { CloudDevice } from "./index";

export function createDeviceNameReader(ports: {
  assertCurrent(): Promise<void>;
  page(cursor: string | null): Promise<{ devices: CloudDevice[]; complete: boolean; cursor: string | null }>;
  now?: () => number;
}) {
  let cache: { expiresAt: number; names: Map<string, string> } | null = null;
  let flight: Promise<Map<string, string>> | null = null;
  let checking: Promise<void> | null = null;
  const current = () => checking ??= ports.assertCurrent().finally(() => { checking = null; });
  const now = ports.now ?? Date.now;
  const read = async () => {
    const names = new Map<string, string>(), seen = new Set<string>();
    let cursor: string | null = null;
    for (let index = 0; index < 32; index++) {
      await current(); const page = await ports.page(cursor); await current();
      for (const device of page.devices) if (device.kind === "desktop") names.set(device.deviceId, device.name);
      if (page.complete) { cache = { names, expiresAt: now() + 30_000 }; return names; }
      if (!page.cursor || seen.has(page.cursor)) throw new Error("device-page-incomplete");
      seen.add(page.cursor); cursor = page.cursor;
    }
    throw new Error("device-page-incomplete");
  };
  return async (deviceId: string, signal: AbortSignal): Promise<string | null> => {
    signal.throwIfAborted();
    try {
      await current(); signal.throwIfAborted();
      if (!cache || cache.expiresAt <= now()) {
        if (!flight) {
          flight = read().finally(() => { flight = null; });
        }
        await flight;
      }
      await current(); signal.throwIfAborted();
      return cache?.names.get(deviceId) ?? null;
    } catch (cause) { if (!signal.aborted) cache = null; throw cause; }
  };
}
