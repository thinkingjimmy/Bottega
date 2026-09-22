/**
 * [INPUT]: Exact account, Chat incarnation, execution computer and generation, with shared risk disclosure.
 * [OUTPUT]: Explicit scope-bound Full Access confirmation and cancellation without a global grant; each command binds the scope to its own intent.
 * [POS]: UI consent boundary; main independently validates the returned scope before dispatch.
 */
import { useEffect, useRef, useState } from "react";
import { remoteConsentScopeMatches, type RemoteConsentScope } from "@ai-chat/cloud-protocol/remote/input/model";
import { FullAccessDialog } from "../../composer/controls/full-access";
import type { RemoteDraftStore } from "../../../platform/remote/input/draft";
import { remoteInputCopy } from "./copy";
export function useRemoteConsent(store: RemoteDraftStore, locale: string, computer: string, identity: string) {
  const [pending, setPending] = useState<RemoteConsentScope | null>(null);
  const settle = useRef<((value: RemoteConsentScope | null) => void) | null>(null);
  const finish = (value: RemoteConsentScope | null) => { const done = settle.current; settle.current = null; setPending(null); done?.(value); };
  useEffect(() => () => { settle.current?.(null); settle.current = null; }, [store, identity]);
  const [owner, setOwner] = useState({ store, identity });
  if (owner.store !== store || owner.identity !== identity) { setOwner({ store, identity }); setPending(null); }
  const confirm = async (scope: RemoteConsentScope) => {
    const consent = store.snapshot().consent;
    if (remoteConsentScopeMatches(consent, scope)) return consent;
    settle.current?.(null);
    setPending(scope);
    return new Promise<RemoteConsentScope | null>(resolve => { settle.current = resolve; });
  };
  return { confirm, dialog: <FullAccessDialog locale={locale} open={Boolean(pending)} scopeLabel={remoteInputCopy(locale).scope.replace("{computer}", computer)} busy={false} error=""
    onCancel={() => finish(null)} onConfirm={() => { if (pending) store.update({ consent: pending }); finish(pending); }}
    onLearnMore={() => window.open("https://learn.chatgpt.com/docs/sandboxing?surface=app#how-you-control-it", "_blank", "noopener,noreferrer")} /> };
}
