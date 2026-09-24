/**
 * [INPUT]: Depends on the shared cloud account projection, PageShell, Settings primitives, Lucide icons, the guarded Dock settings bridge, and the sign-in row and unfinished-setup row.
 * [OUTPUT]: Provides SyncSetup — the Settings page shown until this computer syncs: a Sync section with one row (signed out, or signed in without a sync password) and the What syncs section.
 * [POS]: Sync settings setup page entry; which row shows is a projection of the account state, and the sign-in and password steps run in dialogs above it.
 */
import type { ComponentType } from "react";
import { Database, MessagesSquare, PanelBottom, RefreshCw, Sparkles } from "lucide-react";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { PageShell } from "@/components/page-shell";
import { SettingsCanvas, SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-layout";
import { SignIn } from "./sign-in";
import { FinishSetup } from "./finish";

/* Only what the sync engine actually carries (electron/main/cloud/sync): Chats with their files and Chat
   Homes, Projects, Bases and the published source of Apps, the Skills library, and the Dock layout. */
const SYNCED = [
  { icon: MessagesSquare, key: "chats", labelKey: "cloud.whatSyncs.chats", descriptionKey: "cloud.whatSyncs.chatsDescription" },
  { icon: Database, key: "data", labelKey: "cloud.whatSyncs.data", descriptionKey: "cloud.whatSyncs.dataDescription" },
  { icon: Sparkles, key: "skills", labelKey: "cloud.whatSyncs.skills", descriptionKey: "cloud.whatSyncs.skillsDescription" },
  { icon: PanelBottom, key: "dock", labelKey: "cloud.whatSyncs.dock", descriptionKey: "cloud.whatSyncs.dockDescription" },
] as const satisfies readonly { icon: ComponentType<{ className?: string }>; key: string; labelKey: string; descriptionKey: string }[];

function WhatSyncs({ signedIn }: { signedIn: boolean }) {
  const { t } = useAppTranslation();
  // The Dock layout exists only where the preload exposed Bottega Dock (macOS).
  const items = SYNCED.filter(item => item.key !== "dock" || Boolean(window.systemDockSettings));
  return <SettingsSection title={t("cloud.whatSyncs.title")} description={t("cloud.whatSyncs.description")}>
    <SettingsList>{items.map(({ icon: Icon, key, labelKey, descriptionKey }) => <SettingsRow key={key}
      leading={<span aria-hidden="true" className="flex w-5 justify-center text-muted-foreground"><Icon className="size-4" /></span>}
      label={t(labelKey)} description={t(descriptionKey)}
      control={<span className="text-muted-foreground text-xs">{t(signedIn ? "cloud.whatSyncs.afterPassword" : "cloud.whatSyncs.after")}</span>} />)}
    </SettingsList>
  </SettingsSection>;
}

/* Until this computer syncs there is nothing to set, so the page is one row that says where the
   account stands and what it lacks, and the list of what signing in will carry. */
export function SyncSetup({ state }: { state: CloudAccountState }) {
  const { t } = useAppTranslation();
  return <PageShell title={t("cloud.syncSettings")} icon={<RefreshCw />}><SettingsCanvas><div className="space-y-8">
    <SettingsSection title={t("cloud.sync")}>
      <SettingsList>{state.profile ? <FinishSetup key={state.profile.userId} state={state} /> : <SignIn state={state} />}</SettingsList>
    </SettingsSection>
    <WhatSyncs signedIn={Boolean(state.profile)} />
  </div></SettingsCanvas></PageShell>;
}
