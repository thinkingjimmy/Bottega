/**
 * [INPUT]: Depends on React subscription primitives, the viewed-computer scope and a dynamic import of ./creation-target.
 * [OUTPUT]: Provides useViewedComputerBlock — the one sentence a create control shows for the computer being viewed.
 * [POS]: The first-paint seam of lib/cloud/computers: the sentence is five languages of shared remote copy, and the
 *   sidebar reads it only for an account that is looking at another computer, which no first frame can be.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ComputerScope } from "./scope";
type Rules = typeof import("./creation-target");
let rules: Rules | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const load = () => (loading ??= import("./creation-target").then(module => {
  rules = module;
  for (const listener of listeners) listener();
}));
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => rules;
/**
 * The sentence exists only once the account's computer list has arrived and names another computer as the one on
 * screen — until then the scope is local and the answer is null either way. Warming on that same arrival puts the
 * chunk in hand before any state that could ask for it, so the control dims exactly when it always did.
 */
export function useViewedComputerBlock(scope: Pick<ComputerScope, "computers" | "viewed" | "local" | "now">, locale: string) {
  const resolved = useSyncExternalStore(subscribe, snapshot, snapshot);
  const account = scope.computers.length > 1;
  useEffect(() => {
    if (account) void load();
  }, [account]);
  return resolved && !scope.local ? resolved.viewedComputerBlock(scope, locale) : null;
}
