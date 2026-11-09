/**
 * [INPUT]: Depends on SettingsPage, SettingsCanvas and components/settings/keyboard-shortcuts-section
 * [OUTPUT]: Provides ShortcutsSettingsView with one page title, its description, a trailing restore action only for modified shortcuts, and rebindable shortcut rows.
 * [POS]: apps/desktop/src/views/settings/shortcuts; Thin view shell of the shortcuts settings surface; all interaction and persistence live in keyboard-shortcuts-section, binding truth in lib/shortcuts
 */


import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { KeyboardShortcutsSection } from "@/components/settings/keyboard-shortcuts-section";

export function ShortcutsSettingsView() {
  const { t } = useAppTranslation();
  return (
    <KeyboardShortcutsSection>
      {({ description, actions, content }) => (
        <SettingsPage title={t("common.keyboardShortcuts")} description={description} actions={actions}>
          <SettingsCanvas>{content}</SettingsCanvas>
        </SettingsPage>
      )}
    </KeyboardShortcutsSection>
  );
}
