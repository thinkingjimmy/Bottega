/**
 * [INPUT]: Receives explicit modal ownership tokens from stable renderer hosts.
 * [OUTPUT]: Provides synchronous acquire/release, global-shortcut suppression and modal-aware automatic focus admission.
 * [POS]: Shared keyboard scope checked by independent window keydown listeners and native composer autofocus.
 */
const scopes = new Set<symbol>();
export function acquireModalKeyboardScope() {
  const token = Symbol("modal-keyboard");
  scopes.add(token);
  return () => {
    scopes.delete(token);
  };
}
export const hasModalKeyboardScope = () => scopes.size > 0;
