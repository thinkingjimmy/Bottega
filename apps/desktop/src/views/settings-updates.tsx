/**
 * [INPUT]: Depends on PageShell, Settings layout primitives, the Setup context, update-client stores, lib/updates CLI verdicts, the Updates rows, react-router and Updates i18n
 * [OUTPUT]: Provides UpdatesSettingsView — Bottega plus every installed provider CLI with per-row and Update all actions, the App-compatibility requirement and the preview-platform note
 * [POS]: Settings › Updates page composition; each row owns its own verdict, this file owns ordering, the page-open check and the Update all sequence
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { Download, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useSetupRefresh } from "@/components/providers/availability/use-setup-refresh";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsList,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-layout";
import { AppUpdateRow, appUpdateAction, runAppUpdate } from "@/components/settings/updates/app-update-row";
import { CliUpdateRow } from "@/components/settings/updates/cli-update-row";
import { appInfoStore, updateStore } from "@/lib/update-client";
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

  /* Opening the page is the question "is anything new?", so it asks once; there is no polling. */
  useEffect(() => {
    updateStore.ensureLoaded();
    appInfoStore.ensureLoaded();
    void updateStore.check();
  }, []);

  const providers = (setup.status?.backends ?? []).filter(isUpdatableCli);
  const outdated = providers.filter((backend) => describeCliUpdate(backend, cli).kind === "available");
  const appAction = appUpdateAction(update);
  const pending = outdated.length + (appAction === "install" || appAction === "restart" ? 1 : 0);

  const checkAll = async () => {
    setChecking(true);
    await Promise.all([updateStore.check(), ...providers.map((backend) => setup.refreshLatest(backend.id))]).catch(() => undefined);
    setChecking(false);
  };
  /* Providers first, Bottega last: installing Bottega restarts the app and would cut the queue short. */
  const updateAll = async () => {
    await Promise.all(outdated.map((backend) => cliUpdateStore.update(backend.id, backend.version)));
    if (appAction === "install" || appAction === "restart") await runAppUpdate(updateStore.getSnapshot());
  };
  const requirement = update.appRequirement;

  return (
    <PageShell title={t("settings.updates.title")} icon={<Download />}>
      <SettingsCanvas>
        {requirement && <section className="space-y-3 rounded-lg border p-4" data-testid="app-update-requirement">
          <p className="text-sm" role="status">{t("appHost.requiredContext", { name: requirement.context.candidate.appName, minimum: requirement.context.minBottegaVersion ?? "—", current: update.currentVersion })}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void navigate(`/apps?compatibility=${encodeURIComponent(requirement.context.requestId ?? "")}`)}>{t("appHost.returnToApp")}</Button>
            <Button variant="ghost" onClick={() => void updateStore.dismissAppRequirement()}>{t("appHost.dismiss")}</Button>
          </div>
        </section>}
        <SettingsSection
          title={t("settings.updates.title")}
          description={t("settings.updates.description")}
          action={pending > 0
            ? <SettingsButton onClick={() => void updateAll()}><Download />{t("settings.updates.updateAll")}</SettingsButton>
            : <SettingsButton variant="outline" disabled={checking} onClick={() => void checkAll()}>
              <RefreshCw className={checking ? "animate-spin motion-reduce:animate-none" : ""} />{t("settings.updates.check")}
            </SettingsButton>}
        >
          <SettingsList>
            <AppUpdateRow />
            {providers.map((backend) => <CliUpdateRow key={backend.id} backend={backend} />)}
          </SettingsList>
          {setup.status && providers.length === 0 && <p className="pt-3 text-muted-foreground text-xs">{t("settings.updates.empty")}</p>}
        </SettingsSection>
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
    </PageShell>
  );
}
