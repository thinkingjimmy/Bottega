/**
 * [INPUT]: Depends on the shared SettingsEnvelope and BackendInfo contracts only; it must stay loadable from main, the sandboxed preload and the renderer.
 * [OUTPUT]: Provides STARTUP_SNAPSHOT_ARGUMENT, the StartupSnapshot shape, base64url encode/decode (decode never throws and returns a deep-frozen snapshot), the capped launch-argument builder and the renderer-side reader.
 * [POS]: The startup-snapshot transport contract; main fills it at window creation, preload publishes it, settings-store and SetupProvider consume it before the first IPC answer exists.
 */

import type { BackendInfo } from "./agent-ipc";
import type { SettingsEnvelope } from "./settings-ipc";

export const STARTUP_SNAPSHOT_ARGUMENT = "--bottega-startup-snapshot=";

/* Windows caps a whole command line at ~32 KiB and every other launch argument
   shares that budget, so the payload stays well below it rather than making the
   window uncreatable on the one platform that counts characters. */
export const STARTUP_SNAPSHOT_LIMIT = 24_000;

/**
 * Facts main already holds when it creates the window. They let the renderer's
 * onboarding gate decide on its first render instead of waiting for two IPC
 * round trips; real discovery still runs and replaces them.
 */
export type StartupSnapshot = {
  settings?: SettingsEnvelope;
  setup?: { backends: BackendInfo[] };
};

/** Which half the size cap had to drop, if any. */
export type StartupSnapshotDrop = "settings" | "all" | null;

const encodeBase64Url = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const decodeBase64Url = (value: string) => {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
};

export const encodeStartupSnapshot = (snapshot: StartupSnapshot) =>
  encodeBase64Url(JSON.stringify(snapshot));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
};

/**
 * The payload comes from our own main process through argv, so this is a shape
 * guard rather than a trust boundary: anything unreadable yields null and the
 * renderer falls back to the IPC path it would have taken anyway. The result is
 * deep-frozen: the renderer reads these facts, it never owns them.
 */
export function decodeStartupSnapshot(encoded: string): StartupSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(encoded));
    if (!isRecord(parsed)) return null;
    const settings = isRecord(parsed.settings) && typeof parsed.settings.revision === "number" &&
      isRecord(parsed.settings.settings) ? (parsed.settings as unknown as SettingsEnvelope) : undefined;
    const setup = isRecord(parsed.setup) && Array.isArray(parsed.setup.backends)
      ? { backends: parsed.setup.backends as BackendInfo[] }
      : undefined;
    return settings || setup
      ? deepFreeze({ ...(settings ? { settings } : {}), ...(setup ? { setup } : {}) })
      : null;
  } catch {
    return null;
  }
}

/**
 * Settings goes first when the payload is too large: the setup half is what
 * removes the slow round trip, while settings costs one cheap IPC read.
 */
export function startupSnapshotArgument(snapshot: StartupSnapshot): {
  launchArguments: string[];
  encodedLength: number;
  dropped: StartupSnapshotDrop;
} {
  const attempts: { snapshot: StartupSnapshot; dropped: StartupSnapshotDrop }[] = [
    { snapshot, dropped: null },
    { snapshot: { setup: snapshot.setup }, dropped: "settings" },
  ];
  for (const attempt of attempts) {
    if (!attempt.snapshot.settings && !attempt.snapshot.setup) break;
    const encoded = encodeStartupSnapshot(attempt.snapshot);
    if (encoded.length <= STARTUP_SNAPSHOT_LIMIT) {
      return {
        launchArguments: [`${STARTUP_SNAPSHOT_ARGUMENT}${encoded}`],
        encodedLength: encoded.length,
        dropped: attempt.dropped,
      };
    }
  }
  return { launchArguments: [], encodedLength: 0, dropped: "all" };
}

type SnapshotScope = { startupSnapshot?: StartupSnapshot; window?: SnapshotScope };

/** In the renderer `window` is `globalThis`; DOM tests install a jsdom window beside it. */
export function readStartupSnapshot(): StartupSnapshot | null {
  const scope = globalThis as SnapshotScope;
  return (scope.window ?? scope).startupSnapshot ?? null;
}
