/**
 * [INPUT]: Depends on lucide Keyboard, PageShell, SettingsCanvas and components/settings/keyboard-shortcuts-section
 * [OUTPUT]: Provides ShortcutsSettingsView: the Settings › Keyboard shortcuts overlay page (rebindable product shortcuts + read-only editor keys)
 * [POS]: Thin view shell of the shortcuts settings surface; all interaction and persistence live in keyboard-shortcuts-section, binding truth in lib/shortcuts
 */

import { Keyboard } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import {
  EditorKeysSection,
  KeyboardShortcutsSection,
} from "@/components/settings/keyboard-shortcuts-section";

export function ShortcutsSettingsView() {
  const { t } = useAppTranslation();
  return (
    <PageShell title={t("common.keyboardShortcuts")} icon={<Keyboard />}>
      <SettingsCanvas>
        <div className="space-y-8">
          <KeyboardShortcutsSection />
          <EditorKeysSection />
        </div>
      </SettingsCanvas>
    </PageShell>
  );
}
