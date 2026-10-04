/**
 * [INPUT]: Depends on untrusted renderer navigation-intent payloads and trusted renderer window IDs
 * [OUTPUT]: Provides per-renderer last-intent-wins admission and stale showSurface rejection
 * [POS]: Window-surface routing fence; local navigation can supersede an in-flight App alias before main emits a route command
 */

const INTENT_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export function parseSurfaceNavigationIntentId(value: unknown) {
  if (typeof value !== "string" || !INTENT_ID.test(value)) {
    throw new Error("Invalid surface navigation intent");
  }
  return value;
}

export class SurfaceNavigationIntents {
  private readonly latest = new Map<string, string>();

  accept(windowId: string, input: unknown) {
    const intentId = parseSurfaceNavigationIntentId(
      (input as { intentId?: unknown } | null)?.intentId
    );
    this.latest.set(windowId, intentId);
  }

  assertCurrent(windowId: string, intentId: string | undefined) {
    if (intentId === undefined) return;
    if (
      this.latest.get(windowId) !== parseSurfaceNavigationIntentId(intentId)
    ) {
      throw new Error("Surface navigation intent was superseded");
    }
  }
}
