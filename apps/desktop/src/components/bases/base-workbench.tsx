/**
 * [INPUT]: Depends on the shared Base workbench, desktop platform, recovery status and lazy Workflow/record package contribution hosts.
 * [OUTPUT]: Provides BaseWorkbench with recovery notices and composed generic record slots without remounting drafts.
 * [POS]: Desktop Base composition; transport and package leases stay in native adapters.
 */
import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react";
import { workbenchUiEnabled } from "@ai-chat/ui/lib/workbench-flag";
import { BaseWorkbench as SharedBaseWorkbench } from "@ai-chat/base-ui/ui/base-workbench";
import { WorkflowRunsProvider, type WorkflowRunsSurface } from "@ai-chat/base-ui/ui/workflow/runs-context";
import type { RecordContribution } from "@ai-chat/base-ui/ui/state/record-slots";
import type { BasesBridgeApi } from "../../../shared/bases/model/bases-ipc";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DesktopBasePlatform } from "./platform";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useCloudAccount } from "@/lib/cloud/client";
const POLL_MIN_MS = 2_000, POLL_MAX_MS = 30_000;
/* Runs belong to Project Bases and exist only with the workbench flag; the host loads on demand (OPT-30). */
const WorkflowRunsHost = workbenchUiEnabled ? lazy(() => import("./workflow/runs-host")) : null;
const RecordPluginsHost = workbenchUiEnabled ? lazy(() => import("./records/host")) : null;
type FolderRecovery = Awaited<ReturnType<NonNullable<BasesBridgeApi["getRecovery"]>>>;
export function BaseWorkbench(props: ComponentProps<typeof SharedBaseWorkbench>) {
  const { t } = useAppTranslation();
  const account = useCloudAccount();
  const [status, setStatus] = useState<{ ownerKey: string; value: FolderRecovery } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [runs, setRuns] = useState<WorkflowRunsSurface | null>(null);
  const [contributions, setContributions] = useState<readonly RecordContribution[]>([]);
  const recovery = status?.ownerKey === props.ownerKey ? status.value : null;
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, delay = POLL_MIN_MS;
    const refresh = async () => {
      const value = await window.bases?.getRecovery?.({ ownerKey: props.ownerKey }).catch(() => null);
      if (!active) return; setStatus({ ownerKey: props.ownerKey, value: value ?? null });
      /* Repair arrives on a cloud downlink pass, never from this read. Backing off keeps a Base that only
         a sign-in can repair from asking every two seconds for the rest of the session. */
      if (value) { timer = setTimeout(() => void refresh(), delay); delay = Math.min(delay * 2, POLL_MAX_MS); }
    };
    void refresh(); return () => { active = false; if (timer) clearTimeout(timer); };
  }, [props.ownerKey, attempt]);
  if (recovery) return <div role="alert" className="space-y-3 p-6 text-sm">
    <p className="font-medium">{t("bases.folderRecovery.title")}</p>
    {/* Only "content" can name the files it is missing; the other two keep readable content whose
        owner is gone, so the sentence names that owner instead of listing nothing. */}
    <p className="max-w-lg text-muted-foreground">
      {recovery.reason === "project-missing" ? t("bases.folderRecoveryProjectMissing")
        : recovery.reason === "owner-incarnation-changed" ? t("bases.folderRecoveryOwnerChanged")
        : t("bases.folderRecovery.description")}
    </p>
    {recovery.files.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{recovery.files.map(file => <li key={file}>{file}</li>)}</ul>}
    {account.status === "ready" && <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>
      {t("bases.folderRecoveryRetry")}
    </Button>}
  </div>;
  const shared = <SharedBaseWorkbench {...props} recordContributions={[...props.recordContributions ?? [], ...contributions]} />;
  const hostsRuns = Boolean(WorkflowRunsHost) && props.ownerKey.startsWith("project:");
  /* The workbench renders once, in one place: the lazily loaded runs host is its sibling and hands its surface up.
     A Suspense fallback holding a second workbench made the host's arrival remount it, dropping a view switched or
     a dialog opened in the first moments (T16). */
  return <DesktopBasePlatform chatId={props.attachmentOwner?.chatId}>
    {hostsRuns ? <WorkflowRunsProvider value={runs}>{shared}</WorkflowRunsProvider> : shared}
    {hostsRuns && WorkflowRunsHost && <Suspense fallback={null}><WorkflowRunsHost ownerKey={props.ownerKey} onSurface={setRuns} /></Suspense>}
    {RecordPluginsHost && <Suspense fallback={null}><RecordPluginsHost ownerKey={props.ownerKey} disabled={props.capability === "read" || props.capability === "row-write"} onContributions={setContributions} /></Suspense>}
  </DesktopBasePlatform>;
}
