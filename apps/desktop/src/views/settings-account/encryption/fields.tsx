/**
 * [INPUT]: Shared unlock minimum/validation, the create-draft read model, encryption copy, typed field errors and native form controls.
 * [OUTPUT]: Immediately validated password fields with a live creation requirement checklist, a create-only commit card, direct Tab-to-confirmation navigation, independent visibility and associated errors.
 * [POS]: Setup form and unlock dialog fields; no derived key or persistent password state exists in renderer.
 */
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { MIN_PASSWORD_CODE_POINTS, assessNewPassword, validatePassword } from "@ai-chat/cloud-crypto";
import { Check, Circle, Eye, EyeOff, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { getCloudEncryptionCopy } from "@ai-chat/ui/lib/cloud-copy/encryption";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { assessCreateDraft, type CreateDraft, type RuleRow } from "./create-draft";
import type { EncryptionFieldErrors, PasswordField } from "./field-errors";

const labelClass = "font-medium text-[13px]/[1.45] text-muted-foreground";
const errorClass = "text-[13px]/[1.45] text-destructive";

function PasswordInput({ id, name, label, aside, inputRef, nextInputRef, autoComplete, describedBy, error, invalid = Boolean(error), onChange }: {
  id: string; name: PasswordField; label: string; aside?: ReactNode; inputRef: RefObject<HTMLInputElement | null>;
  nextInputRef?: RefObject<HTMLInputElement | null>;
  autoComplete: "new-password" | "current-password"; describedBy?: string; error?: string; invalid?: boolean; onChange: () => void;
}) {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const [visible, setVisible] = useState(false);
  const descriptions = [describedBy, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className={cn(labelClass, "flex items-center justify-between gap-3")}>
      <span>{label}</span>
      {aside}
    </label>
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

/** Requirements stay listed with their state; prohibitions appear only once the draft breaks them. */
function RuleStrip({ id, rows }: { id: string; rows: readonly RuleRow[] }) {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  // Literal property reads rather than a key map, so the encrypted-copy audit can prove every rule line has a reader.
  const ruleCopy = { "too-short": copy.ruleLength, "needs-letter": copy.ruleLetter, "needs-digit": copy.ruleDigit,
    "too-simple": copy.ruleSimple, "contains-email": copy.ruleEmail, common: copy.ruleCommon };
  return <ul id={id} aria-label={copy.passwordRules} className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]/[1.45]">
    {rows.map(row => {
      const met = row.state === "met", violated = row.state === "violated";
      const Icon = violated ? X : met ? Check : Circle;
      return <li key={row.reason} data-rule={row.reason} data-met={met} className={cn("flex items-center gap-2",
        violated ? "text-destructive" : met ? "text-foreground" : "text-muted-foreground")}>
        <Icon aria-hidden className={cn("shrink-0", met || violated ? "size-3.5" : "size-2.5 mx-0.5")} strokeWidth={met || violated ? 2.25 : 2} />
        <span>{ruleCopy[row.reason]}<span className="sr-only">{` (${met ? copy.ruleMet : copy.ruleUnmet})`}</span></span>
      </li>;
    })}
  </ul>;
}

function MatchBadge() {
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  return <span className="flex items-center gap-1 font-normal text-muted-foreground">
    <Check aria-hidden className="size-3.5" strokeWidth={2.25} />
    {copy.confirmationMatches}
  </span>;
}

interface SharedFieldProps {
  disabled: boolean;
  errors?: EncryptionFieldErrors;
  onEdit?: (field: PasswordField) => void;
}

export type EncryptionFieldsProps = SharedFieldProps & (
  | {
      mode: "create";
      /** Signed-in account email; a new password must not contain its local part. */
      email?: string | null;
      /** The dialog lede already says this passphrase is not the Google password. */
      describedBy: string;
      /** True only when assessCreateDraft has no blocker. Never carries the passphrase. */
      onReadyChange: (ready: boolean) => void;
    }
  | {
      mode: "unlock";
      /** Omitted by the daily unlock dialog, which then renders its own legend and description. */
      describedBy?: string;
    }
);

export function EncryptionFields(props: EncryptionFieldsProps) {
  const { disabled, errors = {}, onEdit } = props;
  const { i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const creating = props.mode === "create";
  const id = useId(), input = useRef<HTMLInputElement>(null), confirmation = useRef<HTMLInputElement>(null), risk = useRef<HTMLInputElement>(null);
  const edited = useRef({ password: false, confirmation: false });
  const [validation, setValidation] = useState<{ password?: "short" | "weak" | "invalid" | "long"; confirmation?: boolean }>({});
  const [draft, setDraft] = useState<CreateDraft>(() => assessCreateDraft(
    { password: "", confirmation: "", accepted: false }, { passwordEdited: false }));
  const description = props.describedBy ?? `${id}-description`, rules = `${id}-rules`;
  const publishCreate = () => {
    if (props.mode !== "create") return;
    const next = assessCreateDraft({
      password: input.current?.value ?? "", confirmation: confirmation.current?.value ?? "", accepted: risk.current?.checked === true,
    }, { email: props.email, passwordEdited: edited.current.password });
    setDraft(next);
    props.onReadyChange(next.blocker === null);
  };
  const change = (field: PasswordField) => {
    edited.current[field] = true;
    const password = input.current?.value ?? "", confirmed = confirmation.current?.value ?? "";
    const assessment = creating ? assessNewPassword(password, { email: props.mode === "create" ? props.email : undefined }) : { ok: true as const };
    let passwordIssue: typeof validation.password;
    if (edited.current.password) {
      let encodable = true;
      try { validatePassword(password); } catch { encodable = false; }
      const short = Array.from(password).length < MIN_PASSWORD_CODE_POINTS;
      // Creation shows strength in the checklist; only an encoding limit also needs a sentence.
      passwordIssue = creating ? !short && !encodable ? "long" : assessment.ok ? undefined : "weak" :
        encodable ? undefined : short ? "short" : "invalid";
    }
    // Compare the draft itself: matching short values have a length error, not a mismatch.
    setValidation({ password: passwordIssue, confirmation: creating && edited.current.confirmation && password !== confirmed });
    publishCreate();
    onEdit?.(field);
  };
  const passwordError = validation.password === "short" ? copy.passwordTooShort :
    validation.password === "long" ? copy.passwordTooLong :
    validation.password === "invalid" ? copy["sync-password-invalid"] : errors.password;
  const confirmationError = validation.confirmation ? copy.passwordMismatch : errors.confirmation;
  return <fieldset disabled={disabled} className="flex flex-col gap-4">
    {props.mode === "unlock" && !props.describedBy && <>
      <legend className="mb-3 font-medium text-sm">{copy.password}</legend>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">{copy.description}</p>
    </>}
    <div className="flex flex-col gap-2">
      <PasswordInput id={`${id}-password`} name="password" label={copy.password} inputRef={input} nextInputRef={creating ? confirmation : undefined}
        autoComplete={creating ? "new-password" : "current-password"} describedBy={creating ? `${description} ${rules}` : description}
        error={passwordError} invalid={Boolean(passwordError) || validation.password === "weak"} onChange={() => change("password")} />
      {creating && <RuleStrip id={rules} rows={draft.rules} />}
    </div>
    {creating && <PasswordInput id={`${id}-confirmation`} name="confirmation" label={copy.confirmation}
      aside={draft.match === "matches" ? <MatchBadge /> : undefined} inputRef={confirmation}
      autoComplete="new-password" error={confirmationError} onChange={() => change("confirmation")} />}
    {errors.form && <p role="alert" className={errorClass}>{errors.form}</p>}
    {props.mode === "unlock" && <p className="text-[13px]/[1.45] text-muted-foreground">{copy.independentPassword}</p>}
    {props.mode === "create" && <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/40 px-3 py-3 text-sm/5",
      draft.accepted ? "border-foreground" : "border-border")}>
      <input ref={risk} name="riskAccepted" type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-primary" onChange={publishCreate} />
      <span>{copy.risk}</span>
    </label>}
  </fieldset>;
}
