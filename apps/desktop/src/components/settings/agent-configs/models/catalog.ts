/**
 * [INPUT]: Depends on the shared settings model cache and read-only Provider defaults client.
 * [OUTPUT]: Provides useConfigModels with Provider-scoped catalogs, saved defaults and independent retry states.
 * [POS]: Agent configuration model discovery; never changes Chat options or remembered defaults.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentTurnOptions, BackendModelInfo } from "../../../../../shared/ipc/agent/agent-ipc";
import { isAgentBackendId } from "@/lib/agent/agent-backends";
import { getBackendDefaults } from "@/lib/settings/client/settings-client";
import { settingsStore } from "@/lib/settings/store/settings-store";

const EMPTY_MODELS: BackendModelInfo[] = [];
type DefaultsResult = { provider: string; attempt: number; value?: AgentTurnOptions; failed: boolean };

export function useConfigModels(provider: string) {
  const snapshot = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<DefaultsResult | null>(null);
  const backend = isAgentBackendId(provider) ? provider : null;
  useEffect(() => {
    if (!backend) return;
    let live = true;
    settingsStore.ensureModels(backend);
    void getBackendDefaults(backend).then(
      value => { if (live) setResult({ provider: backend, attempt, value, failed: false }); },
      () => { if (live) setResult({ provider: backend, attempt, failed: true }); },
    );
    return () => { live = false; };
  }, [backend, attempt]);
  const defaults = result?.provider === provider && result.attempt === attempt ? result : null;
  const models = backend ? snapshot.modelsByBackend[backend] ?? EMPTY_MODELS : EMPTY_MODELS;
  const failed = Boolean(backend && snapshot.modelsErrorByBackend[backend]);
  const loading = Boolean(backend && !snapshot.modelsReadyByBackend[backend] && !failed);
  return {
    models, loading, failed, supported: backend !== null,
    defaults: defaults?.value,
    defaultsLoading: Boolean(backend && !defaults),
    defaultsFailed: defaults?.failed ?? false,
    retry: () => {
      if (!backend) return;
      settingsStore.retryModels(backend);
      setAttempt(value => value + 1);
    },
  };
}
