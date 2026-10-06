/**
 * [INPUT]: Depends on the account preload adapter, shared setup boundary, avatar copy, SettingsPage/Settings primitives, the handshake retry action and setup/Sync/Devices/Deletion sections.
 * [OUTPUT]: Provides AccountSettingsView — the sign-in form until this computer is syncing, then the settings page (Account · Sync · App packages · Devices with local sync disable · Delete).
 * [POS]: Desktop Sync settings route; which of the two screens shows is a projection of the account state, and it never receives credential or sync-store authority.
 */

import { AccountAvatar } from "@ai-chat/ui/components/account/avatar";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsPage } from "@/components/page-shell";
import { SettingsCanvas, SettingsSection, SettingsList, SettingsRow } from "@/components/settings/settings-layout";
import { useCloudAccount } from "@/lib/cloud/client";
import { cloudHandshakeFailed } from "../../../shared/ipc/settings/cloud-ipc";
import { requiresSyncSetup } from "../../../shared/cloud/sync";
import { AccountDevices } from "./devices";
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
  return <SettingsPage title={t("cloud.syncSettings")}><SettingsCanvas><div className="space-y-8">
    <SettingsSection title={t("cloud.account")} description={t("cloud.localDescription")} alert={alert}>
      <SettingsList><SettingsRow label={profile.name} description={profile.email} leading={<AccountAvatar name={profile.name} src={state.avatarDataUrl} />}
        control={<CloudCleanupButton mode="signOut" disabled={state.status === "signing-out"} />} />
      </SettingsList>
      {/* "Action needed" adds nothing beside a banner that already names the failure and carries its own action. */}
      {state.status !== "ready" && !(state.status === "error" && state.error) && <p role="status" className="text-muted-foreground text-sm">{t(`cloud.status.${state.status}`)}</p>}
      {state.status === "account-switch-required" && <div><CloudCleanupButton key={profile.userId} mode="switchAccount" /></div>}
    </SettingsSection>
    <AccountSync key={profile.userId} state={state} />
    <AppPackagesSection issues={state.sync.appIssues} />
    {state.status === "ready" && <AccountDevices accountId={profile.userId}
      currentDeviceAction={<CloudCleanupButton mode="disableSync" disabled={state.sync.status === "closing"} />} />}
    {state.status === "ready" && <DeleteCloudAccount />}
  </div></SettingsCanvas></SettingsPage>;
}
