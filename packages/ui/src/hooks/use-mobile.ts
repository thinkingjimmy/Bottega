/**
 * [INPUT]: Depends on react useSyncExternalStore and browser matchMedia
 * [OUTPUT]: Provides useIsMobile (viewport below 768px) and useCoarsePointer (touch-first pointer) media-query hooks
 * [POS]: The only hooks member that exposes responsive state, consumed by the shadcn Sidebar, the Cloud Web shell/routes and shared Base views
 */

import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768

// One store per query keeps subscribe/snapshot referentially stable, so
// useSyncExternalStore never resubscribes; the server snapshot is always false.
function mediaStore(query: string) {
  return {
    subscribe(callback: () => void) {
      const media = window.matchMedia(query)
      media.addEventListener("change", callback)
      return () => media.removeEventListener("change", callback)
    },
    snapshot: () => window.matchMedia(query).matches,
  }
}

const getServerSnapshot = () => false
const mobile = mediaStore(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
const coarsePointer = mediaStore("(pointer: coarse)")

/** Viewport narrower than 768px: the shell switches to drawer navigation and fill layouts. */
export function useIsMobile() {
  return useSyncExternalStore(mobile.subscribe, mobile.snapshot, getServerSnapshot)
}

/** Primary pointer is coarse (touch): inline editors and autofocus give way to tap-first flows. */
export function useCoarsePointer() {
  return useSyncExternalStore(coarsePointer.subscribe, coarsePointer.snapshot, getServerSnapshot)
}
