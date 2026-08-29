/**
 * [INPUT]: Depends on lucide Info, PageShell, SettingsCanvas, AboutSection, and About i18n
 * [OUTPUT]: Provides AboutSettingsView for the Settings overlay
 * [POS]: Thin Settings › About view shell; metadata and update behavior live in AboutSection
 */

import { Info } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AboutSection } from "@/components/settings/about-section";
import { SettingsCanvas } from "@/components/settings/settings-layout";

export function AboutSettingsView() {
  const { t } = useAppTranslation();
  return (
    <PageShell title={t("settings.about.title")} icon={<Info />}>
      <SettingsCanvas>
        <AboutSection />
      </SettingsCanvas>
    </PageShell>
  );
}
