/**
 * [INPUT]: Depends on the shared SettingsPreferenceSelect, the language preference list, settingsStore and the renderer i18n provider.
 * [OUTPUT]: Provides LANGUAGE_OPTIONS and LanguageSelect, the one control that persists the interface language.
 * [POS]: components/settings/general; consumed by Settings › General and the onboarding brand row, so both change language the same way.
 */
import { SettingsPreferenceSelect } from "@ai-chat/ui/components/settings/preference-select";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import type { LanguagePreference } from "@ai-chat/ui/lib/locale";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { settingsStore } from "@/lib/settings/store/settings-store";

export const LANGUAGE_OPTIONS: Array<{
  emoji: string;
  label?: string;
  labelKey?: "settings.general.autoDetect";
  value: LanguagePreference;
}> = [
  { emoji: "🌐", labelKey: "settings.general.autoDetect", value: "auto" },
  { emoji: "🇨🇳", label: "简体中文", value: "zh-CN" },
  { emoji: "🇺🇸", label: "English", value: "en" },
  { emoji: "🇯🇵", label: "日本語", value: "ja" },
  { emoji: "🇫🇷", label: "Français", value: "fr" },
  { emoji: "🇪🇸", label: "Español", value: "es" },
];

export function LanguageSelect({
  language,
  className,
  standalone = false,
}: {
  language: LanguagePreference | null;
  className?: string;
  /** Outside a Settings row there is no row description for the trigger to point at. */
  standalone?: boolean;
}) {
  const { t } = useAppTranslation();
  if (!language) return <Skeleton className="h-8 w-48 shrink-0" />;
  return (
    <SettingsPreferenceSelect
      id="language-preference"
      label={t("settings.general.language")}
      value={language}
      className={className}
      describedBy={standalone ? null : undefined}
      options={LANGUAGE_OPTIONS.map((option) => ({
        value: option.value,
        emoji: option.emoji,
        label: option.labelKey ? t(option.labelKey) : option.label!,
      }))}
      onValueChange={(value) => {
        const option = LANGUAGE_OPTIONS.find((entry) => entry.value === value);
        if (option)
          void settingsStore.update(
            { language: option.value },
            t("settings.general.saveLanguageFailed"),
          );
      }}
    />
  );
}
