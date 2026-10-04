/**
 * [INPUT]: Depends on SettingsPage, Settings layout primitives, visible-page Setup freshness, ProviderList and Providers i18n
 * [OUTPUT]: Provides ProvidersSettingsView — only the default Agent and the Agent picker order
 * Explains protected GitHub and Git credentials and the terminal alternative for enterprise CA tools.
 * [POS]: apps/desktop/src/views/settings/providers; Settings › Providers route; installation and sign-in live in Agent onboarding, CLI versions in Settings › Updates
 */


import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useSetupRefresh } from "@/components/providers/availability/use-setup-refresh";
import { ProviderList } from "@/components/settings/providers/provider-list";
import { SettingsCanvas, SettingsSection } from "@/components/settings/settings-layout";

export function ProvidersSettingsView() {
  const { t } = useAppTranslation();
  useSetupRefresh();
  return (
    <SettingsPage title={t("settings.providers.title")}>
      <SettingsCanvas>
        <SettingsSection title={t("settings.providers.title")} description={t("settings.providers.description")}>
          <ProviderList />
        </SettingsSection>
        <SettingsSection title={t("settings.providers.toolAccess")}><p className="text-sm text-muted-foreground">{t("settings.providers.toolAccessHint")}</p></SettingsSection>
      </SettingsCanvas>
    </SettingsPage>
  );
}
