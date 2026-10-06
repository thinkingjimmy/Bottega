/**
 * [INPUT]: Depends on AppSettings, Memory consent/settings stores, sharing range IPC type and localization errors
 * [OUTPUT]: Provides useMemoryConsent: a shared enable/cutover/sharing preview→confirm→mutation state machine with save-failure surfacing, history-inclusion choice, and plugin-disable cancellation fences; third-tier sharing options map directly into openSharing instead of two chained switches
 * [POS]: views/settings-memory's view-local interaction owner; pages compose only rows and dialogs from it, never re-implementing its capability flow
 */

import { useEffect, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { memoryStore } from "@/lib/memory/memory-store";
import { settingsStore } from "@/lib/settings/store/settings-store";
import type {
  MemoryConsentPreview,
  MemoryConsentReason,
} from "../../../shared/ipc/content/memory-ipc";
import type {
  AppSettings,
  MemorySharingMode,
  MemorySettingsMutation,
} from "../../../shared/ipc/settings/settings-ipc";

type ConsentIntent = Readonly<{
  providerId: string;
  reason: Exclude<MemoryConsentReason, "rebuild">;
  sharingMode: MemorySharingMode;
}>;

export function useMemoryConsent(settings: AppSettings | null) {
  const { t } = useAppTranslation();
  const [intent, setIntent] = useState<ConsentIntent | null>(null);
  const [includeHistory, updateIncludeHistory] = useState(false);
  const [preview, setPreview] = useState<MemoryConsentPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    let enabled = settingsStore.getSnapshot().settings?.memory.pluginEnabled;
    const release = settingsStore.subscribe(() => {
      const next = settingsStore.getSnapshot().settings?.memory.pluginEnabled;
      if (enabled === next) return;
      enabled = next;
      if (next) return;
      generation.current += 1;
      setIntent(null);
      setPreview(null);
    });
    return () => { release(); generation.current += 1; };
  }, []);

  useEffect(() => {
    if (!intent) return;
    let current = true;
    void memoryStore
      .previewConsent(
        intent.providerId,
        includeHistory,
        intent.reason,
        intent.sharingMode
      )
      .then((next) => {
        if (current) setPreview(next);
      })
      .catch((cause) => {
        if (current) {
          setError(errorMessage(cause, t("memory.sharing.previewFailed")));
        }
      });
    return () => {
      current = false;
    };
  }, [includeHistory, intent, t]);

  const open = (next: ConsentIntent) => {
    updateIncludeHistory(false);
    setPreview(null);
    setError("");
    setIntent(next);
  };

  const close = () => {
    if (busy) return;
    setIntent(null);
  };

  const mutationFor = (
    authorityToken: string,
    value: ConsentIntent
  ): MemorySettingsMutation => {
    if (value.reason === "sharing") {
      return {
        kind: "set-sharing-with-consent",
        sharingMode: value.sharingMode,
        authorityToken,
      };
    }
    return value.reason === "enable"
      ? { kind: "enable-with-consent", authorityToken }
      : {
          kind: "cutover-with-consent",
          providerId: value.providerId,
          authorityToken,
        };
  };

  const accept = async () => {
    if (!intent || !preview || busy || !settings?.memory.pluginEnabled) return;
    const request = generation.current;
    setBusy(true);
    setError("");
    try {
      const authority = await memoryStore.requestConsentAuthority(
        intent.providerId,
        includeHistory,
        intent.reason,
        intent.sharingMode,
        preview.digest
      );
      if (request !== generation.current || !settingsStore.getSnapshot().settings?.memory.pluginEnabled) return;
      const ok = await settingsStore.mutateMemory(
        mutationFor(authority.token, intent),
        t("memory.page.consentFailed")
      );
      if (ok) {
        setIntent(null);
        return;
      }
      setError(
        settingsStore.getSnapshot().error || t("memory.page.consentFailed")
      );
    } catch (cause) {
      setError(errorMessage(cause, t("memory.page.consentFailed")));
    } finally {
      setBusy(false);
    }
  };

  return {
    intent,
    preview,
    includeHistory,
    busy,
    error,
    openProvider(providerId: string) {
      if (!settings?.memory.pluginEnabled) return;
      open({
        providerId,
        reason:
          providerId === settings.memory.provider ? "enable" : "cutover",
        sharingMode: settings.memory.sharingMode,
      });
    },
    openSharing(sharingMode: MemorySharingMode) {
      if (!settings?.memory.pluginEnabled) return;
      open({
        providerId: settings.memory.provider,
        reason: "sharing",
        sharingMode,
      });
    },
    setOpen(next: boolean) {
      if (!next) close();
    },
    setIncludeHistory(next: boolean) {
      setPreview(null);
      setError("");
      updateIncludeHistory(next);
    },
    accept,
  };
}
