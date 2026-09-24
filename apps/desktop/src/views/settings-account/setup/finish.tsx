/**
 * [INPUT]: Depends on the cloud account projection, the Radix Dialog root, Settings primitives, the fixed sign-out control, the shared Sync row grammar and the password step.
 * [OUTPUT]: Provides FinishSetup — the row of an account whose computer has not given its sync password (Sync password needed · Sign out · Continue, or the in-row unavailable state) and the password dialog it opens on arrival.
 * [POS]: Signed-in half of the Sync settings setup page; the dialog opens by itself, can be put away and reopened from the row, and closing it releases the review exactly like leaving the page.
 */
import { useState } from "react";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton, SettingsRow } from "@/components/settings/settings-layout";
import { CloudCleanupButton } from "../sync-cleanup";
import { PasswordStep } from "./password";
import { SyncTile, useUnavailableRow } from "./row";

/* Keyed by account in the parent: another account starts with the dialog open and an empty draft. */
export function FinishSetup({ state }: { state: CloudAccountState }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(true);
  const actions = <>
    <CloudCleanupButton mode="signOut" variant="ghost" disabled={state.status === "signing-out"} />
    {!open && <SettingsButton onClick={() => setOpen(true)}>{t("cloud.setup.resume")}</SettingsButton>}
  </>;
  const row = useUnavailableRow(state, actions) ?? {
    label: t("cloud.setup.pendingLabel"),
    description: `${t("cloud.setup.signedInAs", { email: state.profile?.email ?? "" })} ${t("cloud.setup.pendingDescription")}`,
    control: <span className="flex flex-wrap items-center justify-end gap-2">{actions}</span>,
  };
  return <>
    <SettingsRow leading={<SyncTile />} {...row} />
    {/* Mounted only while open: unmounting is what cancels an unfinished review or key derivation. */}
    <Dialog open={open} onOpenChange={next => { if (!next) setOpen(false); }}>
      {open && <PasswordStep state={state} onClose={() => setOpen(false)} />}
    </Dialog>
  </>;
}
