/**
 * [INPUT]: Main-owned unlock status, fixed password IPC, field-specific error handling, shared recovery messages and settings controls.
 * [OUTPUT]: Provides UnlockEncryptionButton with immediate password feedback and separately retained operation errors.
 * [POS]: Daily sync settings recovery; the row it sits in states the locked fact, this file only asks for the password.
 */
import { useRef, useState, type FormEvent } from "react";
import { validatePassword } from "@ai-chat/cloud-crypto";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { AppDialogCancel, AppDialogContent, AppDialogFooter, AppDialogHeader } from "@ai-chat/ui/components/ui/app-dialog";
import { getCloudEncryptionCopy } from "@ai-chat/ui/lib/cloud-copy/encryption";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import type { SyncEncryptionState } from "../../../../shared/cloud/encryption";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { cloudAccountClient } from "@/lib/cloud/client";
import { EncryptionFields } from "./fields";
import { passwordFailure, useEncryptionErrors } from "./field-errors";
export function UnlockEncryptionButton({ state, disabled }: { state: SyncEncryptionState; disabled?: boolean }) {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const validation = useEncryptionErrors(state.error);
  const submitting = useRef(false), form = useRef<HTMLFormElement>(null), revision = useRef(0);
  const cancel = () => { revision.current++; form.current?.reset(); setOpen(false); validation.resetErrors(); void cloudAccountClient().cancelEncryption().catch(() => {}); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (submitting.current || !state.canUnlock) return;
    const values = new FormData(event.currentTarget), password = String(values.get("password") ?? ""), expected = revision.current;
    validation.resetErrors();
    try { validatePassword(password); } catch (failure) { validation.reportFailure(passwordFailure(failure)); return; }
    submitting.current = true; setBusy(true);
    void cloudAccountClient().unlockEncryption({ password }).then(() => {
      if (expected === revision.current) { form.current?.reset(); setOpen(false); }
    }).catch(() => { if (expected === revision.current) validation.reportFailure("sync-unlock-failed"); })
      .finally(() => { submitting.current = false; setBusy(false); });
  };
  return <>
    <SettingsButton disabled={disabled || !state.canUnlock} onClick={() => { validation.resetErrors(); setOpen(true); }}>{copy.unlock}</SettingsButton>
    <Dialog open={open} onOpenChange={value => { if (!value) cancel(); }}><AppDialogContent>
      <AppDialogHeader title={copy.title} description={copy.description}/>
      <form ref={form} onSubmit={submit} className="space-y-5">
        <EncryptionFields mode="unlock" disabled={busy} errors={validation.errors} onEdit={validation.editField} />
        <AppDialogFooter><AppDialogCancel type="button" onClick={cancel}>{copy.cancel}</AppDialogCancel>
          <Button type="submit" size="pill" disabled={busy || !state.canUnlock}>{busy && <Spinner />}{copy.unlock}</Button></AppDialogFooter>
      </form>
    </AppDialogContent></Dialog>
  </>;
}
