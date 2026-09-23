/**
 * [INPUT]: Shared unlock minimum/validation and creation assessment, encryption copy, typed field errors and native form controls.
 * [OUTPUT]: Immediately validated password fields with a live creation requirement checklist, direct Tab-to-confirmation navigation, independent visibility, associated errors and creation-only acknowledgement.
 * [POS]: Setup form and unlock dialog fields; no derived key or persistent password state exists in renderer.
 */
import { useId, useRef, useState, type RefObject } from "react";
import { MIN_PASSWORD_CODE_POINTS, NEW_PASSWORD_REASONS, assessNewPassword, validatePassword, type NewPasswordReason } from "@ai-chat/cloud-crypto";
import { Check, Circle, Eye, EyeOff, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { getCloudEncryptionCopy, type CloudEncryptionCopy } from "@ai-chat/ui/lib/cloud-copy/encryption";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { EncryptionFieldErrors, PasswordField } from "./field-errors";
const labelClass = "font-medium text-[13px]/[1.45] text-muted-foreground";
const errorClass = "text-[13px]/[1.45] text-destructive";

function PasswordInput({ id, name, label, inputRef, nextInputRef, autoComplete, describedBy, error, invalid = Boolean(error), onChange }: {
  id: string; name: PasswordField; label: string; inputRef: RefObject<HTMLInputElement | null>;
  nextInputRef?: RefObject<HTMLInputElement | null>;
  autoComplete: "new-password" | "current-password"; describedBy?: string; error?: string; invalid?: boolean; onChange: () => void;
}) {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const [visible, setVisible] = useState(false);
  const descriptions = [describedBy, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className={labelClass}>{label}</label>
    <div className="relative">
      <Input ref={inputRef} id={id} name={name} type={visible ? "text" : "password"} size="lg"
        autoComplete={autoComplete} spellCheck={false} required maxLength={1024} onChange={onChange} onInvalid={onChange}
        aria-invalid={invalid} aria-describedby={descriptions} className="pr-12"
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

const RULE_COPY: Record<NewPasswordReason, keyof CloudEncryptionCopy> = { "too-short": "ruleLength", "needs-letter": "ruleLetter",
  "needs-digit": "ruleDigit", "too-simple": "ruleSimple", "contains-email": "ruleEmail", common: "ruleCommon" };
const REQUIRED: readonly NewPasswordReason[] = ["too-short", "needs-letter", "needs-digit"];

/** Requirements stay listed with their state; prohibitions appear only once the draft breaks them. */
function PasswordRules({ id, unmet, edited }: { id: string; unmet: readonly NewPasswordReason[]; edited: boolean }) {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const shown = NEW_PASSWORD_REASONS.filter(reason => REQUIRED.includes(reason) || edited && unmet.includes(reason));
  return <ul id={id} aria-label={copy.passwordRules} className="flex flex-col gap-1 text-[13px]/[1.45]">
    {shown.map(reason => {
      const met = !unmet.includes(reason), violated = !REQUIRED.includes(reason);
      const Icon = violated ? X : met ? Check : Circle;
      return <li key={reason} data-rule={reason} data-met={met} className={cn("flex items-center gap-2",
        violated ? "text-destructive" : met ? "text-foreground" : "text-muted-foreground")}>
        <Icon aria-hidden className={cn("shrink-0", met || violated ? "size-3.5" : "size-2.5 mx-0.5")} strokeWidth={met || violated ? 2.25 : 2} />
        <span>{copy[RULE_COPY[reason]]}<span className="sr-only">{` (${met ? copy.ruleMet : copy.ruleUnmet})`}</span></span>
      </li>;
    })}
  </ul>;
}

export function EncryptionFields({ creating, disabled, errors = {}, onEdit, describedBy, email }: {
  creating: boolean; disabled: boolean; errors?: EncryptionFieldErrors; onEdit?: (field: PasswordField) => void;
  /** Signed-in account email; a new password must not contain its local part. */
  email?: string | null;
  /** The id of a heading description already on screen; given, no legend or description is rendered here. */
  describedBy?: string;
}) {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const id = useId(), input = useRef<HTMLInputElement>(null), confirmation = useRef<HTMLInputElement>(null);
  const edited = useRef({ password: false, confirmation: false });
  const [validation, setValidation] = useState<{ password?: "short" | "weak" | "invalid" | "long"; confirmation?: boolean }>({});
  // null until the password is first edited: requirements start unmet and prohibitions stay hidden.
  const [unmet, setUnmet] = useState<readonly NewPasswordReason[] | null>(null);
  const description = describedBy ?? `${id}-description`, rules = `${id}-rules`;
  const change = (field: PasswordField) => {
    edited.current[field] = true;
    const password = input.current?.value ?? "", confirmed = confirmation.current?.value ?? "";
    const assessment = creating ? assessNewPassword(password, { email }) : { ok: true as const };
    let passwordIssue: typeof validation.password;
    if (edited.current.password) {
      let encodable = true;
      try { validatePassword(password); } catch { encodable = false; }
      const short = Array.from(password).length < MIN_PASSWORD_CODE_POINTS;
      // Creation shows strength in the checklist; only an encoding limit also needs a sentence.
      passwordIssue = creating ? !short && !encodable ? "long" : assessment.ok ? undefined : "weak" :
        encodable ? undefined : short ? "short" : "invalid";
    }
    if (creating && edited.current.password) setUnmet(assessment.ok ? [] : assessment.reasons);
    // Compare the draft itself: matching short values have a length error, not a mismatch.
    setValidation({ password: passwordIssue, confirmation: creating && edited.current.confirmation && password !== confirmed });
    onEdit?.(field);
  };
  const passwordError = validation.password === "short" ? copy.passwordTooShort :
    validation.password === "long" ? copy.passwordTooLong :
    validation.password === "invalid" ? copy["sync-password-invalid"] : errors.password;
  const confirmationError = validation.confirmation ? copy.passwordMismatch : errors.confirmation;
  return <fieldset disabled={disabled} className="flex flex-col gap-4">
    {!describedBy && <>
      <legend className="mb-3 font-medium text-sm">{creating ? copy.setPassword : copy.password}</legend>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">{creating ? copy.setupDescription : copy.description}</p>
    </>}
    <div className="flex flex-col gap-2">
      <PasswordInput id={`${id}-password`} name="password" label={copy.password} inputRef={input} nextInputRef={creating ? confirmation : undefined}
        autoComplete={creating ? "new-password" : "current-password"} describedBy={creating ? `${description} ${rules}` : description}
        error={passwordError} invalid={Boolean(passwordError) || validation.password === "weak"} onChange={() => change("password")} />
      {creating && <PasswordRules id={rules} unmet={unmet ?? REQUIRED} edited={unmet !== null} />}
    </div>
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
