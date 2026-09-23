/**
 * [INPUT]: An optional host step renderer, account-scoped setup progress, password validators (creation checked against the signed-in email), field-specific errors and existing settings controls.
 * [OUTPUT]: Password setup with retained input nodes across retries, inline final failures and consent-aware cancellation.
 * [POS]: Setup form step 2; main owns bounded retries, refreshed reviews, encryption and durable approval.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { validatePassword, validateNewPassword, passwordsMatch } from "@ai-chat/cloud-crypto";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { getCloudEncryptionCopy } from "@ai-chat/ui/lib/cloud-copy/encryption";
import { cloudHandshakeFailed, type CloudAccountState } from "../../../../shared/cloud-ipc";
import { syncEncryptionErrorSchema } from "../../../../shared/cloud/encryption";
import { requiresSyncSetup, type SyncReview } from "../../../../shared/cloud/sync";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsAlert, SettingsButton } from "@/components/settings/settings-layout";
import { cloudAccountClient, cloudAccountSource } from "@/lib/cloud/client";
import { EncryptionFields } from "../encryption/fields";
import { passwordFailure, useEncryptionErrors } from "../encryption/field-errors";
import { CloudCleanupButton } from "../sync-cleanup";
import { SetupStep } from "./step";

export function PasswordStep({ state, Step = SetupStep }: { state: CloudAccountState; Step?: typeof SetupStep }) {
  const { t, i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const [review, setReview] = useState<SyncReview | null>(null), [scanFailed, setScanFailed] = useState(false), [inspection, setInspection] = useState(0);
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false), [abandoned, setAbandoned] = useState(false);
  const form = useRef<HTMLFormElement>(null), generation = useRef(0), approved = useRef(false);
  const inflight = useRef<Promise<SyncReview> | null>(null), submitting = useRef(false);
  const ready = state.status === "ready", { encryption, sync, syncSetup } = state;
  const userId = state.profile?.userId, deviceId = state.deviceId;
  const working = syncSetup.status === "running" || syncSetup.status === "retrying", busy = pending || working;
  const action = submitted && busy ? null : encryption.canSetPassword ? "create" : encryption.canUnlock ? "unlock" : null;
  const [mode, setMode] = useState(action);
  if (mode === null && action !== null) setMode(action);
  // A password action pins the field shape. Intermediate unlock/check states cannot discard its DOM draft.
  const passwordMode = mode ?? action, creating = passwordMode === "create", needsPassword = passwordMode !== null;
  const finalError = syncSetup.status === "failed" ? syncSetup.error : null;
  const externalError = busy || abandoned ? null : syncSetup.status === "failed" ?
    syncEncryptionErrorSchema.safeParse(finalError).data ?? null : encryption.error;
  const validation = useEncryptionErrors(externalError);

  useEffect(() => {
    if (!ready || submitted || scanFailed) return;
    let current = true;
    const request = cloudAccountClient().inspectSync(); inflight.current = request;
    request.then(value => { if (current) { setReview(value); setScanFailed(false); } })
      .catch(() => { if (current) setScanFailed(true); })
      .finally(() => { if (inflight.current === request) inflight.current = null; });
    return () => { current = false; };
  }, [ready, inspection, userId, deviceId, submitted, scanFailed]);
  useEffect(() => {
    const counter = generation, done = approved;
    return () => {
      counter.current++;
      // Durable consent can change the route before the approving IPC resolves.
      const latest = cloudAccountSource.snapshot();
      if (!done.current && latest.profile?.userId === userId && latest.deviceId === deviceId && requiresSyncSetup(latest.sync)) {
        void cloudAccountClient().cancelSyncReview().catch(() => {});
        void cloudAccountClient().cancelEncryption().catch(() => {});
      }
    };
  }, [userId, deviceId]);

  const blocked = externalError === "sync-space-changed" || externalError === "sync-encryption-unsupported" && !encryption.canRetry;
  const canProceed = needsPassword || encryption.status === "unlocked";
  const retryingSubmission = failed || syncSetup.status === "failed";
  const canSubmit = ready || retryingSubmission && state.status === "temporarily-offline";
  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || working || blocked || !canProceed || !canSubmit) return;
    validation.resetErrors();
    const values = new FormData(event.currentTarget), password = String(values.get("password") ?? ""), confirmation = String(values.get("confirmation") ?? "");
    if (needsPassword) {
      try { if (creating) validateNewPassword(password, { email: state.profile?.email }); else validatePassword(password); }
      catch (error) { validation.reportFailure(passwordFailure(error)); return; }
      let matched = !creating;
      if (creating) { try { matched = passwordsMatch(password, confirmation); } catch { matched = false; } }
      if (!matched) { validation.reportFailure("sync-password-mismatch"); return; }
    }
    const expected = ++generation.current;
    submitting.current = true;
    setAbandoned(false); setSubmitted(true); setPending(true); setFailed(false);
    let reachedMain = false;
    void (async () => {
      // An early click waits for the initial inventory; later retries let main renew its original review.
      const current = review ?? await (inflight.current ?? Promise.reject(new Error("no-review")));
      if (!current) throw new Error("no-review");
      if (expected !== generation.current) return;
      setReview(current);
      reachedMain = true;
      if (needsPassword) await cloudAccountClient().setupEncryption({ reviewId: current.reviewId, password,
        ...(creating ? { confirmation, riskAccepted: values.get("riskAccepted") === "on" } : {}) });
      else await cloudAccountClient().approveSync({ reviewId: current.reviewId });
      if (expected === generation.current) { approved.current = true; form.current?.reset(); }
    })().catch(error => {
      const cancelled = error instanceof Error && /(?:sync-operation-cancelled|cloud-request-superseded)$/.test(error.message) &&
        cloudAccountSource.snapshot().syncSetup.status !== "failed";
      if (expected === generation.current && !cancelled) {
        setFailed(true);
        if (!reachedMain) { setSubmitted(false); setScanFailed(true); }
      }
    }).finally(() => {
      if (expected === generation.current) { submitting.current = false; setPending(false); }
    });
  };
  const retryInspection = () => { setScanFailed(false); setFailed(false); setReview(null); setInspection(value => value + 1); };
  const abandon = () => {
    generation.current++; submitting.current = false;
    setAbandoned(true); setPending(false); setFailed(false); validation.resetErrors();
    void cloudAccountClient().cancelEncryption().catch(() => {});
  };
  const unavailable = cloudHandshakeFailed(state);
  const discoveryRetry = !submitted && (scanFailed || sync.error === "review-expired" || encryption.canRetry);
  const needsRetry = !busy && !blocked && (retryingSubmission || discoveryRetry);
  const networkFailure = finalError === "sync-connection-failed" || externalError === "sync-connection-failed";
  const alert = busy || abandoned ? null : networkFailure ? copy.setupConnectionFailed : validation.errors.form ??
    (finalError === "scan-failed" || scanFailed ? t("cloud.syncError.scan-failed") :
      finalError === "request-failed" || failed && !validation.errors.password && !validation.errors.confirmation ? t("cloud.actionFailed") : unavailable ? t("cloud.syncUnavailable") :
        sync.error ? t(`cloud.syncError.${sync.error}`, { host: sync.ownerHost ?? "" }) : state.error && !ready ? t(`cloud.error.${state.error}`) : null);
  const title = needsPassword ? creating ? copy.setPassword : t("cloud.setup.enterPassword") : t("cloud.setup.enable");
  const lead = busy ? encryption.status === "setting-up" ? copy.inProgress : copy.setupInProgress :
    needsPassword ? creating ? copy.setupDescription : t("cloud.setup.enterPasswordDescription") :
      encryption.status === "unlocked" ? t("cloud.setup.unlockedDescription") : alert ? "" : copy.checking;
  const disabled = busy || blocked || !canProceed || !canSubmit || !submitted && encryption.status === "checking";
  return <form ref={form} onSubmit={confirm} className="contents">
    <Step step={1} title={title} description={<><span role={busy ? "status" : undefined}>{lead}</span> {t("cloud.setup.signedInAs", { email: state.profile?.email ?? "" })}</>}
      footer={<>
        <CloudCleanupButton mode="signOut" variant="ghost" disabled={busy || state.status === "signing-out"} />
        <div className="flex items-center gap-3">
          {busy && <SettingsButton type="button" variant="ghost" onClick={abandon}>{t("cloud.cancel")}</SettingsButton>}
          {needsRetry && discoveryRetry ? <SettingsButton type="button" className="px-5" disabled={!ready} onClick={retryInspection}>{t("cloud.retry")}</SettingsButton> :
            <SettingsButton type="submit" className="px-5" disabled={disabled}>{busy && <Spinner className="size-3.5" />}{t(needsRetry ? "cloud.retry" : "cloud.setup.enable")}</SettingsButton>}
        </div>
      </>}>
      {alert && <SettingsAlert>{alert}</SettingsAlert>}
      {!ready && !busy && !unavailable && <p role="status" className="text-sm">{t(`cloud.status.${state.status}`)}</p>}
      {needsPassword && <EncryptionFields creating={creating} email={state.profile?.email} disabled={busy} errors={{ password: validation.errors.password, confirmation: validation.errors.confirmation }}
        onEdit={validation.editField} describedBy="sync-setup-description" />}
    </Step>
  </form>;
}
