/**
 * [INPUT]: Depends on the packaged application identity, immutable scheme and current login state.
 * [OUTPUT]: Selects polling-only for source runs, registers packaged schemes and validates state-only callbacks.
 * [POS]: Deep links only focus the application; credential exchange always stays in main polling.
 */
import type { LoginReturnMode } from "@ai-chat/cloud-protocol";
export function configureLoginReturn(app: { isPackaged: boolean; setAsDefaultProtocolClient(scheme: string): boolean },
  scheme: "bottega" | "bottega-dev"): LoginReturnMode {
  if (!app.isPackaged) return "polling-only";
  app.setAsDefaultProtocolClient(scheme);
  return "protocol";
}
export function acceptsCloudCallback(input: string, scheme: string, expectedState: string | null): boolean {
  if (!expectedState || input.length > 512) return false;
  try {
    const url = new URL(input);
    return url.protocol === scheme + ":" && url.hostname === "auth" && !url.port && !url.username && !url.password &&
      url.pathname === "/callback" && !url.hash && [...url.searchParams.keys()].length === 1 &&
      url.searchParams.getAll("state").length === 1 && url.searchParams.get("state") === expectedState;
  } catch { return false; }
}
