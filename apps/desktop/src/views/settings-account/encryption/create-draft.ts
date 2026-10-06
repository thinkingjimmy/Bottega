/**
 * [INPUT]: Creation assessment, unlock encoding and exact confirmation comparison from cloud-crypto.
 * [OUTPUT]: The one create-draft read model, and the submit gate that focuses the first blocker.
 * [POS]: Pure admission for the sync-password dialog; the passphrase stays in the form and never enters React state.
 */
import { assessNewPassword, NEW_PASSWORD_REASONS, passwordsMatch, validatePassword, type NewPasswordReason } from "@ai-chat/cloud-crypto";
import type { SyncEncryptionError } from "../../../../shared/cloud/encryption";

const REQUIRED = ["too-short", "needs-letter", "needs-digit"] as const satisfies readonly NewPasswordReason[];
const CREATE_CONTROLS = ["password", "confirmation", "riskAccepted"] as const;
type CreateControl = typeof CREATE_CONTROLS[number];

export interface CreateDraftInput { password: string; confirmation: string; accepted: boolean }
export type RuleState = "met" | "unmet" | "violated";
export interface RuleRow { reason: NewPasswordReason; state: RuleState }
export type MatchState = "empty" | "matches" | "differs";

/** blocker === null only when the new password passes, the confirmation matches, and the risk is accepted. */
export interface CreateDraft {
  rules: readonly RuleRow[];
  match: MatchState;
  accepted: boolean;
  /** assessNewPassword passed. A short value is not admitted, even when it also fails encoding. */
  admitted: boolean;
  encodable: boolean;
  blocker: CreateControl | null;
}

function required(reason: NewPasswordReason): boolean {
  return (REQUIRED as readonly NewPasswordReason[]).includes(reason);
}

/**
 * Live readiness and submit both call this. An empty confirmation is not a match.
 * A failed strength check stays sync-password-weak even when the value is also too short to encode.
 */
export function assessCreateDraft(input: CreateDraftInput, context: { email?: string | null; passwordEdited: boolean }): CreateDraft {
  const assessment = assessNewPassword(input.password, { email: context.email });
  let encodable = true;
  try { validatePassword(input.password); } catch { encodable = false; }
  const unmet = assessment.ok ? [] : assessment.reasons;
  const rules = NEW_PASSWORD_REASONS
    .filter(reason => required(reason) || context.passwordEdited && unmet.includes(reason))
    .map((reason): RuleRow => ({
      reason,
      state: required(reason) ? !context.passwordEdited || unmet.includes(reason) ? "unmet" : "met" : "violated",
    }));
  let matched = false;
  if (input.confirmation !== "") {
    try { matched = passwordsMatch(input.password, input.confirmation); } catch { matched = false; }
  }
  const match: MatchState = input.confirmation === "" ? "empty" : matched ? "matches" : "differs";
  const blocker: CreateControl | null = !assessment.ok || !encodable ? "password"
    : match !== "matches" ? "confirmation"
    : !input.accepted ? "riskAccepted" : null;
  return { rules, match, accepted: input.accepted, admitted: assessment.ok, encodable, blocker };
}

function readCreateDraft(form: HTMLFormElement): CreateDraftInput {
  const values = new FormData(form);
  return {
    password: String(values.get("password") ?? ""),
    confirmation: String(values.get("confirmation") ?? ""),
    accepted: values.get("riskAccepted") === "on",
  };
}

function focusControl(form: HTMLFormElement, control: CreateControl): void {
  const name = CREATE_CONTROLS.find(item => item === control);
  if (!name) return;
  const node = form.elements.namedItem(name);
  if (node instanceof HTMLElement) node.focus();
}

export type CreateGate = { ok: true } | { ok: false; failure: SyncEncryptionError | null };

/** `failure` is null only for an unchecked risk box: focus it, and do not show the 8-character error. */
export function gateCreateSubmit(form: HTMLFormElement, context: { email?: string | null }): CreateGate {
  const draft = assessCreateDraft(readCreateDraft(form), { email: context.email, passwordEdited: true });
  if (!draft.blocker) return { ok: true };
  focusControl(form, draft.blocker);
  if (draft.blocker === "riskAccepted") return { ok: false, failure: null };
  if (draft.blocker === "confirmation") return { ok: false, failure: "sync-password-mismatch" };
  return { ok: false, failure: draft.admitted ? "sync-password-invalid" : "sync-password-weak" };
}
