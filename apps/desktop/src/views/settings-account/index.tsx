/**
 * [INPUT]: Depends on the account preload adapter, shared setup boundary, avatar copy, Settings primitives, the handshake retry action and setup/Sync/Devices/Deletion sections.
 * [OUTPUT]: Provides AccountSettingsView — the sign-in form until this computer is syncing, then the settings page (Account · This computer · Sync · App packages · Devices · Cloud data · Delete).
 * [POS]: Desktop Sync settings route; which of the two screens shows is a projection of the account state, and it never receives credential or sync-store authority.
 */
import { RefreshCw } from "lucide-react";
import { AccountAvatar } from "@ai-chat/ui/components/account/avatar";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { PageShell } from "@/components/page-shell";
import { SettingsCanvas, SettingsSection, SettingsList, SettingsRow } from "@/components/settings/settings-layout";
import { useCloudAccount } from "@/lib/cloud/client";
import { cloudHandshakeFailed } from "../../../shared/cloud-ipc";
import { requiresSyncSetup } from "../../../shared/cloud/sync";
import { AccountComputer, AccountDevices } from "./devices";
import { AccountSync, AppPackagesSection } from "./sync";
import { CloudCleanupButton } from "./sync-cleanup";
import { DeleteCloudAccount } from "./deletion";
import { RetryConnectionButton } from "./retry-connection";
import { SyncSetup } from "./setup";
/* Until this computer is syncing there is nothing to set: no account, or an account whose
   sync password this computer has not given yet, is the two-step sign-in form. Everything
   else is the settings page. */
export function AccountSettingsView() {
  const { t } = useAppTranslation(); const state = useCloudAccount();
  if (!state.profile || requiresSyncSetup(state.sync)) return <SyncSetup state={state} />;
  const profile = state.profile;
  /* A handshake that failed is recoverable without a restart, so its banner carries the action. */
  const alert = state.error ? <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <span>{t(`cloud.error.${state.error}`)}</span>{cloudHandshakeFailed(state) && <RetryConnectionButton variant="outline" />}</span> : undefined;
  return <PageShell title={t("cloud.syncSettings")} icon={<RefreshCw />}><SettingsCanvas><div className="space-y-8">
    <SettingsSection title={t("cloud.account")} description={t("cloud.localDescription")} alert={alert}>
      <SettingsList><SettingsRow label={profile.name} description={profile.email} leading={<AccountAvatar name={profile.name} src={state.avatarDataUrl} />}
        control={<CloudCleanupButton mode="signOut" disabled={state.status === "signing-out"} />} />
      </SettingsList>
      {/* "Action needed" adds nothing beside a banner that already names the failure and carries its own action. */}
      {state.status !== "ready" && !(state.status === "error" && state.error) && <p role="status" className="text-muted-foreground text-sm">{t(`cloud.status.${state.status}`)}</p>}
      {state.status === "account-switch-required" && <div><CloudCleanupButton key={profile.userId} mode="switchAccount" /></div>}
    </SettingsSection>
    {/* Sign-in state, this computer's display name, sign out: the three things the sync area says,
        and no switch beside them — being signed in is what publishes this computer. */}
    {state.machine && <AccountComputer key={state.machine.idHash} machine={state.machine} />}
    <AccountSync key={profile.userId} state={state} />
    <AppPackagesSection issues={state.sync.appIssues} />
    {state.status === "ready" && <AccountDevices accountId={profile.userId} />}
    {/* Removing cloud data is its own deliberate act, down here with the other account-level ones.
        Signing out above does none of it: what this computer published stays readable elsewhere. */}
    <SettingsSection title={t("cloud.syncReview.cloudData")}>
      <SettingsList><SettingsRow label={t("cloud.syncReview.disableTitle")} description={t("cloud.syncReview.cloudDataDescription")}
        control={<CloudCleanupButton mode="disableSync" disabled={state.status !== "ready" || state.sync.status === "closing"} />} /></SettingsList>
    </SettingsSection>
    {state.status === "ready" && <DeleteCloudAccount />}
  </div></SettingsCanvas></PageShell>;
}
