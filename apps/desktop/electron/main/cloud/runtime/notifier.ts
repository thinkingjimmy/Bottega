/**
 * [INPUT]: Nothing; a plain listener set.
 * [OUTPUT]: Provides ChangeNotifier, the subscribe/notify pair every main cloud owner exposes.
 * [POS]: Shared main-process primitive; owners compose it instead of re-declaring their own Set.
 */
export class ChangeNotifier<T = void> {
  private readonly listeners = new Set<(value: T) => void>();
  subscribe = (listener: (value: T) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  notify(value: T) { for (const listener of this.listeners) listener(value); }
  clear() { this.listeners.clear(); }
}
