/**
 * [INPUT]: Depends on React external-store subscriptions, canonical settingsStore, and the system reduced-motion media query
 * [OUTPUT]: Provides useArchiveConfettiPreference and live playback eligibility without initiating settings reads
 * [POS]: Shared effective preference for the Sidebar action, General setting, and window celebration host
 */

import { useSyncExternalStore } from "react";
import { settingsStore } from "@/lib/settings-store";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
let owner: Window | undefined;
let media: MediaQueryList | undefined;

function motionQuery() {
  if (owner !== window) {
    owner = window;
    media = window.matchMedia(MOTION_QUERY);
  }
  return media!;
}

const reducedMotion = () => motionQuery().matches;
const subscribeMotion = (listener: () => void) => {
  const query = motionQuery();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

export function useArchiveConfettiPreference() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion);
  return { settings, reducedMotion: reduced, enabled: Boolean(settings?.archiveConfettiEnabled && !reduced) };
}

export function canPlayArchiveConfetti() {
  return Boolean(settingsStore.getSnapshot().settings?.archiveConfettiEnabled)
    && !reducedMotion()
    && document.visibilityState === "visible"
    && document.hasFocus();
}
