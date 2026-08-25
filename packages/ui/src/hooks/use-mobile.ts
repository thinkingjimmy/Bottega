/**
 * [INPUT]: Depends on react useSyncExternalStore and browser matchMedia
 * [OUTPUT]: Provides use of IsMobile mobile switch hook
 * [POS]: The only member of hooks to provide a responsive state to the shadcn Sidebar
 */

import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const subscribe = (callback: () => void) => {
  const media = window.matchMedia(QUERY)
  media.addEventListener("change", callback)
  return () => media.removeEventListener("change", callback)
}

const getSnapshot = () => window.matchMedia(QUERY).matches
const getServerSnapshot = () => false

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
