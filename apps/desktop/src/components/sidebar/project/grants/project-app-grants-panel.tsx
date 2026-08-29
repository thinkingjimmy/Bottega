"use client";

/**
 * [INPUT]: Depends on AppsProvider records/loading/list warning, Project projection passed by the caller, App grant mutations, settings primitives, and i18n
 * [OUTPUT]: Provides ProjectAppGrantsPanel with honest loading/failure/empty projections, grant/revoke/disable mutations, and no local catalog or grant snapshot
 * [POS]: Shared Project-to-App capability editor used by the Sidebar dialog and Project Settings General tab
 */

import { useState } from "react";
import { isPositiveAppGrant, type AppCapabilityGrant, type AppRecord } from "../../../../../shared/apps-ipc";
import type { Project } from "../../../../../shared/projects-ipc";
import { useApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsAlert, SettingsEmpty } from "@/components/settings/settings-layout";
import { Button } from "@ai-chat/ui/components/ui/button";
import { LoaderCircle, PanelsTopLeft } from "lucide-react";
import { grantApp, revokeAppGrant, setAppGrantState } from "@/lib/apps-client";

export function ProjectAppGrantsPanel({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const { records, loading, listWarning } = useApps();
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const apps = records.filter(
    (app) => app.state === "ready" && Boolean(app.generationBinding.active)
  );

  const run = async (appId: string, mutate: () => Promise<unknown>) => {
    setBusyId(appId);
    setError("");
    try {
      await mutate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("projects.grants.grantFailed"));
    } finally {
      setBusyId("");
    }
  };

  const commit = (
    app: AppRecord,
    data: "none" | "read" | "row-write",
    agentDelegation: AppCapabilityGrant["agentDelegation"]
  ) => run(app.id, () => grantApp({
    target: { kind: "project", projectId: project.id },
    appId: app.id,
    requestedDataLevel: data,
    requestedAgentDelegation: agentDelegation,
  }));

  return (
    <div className="space-y-3">
      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
      {listWarning && <SettingsAlert>{t("projects.grants.listFailed")}</SettingsAlert>}
      {loading && (
        <p className="flex items-center gap-2 py-8 text-muted-foreground text-sm" role="status">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          {t("common.loadingView")}
        </p>
      )}
      {apps.map((app) => {
        const record = project.grants.find((item) => item.appId === app.id);
        const grant = record && isPositiveAppGrant(record) ? record : undefined;
        const disabled = Boolean(record && !isPositiveAppGrant(record));
        const busy = busyId === app.id;
        const noData = app.domainIdentity?.kind === "no-data";
        const delegation = grant?.agentDelegation ?? { fileRead: false, useData: false };
        const delegationEnabled = delegation.fileRead || delegation.useData;
        return (
          <section className="rounded-lg border p-3" key={app.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-sm">{app.manifest?.name ?? app.displayName}</p>
                <p className="text-muted-foreground text-xs">
                  {disabled ? t("projects.grants.disabledInherit") : t("projects.grants.summary", {
                    level: grant?.data?.level ?? t("projects.grants.dataNone"),
                    delegation: t(delegationEnabled ? "projects.grants.delegationOn" : "projects.grants.delegationOff"),
                  })}
                </p>
              </div>
              {grant && (
                <Button disabled={busy} onClick={() => void run(app.id, () => revokeAppGrant(
                  { kind: "project", projectId: project.id }, app.id
                ))} size="sm" variant="ghost">
                  {t("projects.grants.revoke")}
                </Button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!noData && (
                <Button disabled={busy} onClick={() => void commit(app, "read", delegation)} size="sm" variant="outline">
                  {t("projects.grants.allowRead")}
                </Button>
              )}
              {!noData && (
                <Button disabled={busy} onClick={() => void commit(app, "row-write", delegation)} size="sm" variant="outline">
                  {t("projects.grants.allowRowWrite")}
                </Button>
              )}
              <Button disabled={busy} onClick={() => void commit(
                app,
                grant?.data?.level ?? "none",
                delegationEnabled
                  ? { fileRead: false, useData: false }
                  : { fileRead: true, useData: Boolean(grant?.data) }
              )} size="sm" variant="outline">
                {t(delegationEnabled ? "projects.grants.delegationDisable" : "projects.grants.delegationEnable")}
              </Button>
              <Button disabled={busy} onClick={() => void run(app.id, () => setAppGrantState({
                appId: app.id,
                target: { kind: "project", projectId: project.id },
                state: "disabled",
              }))} size="sm" variant={disabled ? "destructive" : "outline"}>
                {t(disabled ? "projects.grants.disabledExplicit" : "projects.grants.disableInherit")}
              </Button>
            </div>
          </section>
        );
      })}
      {!loading && !listWarning && !apps.length && (
        <SettingsEmpty hint={t("projects.grants.description")} icon={<PanelsTopLeft />} title={t("projects.grants.empty")} />
      )}
    </div>
  );
}
