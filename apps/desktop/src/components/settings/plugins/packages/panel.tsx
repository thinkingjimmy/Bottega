/**
 * [INPUT]: Depends on the main-window Extensions bridge, shared install preview and custody controls, Settings primitives and package copy.
 * [OUTPUT]: Provides NativePackagePanel for package lifecycle controls, retained data deletion and completed uninstall navigation.
 * [POS]: Native Plugins lifecycle UI; all mutations use the latest global scope revision and main performs every authorization again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download } from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { ExtensionInstallDialog, type ExtensionInstallSource } from "@/components/settings/extensions/extension-install-dialog";
import { UninstallPanel } from "@/components/settings/extensions/extension-package-card";
import { SettingsAlert, SettingsButton, SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-layout";
import { beginUninstallExtension, cancelUninstallExtension, listExtensions, onExtensionsChanged, purgeExtensionInstallData, resolveUninstallExtension } from "@/lib/clients/extensions-client";
import type { ExtensionScopeMutation, ExtensionsSnapshot } from "../../../../../shared/ipc/settings/extensions-ipc";
import { GLOBAL_PRODUCT_RESOURCE_SCOPE } from "../../../../../shared/product/product-resource-scope";
import { packageCopy } from "@ai-chat/ui/lib/plugin-install/copy";
import { packageDisclosureCopy } from "@ai-chat/ui/lib/plugin-install/disclosure";
import type { NativePluginInstallRequest } from "@ai-chat/cloud-protocol/resources/plugin-install";

export default function NativePackagePanel({ installIdentity, toolbarHost, onUninstalled }: {
  installIdentity?: string; toolbarHost?: HTMLElement | null; onUninstalled?: () => void;
}) {
  const { t, i18n } = useAppTranslation(), copy = packageCopy(i18n.language);
  const [snapshot, setSnapshot] = useState<ExtensionsSnapshot | null>(null);
  const [requests, setRequests] = useState<NativePluginInstallRequest[]>([]);
  const [source, setSource] = useState<ExtensionInstallSource | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "uninstall" | "purge"; id: string } | null>(null);
  const revision = useRef(0), mounted = useRef(false), changing = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const [next, pending] = await Promise.all([listExtensions({ scope: GLOBAL_PRODUCT_RESOURCE_SCOPE, expectedProjectLifecycleRevision: null }), window.extensions!.installRequests()]);
      if (mounted.current && current === revision.current) { setSnapshot(next); setRequests(pending); }
    } catch (cause) { if (mounted.current && current === revision.current) setError(errorMessage(cause)); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Loads the external IPC snapshot; updates follow its reply.
    void refresh();
    const release = onExtensionsChanged(event => { if (event.scope.kind === "global") void refresh(); });
    return () => { mounted.current = false; release(); };
  }, [refresh]);
  const mutation = (id: string): ExtensionScopeMutation => ({ installIdentity: id, expectedScope: GLOBAL_PRODUCT_RESOURCE_SCOPE,
    expectedProjectLifecycleRevision: null, expectedScopeRevision: snapshot!.version.scopeRevision });
  const run = async (operation: () => Promise<ExtensionsSnapshot>) => {
    if (changing.current || !snapshot) return;
    changing.current = true; setBusy(true); setError("");
    try {
      const next = await operation();
      if (mounted.current) {
        setConfirm(null);
        if (installIdentity && !next.packages.some(item => item.installIdentity === installIdentity)) onUninstalled?.();
      }
    }
    catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { await refresh(); changing.current = false; if (mounted.current) setBusy(false); }
  };
  const record = snapshot?.packages.find(item => item.installIdentity === installIdentity && item.adapterId === "bottega-host-package-1");
  const retained = snapshot?.retainedInstallData.filter(item => item.adapterId === "bottega-host-package-1" && (!installIdentity || item.installIdentity === installIdentity)) ?? [];
  const button = <SettingsButton variant="outline" disabled={!snapshot || busy} onClick={() => setSource({ repoUrl: "" })} data-plugin-install="">
    <Download aria-hidden />{copy.install}</SettingsButton>;
  return <>
    {toolbarHost && createPortal(button, toolbarHost)}
    {error && <SettingsAlert>{error}</SettingsAlert>}
    {!installIdentity && requests.length > 0 && <SettingsSection title={copy.requests} description={copy.requestDescription}>
      <SettingsList>{requests.map(item => <SettingsRow key={item.requestId} label={item.repoUrl} description={copy.requestSource.replace("{{device}}", item.sourceDeviceId)}
        control={<div className="flex flex-wrap gap-2"><SettingsButton disabled={busy || item.state === "installing"} onClick={() => setSource({ repoUrl: item.repoUrl,
          requestedRef: item.requestedRef, subdirectory: item.subdirectory, remoteRequestId: item.requestId })}>{copy.review}</SettingsButton>
          <SettingsButton variant="ghost" disabled={busy || item.state === "installing"} onClick={() => {
            void window.extensions!.declineInstallRequest(item.requestId).then(refresh).catch(cause => setError(errorMessage(cause)));
          }}>{t("common.cancel")}</SettingsButton></div>} />)}</SettingsList>
    </SettingsSection>}
    {record && <SettingsSection title={copy.manage} description={copy.retention} action={<div className="flex flex-wrap gap-2">
      <SettingsButton disabled={busy} variant="outline" onClick={() => setSource({ repoUrl: record.source.normalizedUrl.startsWith("https://github.com/") ? record.source.normalizedUrl : "", subdirectory: record.source.subdirectory })}>
        {t("settings.extensions.package.checkUpdate")}</SettingsButton>
      {record.uninstall ? <SettingsButton disabled={busy} variant="ghost" onClick={() => void run(() => cancelUninstallExtension(mutation(record.installIdentity)))}>{t("settings.extensions.package.cancelUninstall")}</SettingsButton>
        : <SettingsButton disabled={busy || record.administrativeState !== "denied"} variant="ghost" onClick={() => setConfirm({ kind: "uninstall", id: record.installIdentity })}>{t("settings.extensions.package.uninstall")}</SettingsButton>}
    </div>}>
      <p className="break-all text-xs text-muted-foreground">{record.source.normalizedUrl} · {record.source.resolvedCommit.slice(0, 12)}</p>
      {record.administrativeState !== "denied" && <p className="text-xs text-muted-foreground">{packageDisclosureCopy(i18n.language).disable}</p>}
      {record.uninstall && <UninstallPanel record={record.uninstall} busy={busy} onRetry={() => void run(() => resolveUninstallExtension(mutation(record.installIdentity)))}
        onMigrate={appId => void run(() => resolveUninstallExtension({ ...mutation(record.installIdentity), migrateAppIds: [appId] }))} />}
    </SettingsSection>}
    {retained.length > 0 && <SettingsSection title={t("settings.extensions.page.retainedTitle")} description={copy.retention}>
      <SettingsList>{retained.map(item => <SettingsRow key={item.installIdentity} label={item.displayLabel} description={item.custody.length
        ? t("settings.extensions.page.retainedCustody", { custody: item.custody.join(", ") }) : item.sourceLabel ?? undefined}
        control={<SettingsButton variant="ghost" disabled={busy || item.custody.length > 0} onClick={() => setConfirm({ kind: "purge", id: item.installIdentity })}>{t("settings.extensions.page.purgeData")}</SettingsButton>} />)}</SettingsList>
    </SettingsSection>}
    {snapshot && <ExtensionInstallDialog surface="plugins" source={source} authority={snapshot.version}
      onOpenChange={open => { if (!open) setSource(null); }} onInstalled={() => { setSource(null); void refresh(); }} />}
    <ConfirmationDialog open={!!confirm} busy={busy} title={confirm?.kind === "purge" ? copy.purge : t("settings.extensions.package.uninstall")}
      description={confirm?.kind === "purge" ? copy.purgeDescription : copy.retention} confirmTone="destructive"
      confirmLabel={confirm?.kind === "purge" ? t("settings.extensions.page.purgeData") : t("settings.extensions.package.uninstall")}
      onOpenChange={open => { if (!open && !busy) setConfirm(null); }} onConfirm={() => {
        if (confirm) void run(() => confirm.kind === "purge" ? purgeExtensionInstallData(mutation(confirm.id)) : beginUninstallExtension(mutation(confirm.id)));
      }} />
  </>;
}
