/**
 * [INPUT]: Depends on the fixed cloud account IPC client, five-language cloud copy and the Settings button primitive.
 * [OUTPUT]: Provides RetryConnectionButton — the one control that re-runs a failed handshake from Settings.
 * [POS]: Shared by the Account banner and the unavailable Sync row; main owns the re-check and keeps the banner on failure.
 */
import { useState, type ComponentProps } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { cloudAccountClient } from "@/lib/cloud/client";

/* The check either clears the banner or leaves it saying exactly what it already said,
   so a failure needs no message of its own — only the button has to stop looking busy. */
export function RetryConnectionButton({ variant }: { variant?: ComponentProps<typeof SettingsButton>["variant"] }) {
  const { t } = useAppTranslation(), [busy, setBusy] = useState(false);
  const retry = () => {
    if (busy) return; setBusy(true);
    void cloudAccountClient().retryConnection().catch(() => {}).finally(() => setBusy(false));
  };
  return <SettingsButton variant={variant} disabled={busy} aria-busy={busy} onClick={retry}>{t(busy ? "cloud.retrying" : "cloud.retry")}</SettingsButton>;
}
