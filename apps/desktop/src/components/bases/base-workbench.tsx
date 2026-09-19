/**
 * [INPUT]: Depends on the shared Base workbench, DesktopBasePlatform, the cloud account projection and the current owner's folder recovery status.
 * [OUTPUT]: Provides BaseWorkbench with desktop adapters or a reason-specific recovering-content notice scoped to the current owner, re-checkable while signed in.
 * [POS]: Desktop import boundary; platform composition stays in the desktop host, repair itself stays with cloud downlink.
 */
import { useEffect, useState, type ComponentProps } from "react";
import { BaseWorkbench as SharedBaseWorkbench } from "@ai-chat/base-ui/ui/base-workbench";
import type { BasesBridgeApi } from "../../../shared/bases-ipc";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DesktopBasePlatform } from "./platform";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useCloudAccount } from "@/lib/cloud/client";
const POLL_MIN_MS = 2_000, POLL_MAX_MS = 30_000;
type FolderRecovery = Awaited<ReturnType<NonNullable<BasesBridgeApi["getRecovery"]>>>;
export function BaseWorkbench(props: ComponentProps<typeof SharedBaseWorkbench>) {
  const { t } = useAppTranslation();
  const account = useCloudAccount();
  const [status, setStatus] = useState<{ ownerKey: string; value: FolderRecovery } | null>(null);
  const [attempt, setAttempt] = useState(0);
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
  return <DesktopBasePlatform chatId={props.attachmentOwner?.chatId}><SharedBaseWorkbench {...props} /></DesktopBasePlatform>;
}
