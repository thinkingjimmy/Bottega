/**
 * [INPUT]: Depends on React and the main-owned AgentConfigBridge list, change subscription and canonical mutation results.
 * [OUTPUT]: Provides useAgentConfigsState with distinct loading/failure/unavailable states, retry and canonical saves.
 * [POS]: Agent configuration page state; owns read ordering without changing an open editor's draft.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentConfigBridge, AgentConfigView } from "@ai-chat/cloud-protocol/agent-config/bridge";
import type { AgentConfigPayload } from "@ai-chat/cloud-protocol/agent-config/payload";

type ListState = {
  configs: AgentConfigView[] | null;
  loading: boolean;
  error: "load" | "refresh" | "unavailable" | null;
};
type Snapshot = ListState & { bridge: AgentConfigBridge | null };
type Owner = {
  bridge: AgentConfigBridge;
  read(): void;
  save(payload: AgentConfigPayload, configId?: string): Promise<void>;
};

const initialState = (bridge: AgentConfigBridge | null): Snapshot => ({
  bridge, configs: null, loading: Boolean(bridge), error: bridge ? null : "unavailable",
});

export function useAgentConfigsState(bridge: AgentConfigBridge | null) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => initialState(bridge));
  const ownerRef = useRef<Owner | null>(null);

  useEffect(() => {
    if (!bridge) {
      ownerRef.current = null;
      return;
    }
    const host = bridge;
    let active = true;
    let request = 0;
    let writes = 0;
    let stop: (() => void) | null = null;
    let subscribing = false;
    let current = initialState(bridge);
    const publish = (next: ListState) => {
      current = { ...next, bridge };
      if (active) setSnapshot(current);
    };
    function read() {
      // Every completed write refreshes; notifications during a write must not read its old state.
      if (!active || writes > 0 || subscribing) return;
      if (!stop) {
        subscribing = true;
        try {
          stop = host.onChanged(read);
        } catch {
          ++request;
          publish({ ...current, loading: false, error: current.configs === null ? "load" : "refresh" });
          return;
        } finally {
          subscribing = false;
        }
      }
      const sequence = ++request;
      publish({ ...current, loading: true, error: null });
      void (async () => {
        try {
          const configs = await host.list();
          if (active && sequence === request) publish({ configs, loading: false, error: null });
        } catch {
          if (active && sequence === request) {
            publish({ ...current, loading: false, error: current.configs === null ? "load" : "refresh" });
          }
        }
      })();
    }
    const owner: Owner = {
      bridge,
      read,
      async save(payload, configId) {
        if (!active) throw new Error("agent-configs-unavailable");
        ++request;
        ++writes;
        publish({ ...current, loading: false });
        try {
          const saved = configId ? await bridge.update(configId, payload) : await bridge.create(payload);
          if (!active) return;
          ++request;
          const configs = current.configs ?? [];
          const exists = configs.some(config => config.configId === saved.configId);
          publish({ ...current, configs: exists
            ? configs.map(config => config.configId === saved.configId ? saved : config)
            : [...configs, saved] });
        } finally {
          --writes;
          // The mutation receipt is authoritative. A separate read failure must never turn a successful save into an error.
          if (active && writes === 0) read();
        }
      },
    };
    ownerRef.current = owner;
    read();
    return () => {
      active = false;
      ++request;
      stop?.();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [bridge]);

  const retry = useCallback(() => {
    const owner = ownerRef.current;
    if (owner && owner.bridge === bridge) owner.read();
    // Re-rendering also rechecks the page's default bridge getter if preload becomes available.
    else setSnapshot(current => ({ ...current }));
  }, [bridge]);
  const save = useCallback(async (payload: AgentConfigPayload, configId?: string) => {
    const owner = ownerRef.current;
    if (!owner || owner.bridge !== bridge) throw new Error("agent-configs-unavailable");
    await owner.save(payload, configId);
  }, [bridge]);
  const state = snapshot.bridge === bridge ? snapshot : initialState(bridge);
  return { configs: state.configs, loading: state.loading, error: state.error, retry, save };
}
