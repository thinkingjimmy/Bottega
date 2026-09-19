/**
 * [INPUT]: Depends on the memory store snapshot and runtime operations, blank config values and i18n failure text
 * [OUTPUT]: Provides useMemorySetupController — the first-run wiring MemorySetupProps need: memory store loading, an explicit engine choice, provider-bound config drafts, install, and submit as preview → write
 * [POS]: Controller behind the onboarding memory dialog; the settings page keeps its own wiring because its submit also serves already-configured engines and their consent dialog
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { blankMemoryConfigValues } from "@/components/settings/memory/memory-runtime-dialogs";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { memoryStore } from "@/lib/memory-store";
import type { MemorySetupProps } from "./memory-setup";

export function useMemorySetupController() {
  const { t } = useAppTranslation();
  const { providers, panels, runtimes, loading } = useSyncExternalStore(
    memoryStore.subscribe,
    memoryStore.getSnapshot
  );
  const [engineId, setEngineId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ providerId: string; values: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    memoryStore.ensureLoaded();
  }, []);
  const panelOf = (id: string) => {
    const provider = providers.find((item) => item.id === id);
    return panels.find((item) => item.panelId === provider?.configPanelId) ?? null;
  };
  const valuesFor = (id: string) => ({
    ...blankMemoryConfigValues(panelOf(id)),
    ...(draft?.providerId === id ? draft.values : {}),
  });
  /* First-run writes never change a consented destination — that needs the settings page's
     confirmation with its authority token — so a preview asking for one is reported, not bypassed. */
  const submit = (id: string) => {
    const values = valuesFor(id);
    setBusy(true);
    setError("");
    void memoryStore
      .previewRuntimeConfig(id, values)
      .then(async (preview) => {
        if (preview.requiresConfirmation) {
          setError(t("memory.runtime.configSaveFailed"));
          return;
        }
        const ok = await memoryStore.writeRuntimeConfig(id, values);
        if (ok) setDraft(null);
        else setError(memoryStore.getSnapshot().error || t("memory.runtime.configSaveFailed"));
      })
      .catch((cause) => setError(errorMessage(cause, t("memory.runtime.configSaveFailed"))))
      .finally(() => setBusy(false));
  };
  const props: MemorySetupProps = {
    descriptors: providers,
    runtimes,
    panels,
    selectedId: engineId,
    onSelectEngine: setEngineId,
    onInstall: (id) => {
      setEngineId(id);
      void memoryStore.runRuntimeOperation(id, "install");
    },
    getConfigValues: valuesFor,
    configBusy: busy,
    configError: error,
    onConfigChange: (providerId, values) => {
      setError("");
      setDraft({ providerId, values });
    },
    onConfigSubmit: submit,
  };
  return { props, loading, providers, runtimes };
}
