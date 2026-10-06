/**
 * [INPUT]: Depends on the shared cloud account projection, SettingsPage, Settings primitives, the guarded Dock settings bridge, and the sign-in row and unfinished-setup row.
 * [OUTPUT]: Provides SyncSetup — the Settings page shown until this computer syncs: a Sync section with one row (signed out, or signed in without a sync password) and What syncs as guidance copy.
 * [POS]: Sync settings setup page entry; which row shows is a projection of the account state, and the sign-in and password steps run in dialogs above it.
 */
import type { CloudAccountState } from "../../../../shared/ipc/settings/cloud-ipc";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsPage } from "@/components/page-shell";
import { SettingsCanvas, SettingsList, SettingsSection } from "@/components/settings/settings-layout";
import { SignIn } from "./sign-in";
import { FinishSetup } from "./finish";

/* Only what the sync engine actually carries (electron/main/cloud/sync): Chats with their files and Chat
   Homes, Projects, Bases and the published source of Apps, the Skills library, and the Dock layout. */
const SYNCED = [
  { key: "chats", labelKey: "cloud.whatSyncs.chats", descriptionKey: "cloud.whatSyncs.chatsDescription" },
  { key: "data", labelKey: "cloud.whatSyncs.data", descriptionKey: "cloud.whatSyncs.dataDescription" },
  { key: "skills", labelKey: "cloud.whatSyncs.skills", descriptionKey: "cloud.whatSyncs.skillsDescription" },
  { key: "dock", labelKey: "cloud.whatSyncs.dock", descriptionKey: "cloud.whatSyncs.dockDescription" },
] as const;

function WhatSyncs({ signedIn }: { signedIn: boolean }) {
  const { t } = useAppTranslation();
  // The Dock layout exists only where the preload exposed Bottega Dock (macOS).
  const items = SYNCED.filter(item => item.key !== "dock" || Boolean(window.systemDockSettings));
  return <SettingsSection title={t("cloud.whatSyncs.title")}>
    <div className="flex max-w-prose flex-col gap-3">
      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
        {t(signedIn ? "cloud.whatSyncs.leadPassword" : "cloud.whatSyncs.lead")}
      </p>
      <ul className="list-disc space-y-2 pl-4 marker:text-muted-foreground/50">
        {items.map(({ key, labelKey, descriptionKey }) => <li key={key} className="text-pretty text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{t(labelKey)}</span>
          {" · "}
          {t(descriptionKey)}
        </li>)}
      </ul>
    </div>
  </SettingsSection>;
}

/* Until this computer syncs there is nothing to set, so the page is one row that says where the
   account stands, and guidance that says what signing in will carry. */
export function SyncSetup({ state }: { state: CloudAccountState }) {
  const { t } = useAppTranslation();
  return <SettingsPage title={t("cloud.syncSettings")}><SettingsCanvas><div className="space-y-8">
    <SettingsSection title={t("cloud.sync")}>
      <SettingsList>{state.profile ? <FinishSetup key={state.profile.userId} state={state} /> : <SignIn state={state} />}</SettingsList>
    </SettingsSection>
    <WhatSyncs signedIn={Boolean(state.profile)} />
  </div></SettingsCanvas></SettingsPage>;
}
