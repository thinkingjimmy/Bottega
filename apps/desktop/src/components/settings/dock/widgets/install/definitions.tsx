/**
 * [INPUT]: Depends on pathless installed/account Widget metadata, current instance counts and host management callbacks.
 * [OUTPUT]: Provides WidgetAccountDefinitions with distinct Add, original source editing, local uninstall and account deletion actions.
 * [POS]: Shared Settings definition directory; listing or choosing a definition never installs or executes code.
 */
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import type {
  WidgetAccountDefinition,
  WidgetInstalledDefinition,
} from "../../../../../../shared/system-dock/widgets/install/types";
type Subject = { definitionId: string; sourceInstallationId: string };
export function WidgetAccountDefinitions({
  installed,
  available,
  busy,
  onAdd,
  onInstall,
  onEdit,
  onUninstall,
  onDelete,
}: {
  installed: readonly WidgetInstalledDefinition[];
  available: readonly WidgetAccountDefinition[];
  busy: boolean;
  onAdd(key: string): void;
  onInstall(value: WidgetAccountDefinition, button: HTMLButtonElement): void;
  onEdit(value: Subject): void;
  onUninstall(value: Subject, button: HTMLButtonElement): void;
  onDelete(value: Subject, button: HTMLButtonElement): void;
}) {
  const { t } = useAppTranslation();
  return (
    <>
      {installed.length > 0 && (
        <div className="divide-y rounded-lg border">
          {installed.map((definition) => (
            <div
              key={definition.key}
              data-widget-installed-definition={definition.key}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{definition.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("systemDock.widgets.install.installed")} ·{" "}
                  {t("systemDock.widgets.impact", {
                    count: definition.instanceCount,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SettingsButton
                  variant="outline"
                  disabled={busy}
                  onClick={() => onAdd(definition.key)}
                >
                  {t("systemDock.widgets.add")}
                </SettingsButton>
                <SettingsButton
                  variant="outline"
                  disabled={busy}
                  onClick={() => onEdit(definition)}
                >
                  {t("systemDock.widgets.edit")}
                </SettingsButton>
                <SettingsButton
                  variant="outline"
                  disabled={busy}
                  onClick={(event) =>
                    onUninstall(definition, event.currentTarget)
                  }
                >
                  {t("systemDock.widgets.uninstall.confirm")}
                </SettingsButton>
                <SettingsButton
                  variant="outline"
                  disabled={busy}
                  onClick={(event) => onDelete(definition, event.currentTarget)}
                >
                  {t("systemDock.widgets.definitionDelete.confirm")}
                </SettingsButton>
              </div>
            </div>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="divide-y rounded-lg border">
          {available.map((definition) => (
            <div
              key={definition.key}
              data-widget-account-definition={definition.key}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{definition.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("systemDock.widgets.install.accountAvailable")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SettingsButton
                  variant="outline"
                  disabled={busy}
                  onClick={(event) =>
                    onInstall(definition, event.currentTarget)
                  }
                >
                  {t("systemDock.widgets.add")}
                </SettingsButton>
                <SettingsButton
                  variant="outline"
                  disabled={busy || !definition.sourceChatId}
                  onClick={() => onEdit(definition)}
                >
                  {t("systemDock.widgets.edit")}
                </SettingsButton>
                <SettingsButton
                  variant="outline"
                  disabled={busy}
                  onClick={(event) => onDelete(definition, event.currentTarget)}
                >
                  {t("systemDock.widgets.definitionDelete.confirm")}
                </SettingsButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
