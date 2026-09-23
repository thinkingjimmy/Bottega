/**
 * [INPUT]: Depends on the main-owned cloud package disclosure, existing App requirements/grant forms and local Agent availability.
 * [OUTPUT]: Presents explicit installation/update consent with scoped cancellation, configuration and host compatibility feedback.
 * [POS]: Cloud App modal; source verification and durable installation remain in main.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { maintenanceCapableBackends } from "@/lib/agent-backends";
import { UPDATES_SETTINGS_PATH } from "@/lib/settings-navigation";
import { AgentSelect, type AgentSelectValue } from "../install/agent-select";
import { AppInstallGrants, AppInstallReadme } from "../install/app-install-disclosure";
import { AppRequirementsForm, appRequirementsSatisfied } from "../install/app-requirements-form";
import type { CloudAppReview } from "../../../../shared/cloud/apps/model";
import type { AppCompatibilityFailure } from "../../../../shared/app-host/contract";
import type { AppConfigValue } from "../../../../shared/apps-ipc";
type Props = {
  userId: string; appId: string; name: string; update: boolean; online: boolean; onClose(): void;
};
export function CloudAppInstallDialog(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <InstallForm key={`${props.userId}:${props.appId}:${attempt}`} {...props} onRetry={() => setAttempt(value => value + 1)} />;
}
function InstallForm({ userId, appId, name, update, online, onClose, onRetry }: Props & { onRetry(): void }) {
  const { t, i18n } = useAppTranslation(), setup = useSetup(), navigate = useNavigate();
  const [review, setReview] = useState<CloudAppReview | null>(null), [compatibility, setCompatibility] = useState<AppCompatibilityFailure | null>(null);
  const [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<AppConfigValue>({ values: {}, agentReadableKeys: [] });
  const [agent, setAgent] = useState<AgentSelectValue>("codex");
  const options = maintenanceCapableBackends(setup.status?.backends ?? [], setup.now);
  const selected = options.find(item => item.id === agent)?.id ?? options[0]?.id ?? null;
  useEffect(() => {
    let active = true, requestId: string | null = null;
    void window.cloudApps!.review({ expectedUserId: userId, appId }).then(async result => {
      if ("kind" in result) { if (active) setCompatibility(result.compatibility); return; }
      requestId = result.requestId;
      if (!active) { await window.cloudApps!.discard({ expectedUserId: userId, requestId }); return; }
      setReview(result); setConfig(result.config);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (requestId) void window.cloudApps!.discard({ expectedUserId: userId, requestId }).catch(() => undefined); };
  }, [userId, appId]);
  const requirements = review?.manifest.requirements?.tools ?? [];
  const toolsReady = !review?.cliStatuses.some(state => state.detectable && !state.installed && requirements.some(item => item.id === state.id && item.required));
  const confirm = async () => {
    if (!review || !selected || busy || !online) return;
    setBusy(true); setFailed(false);
    try {
      await window.cloudApps!.confirm({ expectedUserId: userId, requestId: review.requestId, agent: selected, config,
        authorization: { scope: "studio-only", decision: "approve-requested" } });
      onClose();
    } catch { setFailed(true); setReview(null); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl" onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 pr-8">
        <DialogTitle>{t((review?.update ?? update) ? "cloud.appInstall.updateTitle" : "cloud.appInstall.installTitle", { name })}</DialogTitle>
        <DialogDescription>{t("cloud.appInstall.consent")}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto px-1">
        {!online ? <p role="status">{t("cloud.appInstall.online")}</p> : compatibility ? <>
          <p role="status">{t(`appHost.${compatibility.code}`, { name, minimum: compatibility.minBottegaVersion ?? "—", current: compatibility.currentVersion ?? "—" })}</p>
          <Button variant="outline" onClick={() => { onClose(); void navigate(UPDATES_SETTINGS_PATH); }}>{t("appHost.upgrade")}</Button>
        </> : !review && !failed ? <p role="status" aria-live="polite">{t("cloud.appInstall.preparing")}</p> : null}
        {failed && <p role="alert" className="text-destructive">{t("cloud.appInstall.failed")}</p>}
        {review && <>
          <p className="text-sm">{t("cloud.appInstall.version", { version: review.packageRevision })}</p>
          <p className="text-sm text-muted-foreground">{t(review.coverage === "partial" ? "cloud.apps.partial" : "cloud.apps.baseOnly")}</p>
          <AppInstallReadme readme={i18n.language === "zh-CN" && review.readmeZh ? review.readmeZh : review.readme} />
          <AppInstallGrants requirements={requirements} cliStatuses={review.cliStatuses} extensions={review.extensions}
            extensionRequirements={review.manifest.extensionRequirements} manifest={review.manifest} source={{ label: t("cloud.appInstall.source") }} />
          <fieldset disabled={busy} className="space-y-3">
            <legend className="mb-2 text-sm font-medium">{t("cloud.appInstall.configuration")}</legend>
            <AppRequirementsForm requirements={requirements} value={config} onChange={setConfig} disabled={busy} />
            <AgentSelect value={selected ?? "codex"} options={options} disabled={busy || !options.length} label={t("cloud.appInstall.agent")} onChange={setAgent} />
            {!selected && <p role="status" className="text-sm">{t("cloud.appInstall.noAgent")}</p>}
          </fieldset>
        </>}
      </div>
      <DialogFooter className="shrink-0 gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
        {(failed || compatibility) && <Button variant="outline" disabled={busy || !online} onClick={onRetry}>{t("cloud.appInstall.refresh")}</Button>}
        {review && <Button disabled={busy || !online || !selected || !toolsReady || !appRequirementsSatisfied(requirements, config)} onClick={() => void confirm()}>
          {t(busy ? "cloud.appInstall.installing" : review.update ? "cloud.appInstall.confirmUpdate" : "cloud.appInstall.confirmInstall")}
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
