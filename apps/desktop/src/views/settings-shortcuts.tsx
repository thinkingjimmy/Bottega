/**
 * [INPUT]: Depends on lucide Keyboard, PageShell, SettingsCanvas and components/settings/keyboard-shortcuts-section
 * [OUTPUT]: Provides ShortcutsSettingsView: the Settings › Keyboard shortcuts overlay page (one section of rebindable product shortcuts)
 * [POS]: Thin view shell of the shortcuts settings surface; all interaction and persistence live in keyboard-shortcuts-section, binding truth in lib/shortcuts
 */

import { Keyboard } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { KeyboardShortcutsSection } from "@/components/settings/keyboard-shortcuts-section";

export function ShortcutsSettingsView() {
  const { t } = useAppTranslation();
  return (
    <PageShell title={t("common.keyboardShortcuts")} icon={<Keyboard />}>
      <SettingsCanvas>
        <KeyboardShortcutsSection />
      </SettingsCanvas>
    </PageShell>
  );
}
