/**
 * [INPUT]: Depends on the account preload adapter, shared deletion copy, the Radix Dialog root and shared StepDialogContent, Settings primitives, login progress, credential recovery, the fixed sign-out control and the shared Sync row grammar.
 * [OUTPUT]: Provides SignIn — the signed-out Sync row (Not signed in · Continue with Google, with every failure, status and recovery action said in place) and the browser sign-in dialog it projects while a sign-in runs (status panel, verification code, Cancel, Open Browser Again and every main-granted recovery action, each with its own lock, including the local abandon of an unconfirmed cancellation).
 * [POS]: Signed-out half of the Sync settings setup page; it never receives credential authority and shows nothing about sync — an account is what unlocks the password step.
 */
import { useRef, useState } from "react";
import { StepDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { accountDeletionCopy } from "@ai-chat/ui/lib/account-deletion-copy";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsAlert, SettingsBadge, SettingsButton, SettingsRow } from "@/components/settings/settings-layout";
import { cloudAccountClient } from "@/lib/cloud/client";
import { CloudCleanupButton } from "../sync-cleanup";
import { CredentialRecovery } from "./credential-recovery";
import { LoginProgress, loginFlags, useLoginLink, type LoginAction } from "./login-progress";
import { SyncTile, useUnavailableRow } from "./row";

const QUIET_STATUSES = new Set<CloudAccountState["status"]>(["signed-out", "local-only", "signing-in"]);
const NO_SIGN_IN_STATUSES = new Set<CloudAccountState["status"]>(["signing-in", "suspended", "deleting", "connecting", "signing-out", "environment-mismatch", "client-outdated"]);
const NO_SIGN_IN_ERRORS = new Set(["credentials-unreadable", "credentials-environment-mismatch", "encryption-unavailable", "secure-save-failed"]);

export function SignIn({ state }: { state: CloudAccountState }) {
  const { t, i18n } = useAppTranslation();
  const locks = useRef(new Set<LoginAction>());
  const [busy, setBusy] = useState<ReadonlySet<LoginAction>>(new Set()), [failed, setFailed] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  /* Every login action locks itself and only itself: cancelling must stay live while
     a start or reopen call is still in flight. */
  const run = (action: LoginAction) => {
    if (locks.current.has(action)) return;
    locks.current.add(action); setBusy(new Set(locks.current)); setFailed(false);
    void Promise.resolve().then(async () => { await cloudAccountClient()[action](); }).catch(() => setFailed(true)).finally(() => {
      locks.current.delete(action); setBusy(new Set(locks.current));
    });
  };
  const signingIn = state.status === "signing-in";
  const { pending, cancelling, browser } = loginFlags(state, busy);
  const link = useLoginLink(browser && !cancelling && pending?.browserUrl ? pending.browserUrl : null, pending?.expiresAt ?? 0);
  const canSignIn = !pending && !state.signOutPending && !NO_SIGN_IN_STATUSES.has(state.status) &&
    (!state.canDiscardSavedLogin || state.error === "credentials-invalid") && !NO_SIGN_IN_ERRORS.has(state.error ?? "");
  const canCancel = !(cancelling && !state.cancelUnconfirmed) && !busy.has("cancelLogin");
  const recovery = <CredentialRecovery state={state} onFailure={setRecoveryFailed} />;
  const unavailable = useUnavailableRow(state);

  /* The row states one thing at a time: a sign-out still reaching the server owns it (the button it
     disables must say why), then a failure, then any other account status, then the invitation. */
  const error = signingIn ? null : state.error ? t(`cloud.error.${state.error}`) : failed || recoveryFailed ? t("cloud.actionFailed") : null;
  const restartHint = error && ["secure-save-failed", "encryption-unavailable"].includes(state.error ?? "");
  const status = state.signOutPending ? t("cloud.status.signing-out") : QUIET_STATUSES.has(state.status) ? null :
    state.status === "deleted" ? accountDeletionCopy(i18n.language).deleted : t(`cloud.status.${state.status}`);
  const description = state.signOutPending ? <span role="status">{status}</span>
    : error ? <><span role="alert">{error}</span>{restartHint && <> {t("cloud.secureStorageRestart")}</>}</>
      : status ? <span role="status">{status}</span> : t("cloud.signedOutDescription");
  const attention = Boolean(error) || state.status === "suspended";
  const row = unavailable ?? {
    label: t("cloud.notSignedIn"),
    badge: attention ? <SettingsBadge tone={error ? "danger" : "warn"}>{t("cloud.syncBadge.attention")}</SettingsBadge> : undefined,
    description,
    /* While the browser dialog is open it owns every sign-in action; the row offers none. */
    control: signingIn ? null : <span className="flex flex-wrap items-center justify-end gap-2">
      {recovery}
      {state.status === "suspended" && <CloudCleanupButton mode="signOut" />}
      <SettingsButton disabled={!canSignIn || busy.has("startLogin") || !state.available} onClick={() => run("startLogin")}>
        {busy.has("startLogin") && <Spinner className="size-3.5" />}{t("cloud.google")}
      </SettingsButton>
    </span>,
  };

  return <>
    <SettingsRow leading={<SyncTile />} {...row} />
    {/* Projected, never navigated: the dialog is open exactly while main reports a sign-in. Escape is Cancel; a
        stray click outside must not throw away a browser approval in progress. */}
    <Dialog open={signingIn} onOpenChange={open => { if (!open && canCancel) run("cancelLogin"); }}>
      {signingIn && <StepDialogContent title={t("cloud.setup.browserTitle")} description={t("cloud.setup.browserDescription")}
        progress={{ index: 1, total: 2, label: t("common.stepOf", { current: 1, total: 2 }) }}
        onPointerDownOutside={event => event.preventDefault()}
        actions={<>
          {/* An unconfirmed cancellation is the one cancelling state the user can still act on: let them ask again. */}
          <SettingsButton variant="ghost" disabled={!canCancel} onClick={() => run("cancelLogin")}>{t("cloud.cancel")}</SettingsButton>
          {/* Only offered once the server has refused at least one cancel: dropping the local record is the last exit. */}
          {state.cancelUnconfirmed && <SettingsButton variant="outline" disabled={busy.has("abandonLogin")} onClick={() => run("abandonLogin")}>{t("cloud.abandonLogin")}</SettingsButton>}
          {!pending && state.error && !cancelling && <SettingsButton variant="outline" disabled={busy.has("startLogin")} onClick={() => run("startLogin")}>{t("cloud.retry")}</SettingsButton>}
          {state.canRetryLoginSave && <SettingsButton variant="outline" disabled={busy.has("retryLoginSave") || cancelling} onClick={() => run("retryLoginSave")}>{t("cloud.retrySecureSave")}</SettingsButton>}
          {state.error === "installation-already-active" && <SettingsButton variant="outline" disabled={busy.has("openCloudAccount")} onClick={() => run("openCloudAccount")}>{t("cloud.openCloudAccount")}</SettingsButton>}
          {browser && <SettingsButton variant="outline" disabled={busy.has("reopenLogin") || cancelling} onClick={() => run("reopenLogin")}>{t("cloud.openBrowser")}</SettingsButton>}
        </>}>
        {(failed || recoveryFailed) && <SettingsAlert>{t("cloud.actionFailed")}</SettingsAlert>}
        <LoginProgress state={state} busy={busy} link={link} />
        {(state.canDiscardSavedLogin || state.canRetryCredentialStorage) && <div className="flex flex-wrap gap-2">{recovery}</div>}
      </StepDialogContent>}
    </Dialog>
  </>;
}
