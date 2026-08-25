/**
 * [INPUT]: Depends on AppSettings, Memory consent/settings stores, sharing range IPC type and localization errors
 * [OUTPUT]: Provides useMemoryConsent: enable/cutover/sharing Common use preview→authority→mutation State machine, failed to save the pop-up window, historical selection and error ((third-level listing directly into openSharing, no longer mapped through two switches)
 * [POS]: The user can access the view-local interaction owner of views/settings-memoryPages combine only set lines and dialogs, not duplicate capability processes
 */

import { useEffect, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
import { memoryStore } from "@/lib/memory-store";
import { settingsStore } from "@/lib/settings-store";
import type {
  MemoryConsentPreview,
  MemoryConsentReason,
} from "../../../shared/memory-ipc";
import type {
  AppSettings,
  MemorySharingMode,
  MemorySettingsMutation,
} from "../../../shared/settings-ipc";

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
    if (!intent || !preview || busy) return;
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
      if (!settings) return;
      open({
        providerId,
        reason:
          providerId === settings.memory.provider ? "enable" : "cutover",
        sharingMode: settings.memory.sharingMode,
      });
    },
    openSharing(sharingMode: MemorySharingMode) {
      if (!settings) return;
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
