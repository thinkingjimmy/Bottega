/**
 * [INPUT]: Depends on closed account progress, the main-issued approval URL, the clipboard facade, Lucide Loader2 and the shared Input.
 * [OUTPUT]: Provides loginFlags, useLoginLink (copy with an expiry fence and a selectable fallback after a clipboard failure), LoginProgress (status, retrying failures, verification code, unconfirmed-cancellation notes) and LoginLinkFallback.
 * [POS]: Sign-in step body of the setup form; the step owns the footer buttons, this file owns what they need to know. Only the state-only browser URL is exposed, never proof verifiers or credentials.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@ai-chat/ui/components/ui/input";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { writeClipboardText } from "@/lib/agent-client";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";

export type LoginAction = "startLogin" | "cancelLogin" | "abandonLogin" | "reopenLogin" | "retryLoginSave" | "openCloudAccount";

/* Failures main retries by itself every couple of seconds while a request is still pending. */
const RETRYABLE_ERRORS = new Set(["connection-failed", "request-failed"]);

/* The three facts the body and the footer both read; computed once so the two
   halves of the card can never disagree about whether the browser is in play. */
export function loginFlags(state: CloudAccountState, busy: ReadonlySet<LoginAction>) {
  const pending = state.pendingLogin;
  const cancelling = state.loginCancelling || pending?.progress === "cancelling" || busy.has("cancelLogin");
  const browser = Boolean(pending && ["opening", "waiting", "connection-failed"].includes(pending.progress) &&
    !state.canRetryLoginSave && !["encryption-unavailable", "credentials-unreadable"].includes(state.error ?? ""));
  return { pending, cancelling, browser };
}

export function useLoginLink(url: string | null, expiresAt: number) {
  const active = useRef(false), copying = useRef(false);
  /* Both facts remember which link they belong to, so a replacement link starts idle
     and un-expired, and a late completion can never mark the new link as copied. */
  const [expiry, setExpiry] = useState<{ url: string | null; expired: boolean }>({ url: null, expired: false });
  const [outcome, setOutcome] = useState<{ url: string | null; state: "idle" | "copying" | "copied" | "failed" }>({ url: null, state: "idle" });
  useEffect(() => {
    active.current = true;
    const timer = setTimeout(() => setExpiry({ url, expired: true }), Math.max(0, expiresAt - Date.now()));
    return () => { active.current = false; clearTimeout(timer); };
  }, [url, expiresAt]);
  const expired = expiry.url === url && expiry.expired;
  const copyState = outcome.url === url ? outcome.state : "idle";
  const copy = async () => {
    if (!url) return;
    if (expiresAt <= Date.now()) { setExpiry({ url, expired: true }); return; }
    if (copying.current) return;
    copying.current = true; setOutcome({ url, state: "copying" });
    try { await writeClipboardText(url); if (active.current) setOutcome({ url, state: "copied" }); }
    catch { if (active.current) setOutcome({ url, state: "failed" }); }
    finally { copying.current = false; }
  };
  return { url: url && !expired ? url : null, copyState, copy };
}

/* Shown only after a clipboard failure: the link, selected, for copying by hand. */
function LoginLinkFallback({ link }: { link: ReturnType<typeof useLoginLink> }) {
  const { t } = useAppTranslation(), id = useId(), input = useRef<HTMLInputElement>(null);
  const visible = Boolean(link.url) && link.copyState === "failed";
  useEffect(() => { if (visible) { input.current?.focus(); input.current?.select(); } }, [visible]);
  if (!visible) return null;
  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="font-medium text-[13px]/[1.45] text-muted-foreground">{t("cloud.loginLinkLabel")}</label>
    <Input ref={input} id={id} value={link.url ?? ""} readOnly spellCheck={false} autoComplete="off" size="lg"
      aria-describedby={`${id}-error`} className="min-w-0 font-mono" onFocus={event => event.currentTarget.select()} />
    <p id={`${id}-error`} role="alert" className="text-[13px]/[1.45] text-destructive">{t("cloud.loginLinkCopyFailed")}</p>
    <p className="text-muted-foreground text-xs">{t("cloud.loginLinkDescription")}</p>
  </div>;
}

export function LoginProgress({ state, busy, link }: { state: CloudAccountState; busy: ReadonlySet<LoginAction>; link: ReturnType<typeof useLoginLink> }) {
  const { t } = useAppTranslation(), errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (state.error) errorRef.current?.focus(); }, [state.error]);
  const { pending } = loginFlags(state, busy);
  /* main keeps retrying these on its own timer: showing them as terminal makes users cancel a
     sign-in that would have completed, so the phase stays primary and the reason becomes a note. */
  const retrying = Boolean(pending) && RETRYABLE_ERRORS.has(state.error ?? "");
  return <div className="flex flex-col gap-5">
    <div className="flex items-start gap-3">
      {(!state.error || retrying) && <Loader2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />}
      <div className="min-w-0">
        {state.error && !retrying ? <p ref={errorRef} role="alert" tabIndex={-1} className="font-medium text-sm text-destructive">{t(`cloud.error.${state.error}`)}</p> :
          <p role="status" className="font-medium text-sm">{pending ? t(`cloud.pending.${pending.progress}`) : t(state.loginCancelling ? "cloud.pending.cancelling" : "cloud.pending.preparing")}</p>}
        {retrying && <p className="mt-1 text-[13px]/[1.45] text-muted-foreground">{t(`cloud.error.${state.error}`)}</p>}
        {pending?.progress === "waiting" && !state.error && <p className="mt-1 text-[11px]/4 text-muted-foreground">{t("cloud.expires")}</p>}
        {pending?.progress === "securing" && pending.platform === "macos" && <p className="mt-1 text-[11px]/4 text-muted-foreground">{t("cloud.secureStorageDescription")}</p>}
        {state.error === "encryption-unavailable" && <p className="mt-1 text-sm">{t("cloud.secureStorageRestart")}</p>}
        {state.cancelUnconfirmed && <>
          <p role="status" className="mt-1 text-sm">{t("cloud.cancelUnconfirmed")}</p>
          {/* The footer offers the local exit; this sentence is what the user gives up by taking it. */}
          <p className="mt-1 text-[13px]/[1.45] text-muted-foreground">{t("cloud.abandonLoginNote")}</p>
        </>}
      </div>
    </div>
    {/* Only the code is shown: the eight-digit comparison is the bridge's actual check,
        and the Web approval page asks for exactly that comparison. */}
    {pending && <div>
      <p className="font-medium text-[13px]/[1.45] text-muted-foreground">{t("cloud.verificationCode")}</p>
      <p className="mt-1 font-mono text-[28px]/9 tabular-nums tracking-[0.12em]">{pending.verificationCode.slice(0, 4)} {pending.verificationCode.slice(4)}</p>
      <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">{t("cloud.setup.checkCode")}</p>
    </div>}
    <LoginLinkFallback link={link} />
  </div>;
}
