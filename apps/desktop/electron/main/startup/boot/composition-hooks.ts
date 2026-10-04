/**
 * [INPUT]: Depends on type-only Memory runtime/provider/platform ports; production announces to an otherwise empty registry.
 * [OUTPUT]: Provides announceComposition/observeComposition (named composition moments with their live objects), interruptionPoint/handleInterruptions (named places another entry may make throw) and compositionOverrides (values another entry may set before startup: the Browser idle threshold, a Design render trace, a restricted Agent CLI discovery, a scripted quit confirmation).
 * [POS]: The one seam through which another entry of the same build reaches live runtime objects. Production registers nothing, so every call is a lookup on an empty map; the private E2E entry (electron/main/e2e, never exported) is the only observer (F-01).
 */

import type { ManagedRuntimeRegistry } from "../../memory/runtime/managed-registry";
import type { MemoryProvider } from "../../memory/core/provider";
import type { PlatformCapabilities } from "../../../../shared/platform/platform-capabilities";

export type CompositionMoment = "foundation" | "builtin-tools" | "memory";
const observers = new Map<CompositionMoment, Array<(value: unknown) => void>>();

/** Called by composition code once the named objects exist; with no observer it does nothing. */
export function announceComposition<T>(moment: CompositionMoment, value: T) {
  for (const observe of observers.get(moment) ?? []) observe(value);
}
export function observeComposition<T>(moment: CompositionMoment, observe: (value: T) => void) {
  observers.set(moment, [...observers.get(moment) ?? [], observe as (value: unknown) => void]);
}

export type InterruptionPoint = "deferred-recovery" | "terminal-owner";
let interruption: ((point: InterruptionPoint, name: string) => void) | null = null;
/** A named deferred recovery task or shutdown owner; a registered handler may throw here, nothing else happens. */
export function interruptionPoint(point: InterruptionPoint, name: string) { interruption?.(point, name); }
export function handleInterruptions(handler: (point: InterruptionPoint, name: string) => void) { interruption = handler; }

export const compositionOverrides: {
  memoryRuntime?: (root: string, platformSupport: PlatformCapabilities) => { runtimes: ManagedRuntimeRegistry; providerFactory: (providerId: string, baseUrl: string) => MemoryProvider };
  browserSleepAfterMs?: number;
  designRenderTrace?: (stage: string) => void;
  /** Agent CLI discovery restricted to one search PATH per command (null: not discoverable); no login shell, no common paths. */
  agentDiscovery?: (command: string) => string | null;
  /** A scripted answer to the stop-and-quit confirmation, for a packaged run no one can click (true: stop the tasks and quit). */
  quitConfirmation?: () => boolean;
} = {};
