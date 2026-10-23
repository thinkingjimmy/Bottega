/**
 * [INPUT]: Canonical persistence and source terminal facts.
 * [OUTPUT]: One draft visibility and activity policy independent of execution locks.
 * [POS]: Portable turn presentation used by native and remote consumers.
 */
export function turnPresentation(persist: string | undefined, terminal: string | null | undefined) {
  return { visible: !["stored", "empty", "missing"].includes(persist ?? ""), active: !terminal };
}
