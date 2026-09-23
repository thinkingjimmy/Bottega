/**
 * [INPUT]: Depends on PageShell, Settings layout primitives, visible-page Setup freshness, ProviderList and Providers i18n
 * [OUTPUT]: Provides ProvidersSettingsView — only the default Agent and the Agent picker order
 * [POS]: Settings › Providers route; installation and sign-in live in Agent onboarding, CLI versions in Settings › Updates
 */

import { Server } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetupRefresh } from "@/components/providers/availability/use-setup-refresh";
import { ProviderList } from "@/components/settings/providers/provider-list";
import { SettingsCanvas, SettingsSection } from "@/components/settings/settings-layout";

export function ProvidersSettingsView() {
  const { t } = useAppTranslation();
  useSetupRefresh();
  return (
    <PageShell title={t("settings.providers.title")} icon={<Server />}>
      <SettingsCanvas>
        <SettingsSection title={t("settings.providers.title")} description={t("settings.providers.description")}>
          <ProviderList />
        </SettingsSection>
      </SettingsCanvas>
    </PageShell>
  );
}
