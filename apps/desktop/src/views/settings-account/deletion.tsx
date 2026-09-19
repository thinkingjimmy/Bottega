/**
 * [INPUT]: Depends on fixed main-owned browser opening, shared account erasure copy, Lucide Trash2 and settings primitives.
 * [OUTPUT]: Provides DeleteCloudAccount — the settings page's destructive row that opens the browser review; the final confirmation runs in the trusted same-origin browser flow.
 * [POS]: Desktop account deletion entry; nothing here transports credentials or deletes anything itself.
 */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { accountDeletionCopy } from "@ai-chat/ui/lib/account-deletion-copy";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { cloudAccountClient } from "@/lib/cloud/client";
import { SettingsButton, SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-layout";
export function DeleteCloudAccount() {
  const { i18n } = useAppTranslation(), copy = accountDeletionCopy(i18n.language);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  return <SettingsSection title={copy.title} description={copy.local} alert={failed ? copy.failed : undefined}>
    <SettingsList><SettingsRow label={copy.title} description={copy.browser} tone="destructive"
      control={<SettingsButton variant="destructive" disabled={busy} onClick={() => {
        if (busy) return; setBusy(true); setFailed(false);
        void cloudAccountClient().openAccountDeletion().catch(() => setFailed(true)).finally(() => setBusy(false));
      }}><Trash2 />{copy.action}</SettingsButton>} /></SettingsList>
  </SettingsSection>;
}
