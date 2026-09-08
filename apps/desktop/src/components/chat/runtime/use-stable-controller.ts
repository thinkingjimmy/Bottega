/**
 * [INPUT]: Depends on React use LayoutEffect/useState with arbitrary controller field objects
 * [OUTPUT]: Provides useStableController; Only the last committed snapshot, layout commit, is rendered to release the new object
 * [POS]: Stable object-identity helper for chat/runtime, shared by controller hooks that need Object.is-stable field sets across renders
 */

import { useLayoutEffect, useState } from "react";

function sameFields<T extends Record<string, unknown>>(left: T, right: T) {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  );
}

export function useStableController<T extends Record<string, unknown>>(
  value: T
): T {
  const [store] = useState(() => {
    let committed = value;
    return {
      publish(next: T) {
        committed = next;
      },
      snapshot(candidate: T) {
        return sameFields(committed, candidate) ? committed : candidate;
      },
    };
  });
  const stable = store.snapshot(value);
  useLayoutEffect(() => store.publish(stable), [stable, store]);
  return stable;
}
