/**
 * [INPUT]: Existing sign-in/password projections, shared step/caption presentation, encryption fields and main-owned recovery actions.
 * [OUTPUT]: AccountStep embeds setup actions in the onboarding step surface and unlocks existing bindings without initial-sync inspection.
 * [POS]: Account path projection; leaving never cancels browser login and identity changes discard password drafts.
 */
import { createContext, useContext, useRef, useState, type FormEvent } from "react";
import { validatePassword } from "@ai-chat/cloud-crypto";
import { SetupStep, setupStepCaption } from "@ai-chat/ui/components/ui/setup-step";
import { Button } from "@ai-chat/ui/components/ui/button";
import { getCloudEncryptionCopy } from "@ai-chat/ui/lib/cloud-copy/encryption";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { requiresSyncSetup } from "../../../../shared/cloud/sync";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { cloudAccountClient } from "@/lib/cloud/client";
import { SignInStep } from "../../settings-account/setup/sign-in";
import { PasswordStep } from "../../settings-account/setup/password";
import type { SetupStepProps } from "../../settings-account/setup/step";
import { EncryptionFields } from "../../settings-account/encryption/fields";
import { encryptionError, passwordFailure, useEncryptionErrors } from "../../settings-account/encryption/field-errors";
import { CloudCleanupButton } from "../../settings-account/sync-cleanup";

const StepsContext = createContext<readonly string[]>([]);
/* The account step hosts the Sync setup projections inside the onboarding path: same surface, the path's own labels. */
function AccountHost(props: SetupStepProps) {
  const { t } = useAppTranslation(), steps = useContext(StepsContext);
  return <SetupStep {...props} steps={steps} step={2} caption={setupStepCaption(2, steps, t("common.stepOf", { current: 3, total: steps.length }))}
    titleId="sync-setup-title" descriptionId="sync-setup-description" />;
}

function UnlockStep({ state }: { state: CloudAccountState }) {
  const { t, i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const [pending, setPending] = useState(false), lock = useRef(false);
  const { encryption } = state, validation = useEncryptionErrors(encryption.error);
  const busy = pending || encryption.status === "unlocking" || encryption.status === "checking";
  const run = (operation: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setPending(true); validation.resetErrors();
    void operation().catch(error => validation.reportFailure(passwordFailure(error)))
      .finally(() => { lock.current = false; setPending(false); });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!encryption.canUnlock || busy || state.status !== "ready") return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    try { validatePassword(password); } catch (error) { validation.reportFailure(passwordFailure(error)); return; }
    run(() => cloudAccountClient().unlockEncryption({ password }));
  };
  const reason = validation.errors.form ?? encryptionError(encryption.error, i18n.language) ??
    (state.status !== "ready" ? t(`cloud.status.${state.status}`) : busy ? copy.checking : copy.description);
  return <form onSubmit={submit} className="contents"><AccountHost step={1} title={copy.unlock} description={reason} footer={<>
    <CloudCleanupButton mode="signOut" variant="ghost" disabled={busy} />
    {encryption.canUnlock ? <Button type="submit" disabled={busy || state.status !== "ready"}>{busy ? copy.unlocking : copy.unlock}</Button> :
      encryption.canRetry ? <Button type="button" disabled={busy || state.status !== "ready"} onClick={() => run(() => cloudAccountClient().retryEncryption())}>{t("cloud.retry")}</Button> : null}
  </>}>
    {encryption.canUnlock && <EncryptionFields creating={false} disabled={busy} errors={validation.errors} onEdit={validation.editField} describedBy="sync-setup-description" />}
    {!encryption.canUnlock && !encryption.canRetry && <p role="status" className="text-sm text-muted-foreground">{busy ? copy.checking : copy.unavailable}</p>}
  </AccountHost></form>;
}

export function AccountStep({ state, steps, onBack }: { state: CloudAccountState; steps: readonly string[]; onBack: () => void }) {
  return <StepsContext.Provider value={steps}>
    {!state.profile ? <SignInStep state={state} Step={AccountHost} onBack={onBack} /> : requiresSyncSetup(state.sync) ?
      <PasswordStep key={state.profile.userId} state={state} Step={AccountHost} /> : <UnlockStep key={state.profile.userId} state={state} />}
  </StepsContext.Provider>;
}
