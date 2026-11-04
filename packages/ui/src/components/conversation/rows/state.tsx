/**
 * [INPUT]: React context and external-store subscriptions, transcript scope and stable row/item identities.
 * [OUTPUT]: TranscriptStateProvider, TranscriptRowState and useRowDisclosure retain up to 500 disclosure values across row recycling.
 * [POS]: Shared transcript-local UI memory; the keyed provider expires all state on conversation/incarnation changes.
 */
import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from "react";

function createDisclosureStore() {
  const values = new Map<string, boolean>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    read: (key: string) => values.get(key) ?? false,
    write(key: string, action: SetStateAction<boolean>) {
      const previous = values.get(key) ?? false;
      const next = typeof action === "function" ? action(previous) : action;
      values.delete(key);
      values.set(key, next);
      while (values.size > 500) {
        const oldest = values.keys().next().value!;
        const expanded = values.get(oldest);
        values.delete(oldest);
        if (expanded) listeners.get(oldest)?.forEach(listener => listener());
      }
      if (next !== previous) listeners.get(key)?.forEach(listener => listener());
    },
    subscribe(key: string, listener: () => void) {
      if (values.has(key)) {
        const value = values.get(key)!;
        values.delete(key);
        values.set(key, value);
      }
      let group = listeners.get(key);
      if (!group) listeners.set(key, group = new Set());
      group.add(listener);
      return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
    },
  };
}
const Store = createContext<ReturnType<typeof createDisclosureStore> | null>(null);
const Row = createContext<string | null>(null);
export function TranscriptStateProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createDisclosureStore);
  return <Store.Provider value={store}>{children}</Store.Provider>;
}
export function TranscriptRowState({ id, children }: { id: string; children: ReactNode }) {
  return <Row.Provider value={id}>{children}</Row.Provider>;
}
export function useRowDisclosure(item: string) {
  const store = useContext(Store), row = useContext(Row);
  const key = JSON.stringify([row, item]);
  const [local, setLocal] = useState(false);
  const subscribe = useCallback((listener: () => void) => store && row ? store.subscribe(key, listener) : () => {}, [key, row, store]);
  const read = useCallback(() => store && row ? store.read(key) : local, [key, local, row, store]);
  const value = useSyncExternalStore(subscribe, read, read);
  const set = useCallback((action: SetStateAction<boolean>) => { if (store && row) store.write(key, action); else setLocal(action); }, [key, row, store]);
  return [value, set] as const;
}
