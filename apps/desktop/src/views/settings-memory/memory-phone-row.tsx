/**
 * [INPUT]: Depends on canonical settings snapshots, the Memory plugin adapter, i18n and existing Settings/dialog primitives.
 * [OUTPUT]: Provides MemoryPhoneSection.
 * [POS]: apps/desktop/src/views/settings-memory module boundary; adjacent modules consume its explicit exports.
 */
import { useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton, SettingsList, SettingsRow, SettingsSection, SettingsSwitch } from "@/components/settings/settings-layout";
import { settingsStore } from "@/lib/settings/store/settings-store";

export function MemoryPhoneSection({ checked }: { checked: boolean }) {
  const { t } = useAppTranslation();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [retryValue, setRetryValue] = useState<boolean | null>(null);
  const save = async (memoryPhoneFacade: boolean) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); setRetryValue(null);
    const saved = await settingsStore.update({ memoryPhoneFacade }, t("memory.phone.saveFailed"), { errorScope: "local" });
    setRetryValue(saved ? null : memoryPhoneFacade);
    pending.current = false; setSaving(false);
  };
  return <SettingsSection title={t("memory.phone.sectionTitle")}>
    <SettingsList>
      <SettingsRow label={t("memory.phone.label")} htmlFor="memory-phone-facade" description={<>
        {t("memory.phone.description")}
        {retryValue !== null && <span role="alert" className="mt-1 block text-destructive">
          {t("memory.phone.saveFailed")}{" "}<SettingsButton variant="link" onClick={() => void save(retryValue)}>{t("settings.general.settingsRetry")}</SettingsButton>
        </span>}
      </>} control={<SettingsSwitch id="memory-phone-facade" label={t("memory.phone.label")} describedBy="memory-phone-facade-description"
        checked={checked} disabled={saving} onToggle={value => void save(value)} />} />
    </SettingsList>
  </SettingsSection>;
}
