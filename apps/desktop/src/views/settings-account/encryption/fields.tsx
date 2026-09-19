/**
 * [INPUT]: Shared password minimum/validation, encryption copy, typed field errors and native form controls.
 * [OUTPUT]: Immediately validated password fields with direct Tab-to-confirmation navigation, independent visibility, associated errors and creation-only acknowledgement.
 * [POS]: Setup form and unlock dialog fields; no derived key or persistent password state exists in renderer.
 */
import { useId, useRef, useState, type RefObject } from "react";
import { MIN_PASSWORD_CODE_POINTS, validatePassword, validateNewPassword } from "@ai-chat/cloud-crypto";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { getCloudEncryptionCopy } from "@ai-chat/ui/lib/cloud-copy/encryption";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { EncryptionFieldErrors, PasswordField } from "./field-errors";
const labelClass = "font-medium text-[13px]/[1.45] text-muted-foreground";
const errorClass = "text-[13px]/[1.45] text-destructive";

function PasswordInput({ id, name, label, inputRef, nextInputRef, autoComplete, describedBy, error, onChange }: {
  id: string; name: PasswordField; label: string; inputRef: RefObject<HTMLInputElement | null>;
  nextInputRef?: RefObject<HTMLInputElement | null>;
  autoComplete: "new-password" | "current-password"; describedBy?: string; error?: string; onChange: () => void;
}) {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const [visible, setVisible] = useState(false);
  const descriptions = [describedBy, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className={labelClass}>{label}</label>
    <div className="relative">
      <Input ref={inputRef} id={id} name={name} type={visible ? "text" : "password"} size="lg"
        autoComplete={autoComplete} spellCheck={false} required maxLength={1024} onChange={onChange} onInvalid={onChange}
        aria-invalid={Boolean(error)} aria-describedby={descriptions} className="pr-12"
        onKeyDown={event => {
          const next = nextInputRef?.current;
          if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !next || next.matches(":disabled")) return;
          // Keep forward form entry direct; Shift+Tab can still reach the visibility button.
          event.preventDefault(); next.focus();
        }} />
      <Button type="button" size="icon" variant="ghost" className="absolute top-0 right-0 h-full w-11"
        aria-label={visible ? copy.hidePassword : copy.showPassword} aria-pressed={visible} aria-controls={id}
        onClick={() => { setVisible(value => !value); inputRef.current?.focus(); }}>{visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</Button>
    </div>
    {error && <p id={`${id}-error`} role="alert" className={errorClass}>{error}</p>}
  </div>;
}

export function EncryptionFields({ creating, disabled, errors = {}, onEdit, describedBy }: {
  creating: boolean; disabled: boolean; errors?: EncryptionFieldErrors; onEdit?: (field: PasswordField) => void;
  /** The id of a heading description already on screen; given, no legend or description is rendered here. */
  describedBy?: string;
}) {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const id = useId(), input = useRef<HTMLInputElement>(null), confirmation = useRef<HTMLInputElement>(null);
  const edited = useRef({ password: false, confirmation: false });
  const [validation, setValidation] = useState<{ password?: "short" | "composition" | "invalid"; confirmation?: boolean }>({});
  const description = describedBy ?? `${id}-description`;
  const change = (field: PasswordField) => {
    edited.current[field] = true;
    const password = input.current?.value ?? "", confirmed = confirmation.current?.value ?? "";
    let passwordIssue: typeof validation.password;
    if (edited.current.password) {
      try { (creating ? validateNewPassword : validatePassword)(password); }
      catch (error) { passwordIssue = Array.from(password).length < MIN_PASSWORD_CODE_POINTS ? "short" :
        error instanceof Error && error.message === "sync-password-weak" ? "composition" : "invalid"; }
    }
    // Compare the draft itself: matching short values have a length error, not a mismatch.
    setValidation({ password: passwordIssue, confirmation: creating && edited.current.confirmation && password !== confirmed });
    onEdit?.(field);
  };
  const passwordError = validation.password === "short" ? copy.passwordTooShort :
    validation.password === "composition" ? copy["sync-password-weak"] :
    validation.password === "invalid" ? copy["sync-password-invalid"] : errors.password;
  const confirmationError = validation.confirmation ? copy.passwordMismatch : errors.confirmation;
  return <fieldset disabled={disabled} className="flex flex-col gap-4">
    {!describedBy && <>
      <legend className="mb-3 font-medium text-sm">{creating ? copy.setPassword : copy.password}</legend>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">{creating ? copy.setupDescription : copy.description}</p>
    </>}
    <PasswordInput id={`${id}-password`} name="password" label={copy.password} inputRef={input} nextInputRef={creating ? confirmation : undefined}
      autoComplete={creating ? "new-password" : "current-password"} describedBy={description} error={passwordError} onChange={() => change("password")} />
    {creating && <PasswordInput id={`${id}-confirmation`} name="confirmation" label={copy.confirmation} inputRef={confirmation}
      autoComplete="new-password" error={confirmationError} onChange={() => change("confirmation")} />}
    {errors.form && <p role="alert" className={errorClass}>{errors.form}</p>}
    <p className="text-[13px]/[1.45] text-muted-foreground">{copy.independentPassword}</p>
    {creating && <>
      <hr className="border-border" />
      <p className="text-[13px]/[1.45] text-muted-foreground">{copy.unrecoverableCloud}</p>
      <label className="flex cursor-pointer items-start gap-3 text-sm/5">
        <input name="riskAccepted" type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span>{copy.risk}</span>
      </label>
    </>}
  </fieldset>;
}
