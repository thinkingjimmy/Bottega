/**
 * [INPUT]: An optional host step renderer, depends on the account preload adapter, shared deletion copy, settings controls, login progress, credential recovery and fixed sign-out control.
 * [OUTPUT]: Provides SignInStep — step 1 of the setup form: browser-first sign-in with independent action locks, the waiting body, pending sign-out and every recovery exit, including the local abandon of an unconfirmed cancellation.
 * [POS]: Setup form step 1; it never receives credential authority and shows nothing about sync — an account is what unlocks step 2.
 */
import { useRef, useState } from "react";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { accountDeletionCopy } from "@ai-chat/ui/lib/account-deletion-copy";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsAlert, SettingsButton } from "@/components/settings/settings-layout";
import { cloudAccountClient } from "@/lib/cloud/client";
import { SetupStep } from "./step";
import { CloudCleanupButton } from "../sync-cleanup";
import { CredentialRecovery } from "./credential-recovery";
import { LoginProgress, loginFlags, useLoginLink, type LoginAction } from "./login-progress";

const QUIET_STATUSES = new Set<CloudAccountState["status"]>(["signed-out", "local-only", "signing-in"]);
const NO_SIGN_IN_STATUSES = new Set<CloudAccountState["status"]>(["signing-in", "suspended", "deleting", "connecting", "signing-out", "environment-mismatch", "client-outdated"]);
const NO_SIGN_IN_ERRORS = new Set(["credentials-unreadable", "credentials-environment-mismatch", "encryption-unavailable", "secure-save-failed"]);

export function SignInStep({ state, Step = SetupStep, onBack }: { state: CloudAccountState; Step?: typeof SetupStep; onBack?: () => void }) {
  const { t, i18n } = useAppTranslation();
  const locks = useRef(new Set<LoginAction>());
  const [busy, setBusy] = useState<ReadonlySet<LoginAction>>(new Set()), [failed, setFailed] = useState(false);
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
  const alert = state.error && !signingIn ? t(`cloud.error.${state.error}`) : failed ? t("cloud.actionFailed") : null;
  /* A sign-out that has not reached the server yet owns the status line: the button it disables
     must say why, instead of looking live and doing nothing. */
  const status = state.signOutPending ? t("cloud.status.signing-out") : QUIET_STATUSES.has(state.status) ? null :
    state.status === "deleted" ? accountDeletionCopy(i18n.language).deleted : t(`cloud.status.${state.status}`);
  const restartHint = !signingIn && ["secure-save-failed", "encryption-unavailable"].includes(state.error ?? "");
  const footer = signingIn ? <>
    {/* An unconfirmed cancellation is the one cancelling state the user can still act on: let them ask again. */}
    <SettingsButton variant="ghost" className="text-muted-foreground" disabled={cancelling && !state.cancelUnconfirmed || busy.has("cancelLogin")} onClick={() => run("cancelLogin")}>{t("cloud.cancel")}</SettingsButton>
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/* Only offered once the server has refused at least one cancel: dropping the local record is the last exit. */}
      {state.cancelUnconfirmed && <SettingsButton variant="outline" disabled={busy.has("abandonLogin")} onClick={() => run("abandonLogin")}>{t("cloud.abandonLogin")}</SettingsButton>}
      {!pending && state.error && !cancelling && <SettingsButton variant="outline" disabled={busy.has("startLogin")} onClick={() => run("startLogin")}>{t("cloud.retry")}</SettingsButton>}
      {state.canRetryLoginSave && <SettingsButton variant="outline" disabled={busy.has("retryLoginSave") || cancelling} onClick={() => run("retryLoginSave")}>{t("cloud.retrySecureSave")}</SettingsButton>}
      {state.error === "installation-already-active" && <SettingsButton variant="outline" disabled={busy.has("openCloudAccount")} onClick={() => run("openCloudAccount")}>{t("cloud.openCloudAccount")}</SettingsButton>}
      {link.url && <SettingsButton variant="outline" disabled={link.copyState === "copying"} onClick={() => { void link.copy(); }}>
        <span aria-live="polite">{link.copyState === "copied" ? t("cloud.loginLinkCopied") : t("cloud.copyLoginLink")}</span></SettingsButton>}
      {browser && <SettingsButton variant="outline" disabled={busy.has("reopenLogin") || cancelling} onClick={() => run("reopenLogin")}>{t("cloud.openBrowser")}</SettingsButton>}
    </div>
  </> : <>
    {state.status === "suspended" ? <CloudCleanupButton mode="signOut" variant="ghost" /> : onBack ? <SettingsButton variant="ghost" onClick={onBack}>{t("onboarding.back")}</SettingsButton> : <span />}
    <SettingsButton className="px-5" disabled={!canSignIn || busy.has("startLogin") || !state.available} onClick={() => run("startLogin")}>
      {busy.has("startLogin") && <Spinner className="size-3.5" />}{t("cloud.google")}
    </SettingsButton>
  </>;
  return <Step step={0} title={t("cloud.setup.signInTitle")} footer={footer}
    description={<>{t("cloud.localDescription")} {t("cloud.setup.browserApproval")}</>}>
    {alert && <SettingsAlert>{alert}</SettingsAlert>}
    {restartHint && <p className="text-sm">{t("cloud.secureStorageRestart")}</p>}
    {status && <p role="status" className="text-sm">{status}</p>}
    {signingIn && <LoginProgress state={state} busy={busy} link={link} />}
    <CredentialRecovery state={state} />
  </Step>;
}
