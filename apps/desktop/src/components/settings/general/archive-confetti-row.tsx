/**
 * [INPUT]: Depends on React mutation state, canonical settingsStore, archive motion preference, i18n, and Settings row/switch primitives
 * [OUTPUT]: Provides ArchiveConfettiRow with last-confirmed preference, loading placeholder, and local save/retry feedback
 * [POS]: General Appearance setting; owns only the in-flight intent and never persists a second preference
 */

import { useRef, useState } from "react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useArchiveConfettiPreference } from "@/components/sidebar/archive/archive-preference";
import { SettingsButton, SettingsRow, SettingsSwitch } from "../settings-layout";
import { settingsStore } from "@/lib/settings-store";

export function ArchiveConfettiRow() {
  const { t } = useAppTranslation();
  const { settings, reducedMotion } = useArchiveConfettiPreference();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [retryValue, setRetryValue] = useState<boolean | null>(null);
  const save = async (archiveConfettiEnabled: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setRetryValue(null);
    const saved = await settingsStore.update(
      { archiveConfettiEnabled },
      t("settings.general.saveArchiveConfettiFailed"),
      { errorScope: "local" }
    );
    setRetryValue(saved ? null : archiveConfettiEnabled);
    pending.current = false;
    setSaving(false);
  };
  return <SettingsRow
    label={t("settings.general.archiveConfetti")}
    htmlFor="archive-confetti"
    description={<>
      {t("settings.general.archiveConfettiDescription")}
      {settings?.archiveConfettiEnabled && reducedMotion && <span className="mt-1 block">
        {t("settings.general.archiveConfettiReducedMotion")}
      </span>}
      {retryValue !== null && <span role="alert" className="mt-1 block text-destructive">
        {t("settings.general.saveArchiveConfettiFailed")}{" "}
        <SettingsButton variant="link" onClick={() => void save(retryValue)}>
          {t("settings.general.settingsRetry")}
        </SettingsButton>
      </span>}
    </>}
    control={settings ? <SettingsSwitch
      id="archive-confetti"
      label={t("settings.general.archiveConfetti")}
      describedBy="archive-confetti-description"
      checked={settings.archiveConfettiEnabled}
      disabled={saving}
      onToggle={(value) => void save(value)}
    /> : <Skeleton data-testid="archive-confetti-loading" className="h-6 w-11 rounded-full" />}
  />;
}
