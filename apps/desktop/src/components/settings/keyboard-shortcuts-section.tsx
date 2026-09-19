/**
 * [INPUT]: Shared ShortcutSettings/copy, native binding policy, settingsStore and platform identity.
 * [OUTPUT]: KeyboardShortcutsSection backed by native settings with capability-filtered product rows.
 * [POS]: Native shortcut settings adapter; shared UI owns recording and row presentation.
 */
import { useEffect, useSyncExternalStore } from "react";
import { ShortcutSettings } from "@ai-chat/ui/components/settings/shortcuts/section";
import { getShortcutCopy } from "@ai-chat/ui/lib/shortcuts/copy";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { isApplePlatform } from "@/lib/platform";
import { settingsStore } from "@/lib/settings-store";
import {
  captureBinding,
  conflictingShortcutIds,
  SHORTCUT_IDS,
  useShortcutBindings,
} from "@/lib/shortcuts";
export function KeyboardShortcutsSection() {
  const { i18n } = useAppTranslation(),
    copy = getShortcutCopy(i18n.resolvedLanguage ?? i18n.language);
  const bindings = useShortcutBindings(),
    snapshot = useSyncExternalStore(
      settingsStore.subscribe,
      settingsStore.getSnapshot,
    );
  useEffect(() => settingsStore.ensureLoaded(), []);
  const overrides = snapshot.settings?.keyboardShortcuts,
    conflicts = conflictingShortcutIds(bindings);
  return (
    <ShortcutSettings
      copy={copy}
      apple={isApplePlatform()}
      error={snapshot.error}
      capture={captureBinding}
      hasOverrides={Object.keys(overrides ?? {}).length > 0}
      rows={SHORTCUT_IDS.filter(
        (id) => id !== "taskPanel" || isApplePlatform(),
      ).map((id) => ({
        id,
        label: copy.labels[id],
        hint:
          id in copy.hints
            ? copy.hints[id as keyof typeof copy.hints]
            : undefined,
        binding: bindings[id],
        overridden: overrides?.[id] !== undefined,
        conflicts: conflicts.get(id)?.map((other) => copy.labels[other]),
      }))}
      onChange={async (id, value) => {
        await settingsStore.update((current) => {
          const next = { ...current.keyboardShortcuts };
          if (value === undefined) delete next[id];
          else next[id] = value;
          return { keyboardShortcuts: next };
        }, copy.saveFailed);
      }}
      onRestore={async () => {
        await settingsStore.update(
          { keyboardShortcuts: {} },
          copy.restoreFailed,
        );
      }}
    />
  );
}
