/**
 * [INPUT]: Depends on SettingsPage, Settings layout primitives, the Setup context, update-client stores, lib/updates CLI verdicts, the Updates rows, react-router and Updates i18n
 * [OUTPUT]: Provides UpdatesSettingsView — Bottega plus every installed provider CLI with a grouped title/description, fixed page/row actions and download-only Update all, the App-compatibility requirement and the preview-platform note
 * [POS]: apps/desktop/src/views/settings/updates; Settings › Updates page composition; each row owns its own verdict, this file owns ordering, the page-open check and the Update all sequence
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { TriangleAlert } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useSetupRefresh } from "@/components/providers/availability/use-setup-refresh";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-layout";
import { AppUpdateRow, appUpdateAction } from "@/components/settings/updates/app-update-row";
import { CliUpdateRow } from "@/components/settings/updates/cli-update-row";
import { UpdateList } from "@/components/settings/updates/update-row";
import { appInfoStore, updateStore } from "@/lib/platform/update-client";
import { cliUpdateStore, describeCliUpdate, isUpdatableCli } from "@/lib/updates/cli-updates";

export function UpdatesSettingsView() {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const setup = useSetup();
  useSetupRefresh();
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot);
  const appInfo = useSyncExternalStore(appInfoStore.subscribe, appInfoStore.getSnapshot);
  const cli = useSyncExternalStore(cliUpdateStore.subscribe, cliUpdateStore.getSnapshot);
  const [checking, setChecking] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);

  /* Opening the page is the question "is anything new?", so it asks once; there is no polling. */
  useEffect(() => {
    updateStore.ensureLoaded();
    appInfoStore.ensureLoaded();
    void updateStore.check();
  }, []);

  const providers = (setup.status?.backends ?? []).filter(isUpdatableCli);
  const outdated = providers.filter((backend) => describeCliUpdate(backend, cli).kind === "available");
  const appAction = appUpdateAction(update);
  const pending = outdated.length + (appAction === "install" ? 1 : 0);
  const busy = checking || updatingAll || cli.updating.size > 0 || ["checking", "downloading", "installing"].includes(update.phase);

  const checkAll = async () => {
    if (busy) return;
    setChecking(true);
    await Promise.all([updateStore.check(), ...providers.map((backend) => setup.refreshLatest(backend.id))]).catch(() => undefined);
    setChecking(false);
  };
  /* Bulk updates may download Bottega, but only its explicit row action may restart it. */
  const updateAll = async () => {
    if (busy || pending === 0) return;
    setUpdatingAll(true);
    try {
      await Promise.all(outdated.map((backend) => cliUpdateStore.update(backend.id, backend.version)));
      if (appAction === "install" && appUpdateAction(updateStore.getSnapshot()) === "install") {
        await updateStore.downloadAndInstall();
      }
    } finally {
      setUpdatingAll(false);
    }
  };
  const requirement = update.appRequirement;

  return (
    <SettingsPage title={t("settings.updates.title")} description={t("settings.updates.description")} actions={<>
      <SettingsButton variant="outline" disabled={busy} aria-busy={checking || update.phase === "checking"} onClick={() => void checkAll()}>
        {t("settings.updates.check")}
      </SettingsButton>
      <SettingsButton aria-busy={updatingAll} disabled={busy || pending === 0} onClick={() => void updateAll()}>{t("settings.updates.updateAll")}</SettingsButton>
    </>}>
      <SettingsCanvas>
        {requirement && <section className="space-y-3 rounded-lg border p-4" data-testid="app-update-requirement">
          <p className="text-sm" role="status">{t("appHost.requiredContext", { name: requirement.context.candidate.appName, minimum: requirement.context.minBottegaVersion ?? "—", current: update.currentVersion })}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void navigate(`/apps?compatibility=${encodeURIComponent(requirement.context.requestId ?? "")}`)}>{t("appHost.returnToApp")}</Button>
            <Button variant="ghost" onClick={() => void updateStore.dismissAppRequirement()}>{t("appHost.dismiss")}</Button>
          </div>
        </section>}
        <section aria-label={t("settings.updates.title")} className="space-y-4">
          <UpdateList>
            <AppUpdateRow disabled={checking || updatingAll || cli.updating.size > 0} />
            {providers.map((backend) => <CliUpdateRow key={backend.id} backend={backend} disabled={checking || updatingAll} />)}
          </UpdateList>
          {setup.status && providers.length === 0 && <p className="text-xs text-muted-foreground">{t("settings.updates.empty")}</p>}
        </section>
        {appInfo?.platformSupport.tier === "preview" && (
          <SettingsSection title={t("settings.updates.platformSupport")} description={t("settings.updates.previewDescription")}>
            <SettingsSurface className="px-4 py-3">
              <p className="flex items-center gap-2 font-medium text-sm">
                <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
                {t("settings.updates.preview", { platform: appInfo.platform })}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground text-xs">
                {Object.entries(appInfo.platformSupport.capabilities)
                  .filter(([, available]) => !available)
                  .map(([capability]) => <li key={capability}>{t(`settings.updates.features.${capability}`)}</li>)}
              </ul>
            </SettingsSurface>
          </SettingsSection>
        )}
      </SettingsCanvas>
    </SettingsPage>
  );
}
