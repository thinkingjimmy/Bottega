/**
 * [INPUT]: Depends on remote ExecutorFacade creation receipts, canonical UTF-8 text budgets, target capabilities and catalogs, the shared first-message readiness flow and host-owned completion/local-navigation callbacks.
 * [OUTPUT]: Frozen first-send intent, visible sent progress, editable next draft, online-only defaults and inline structured recovery with separate custody for unsent original and newer drafts.
 * [POS]: Shared creation form; explicit submit intent owns the automatic first message until preparation, cancellation or route handoff.
 */
import { useRemoteReferences } from "./composer/input/references";
import { remoteDraftStore, handoffRemoteDraft } from "../../platform/remote/input/draft";
import { remoteCommandSession } from "../../platform/remote/commands/registry";
import { useRemoteDraft } from "../../platform/remote/input/hooks";
import { useRemoteComposerControls } from "./composer/controls";
import { useRemoteConsent } from "./composer/consent";
import { useRemoteFeedback } from "./composer/feedback";
import { RemoteEditor } from "./composer/input/editor";
import { budgetLabel, computerFace, sendAction } from "./composer/status";
import { remoteInputCopy } from "./composer/copy";
import { ComposerModelSelector, type ModelChoice } from "../composer/controls/model";
import { utf8Length } from "@ai-chat/cloud-protocol/chats/content/parts";
import { REMOTE_LIMITS, type RemoteTurnOptions } from "@ai-chat/cloud-protocol/remote/model";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PromptInputSubmit, PromptInputTools } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { Button } from "@ai-chat/ui/components/ui/button";
import { ComposerDock, ComposerForm, ComposerToolbar, ComposerActions } from "../composer/layout";
import { ChatEmptyState } from "../composer/empty";
import { composerCopy } from "../composer/copy";
import { FirstMessageFailure } from "../../platform/remote/creation/first-message";
import { createAndSend } from "../../platform/remote/creation/submit";
import type { ChatPlatform } from "../../platform/contracts";
import type { RemoteCreated, RemoteCreateInput } from "../../platform/remote/contracts";
import { useChatAccount } from "../../platform/presentation/hooks";
import { useRemoteTargets } from "../../platform/remote/hooks";
import { reasonCopy } from "./delivery/receipts";
import { remoteReasonSchema, type RemoteReason } from "@ai-chat/cloud-protocol/remote/model";
import { remoteCopy } from "../../i18n/remote";
import { DeviceSelector, RemoteAgentSelector, targetReason } from "./computer/selectors";
import { RemoteUnavailable } from "./computer/unavailable";
import { PlatformGlyph } from "./computer/glyphs";
export function RemoteCreateChat({ platform, locale, projectId, onCreated, onDirtyChange, heading: _heading = true, defaultDeviceId, draft, onLocalSelect, context, disabledActions }: {
  platform: Pick<ChatPlatform, "account"> & Partial<Pick<ChatPlatform, "chats" | "commands" | "skills" | "capabilities" | "transcript">> & { executor: Pick<ChatPlatform["executor"], "remote"> }; locale: string; projectId: string | null;
  disabledActions?: import("./computer/unavailable").UnavailableAction[];
  defaultDeviceId?: string | null; draft?: { text: string; change(text: string): void; unsupported?: boolean }; onLocalSelect?(): void; context?: ReactNode;
  onCreated(receipt: RemoteCreated, text: string): void | Promise<void>; onDirtyChange?(dirty: boolean): void; heading?: boolean;
}) {
  const copy = remoteCopy(locale), input = remoteInputCopy(locale), port = platform.executor.remote, account = useChatAccount(platform.account), targets = useRemoteTargets(port, null, projectId);
  const [selection, setSelection] = useState<string | null>(null), [backend, setBackend] = useState<RemoteCreateInput["backend"] | null>(null);
  const draftKey = `new:${projectId ?? "root"}`, store = remoteDraftStore(platform, draftKey, draft?.text);
  const completeDraft = useRemoteDraft(store, platform.commands?.remote);
  const attempt = completeDraft.creation ?? null, setAttempt = (value: typeof attempt) => store.update({ creation: value });
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<RemoteReason | null>(null);
  const text = draft?.text ?? completeDraft.text, setText = (value: string) => { store.text(value); draft?.change(value); };
  const flight = useRef(false), mounted = useRef(true), lifecycle = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lifecycle.current?.abort(); }; }, []);
  const protocol = targets.value?.sourceProtocolVersion ?? -1, targetId = attempt?.input.targetDeviceId ?? selection ?? (targets.items.some(item => item.deviceId === defaultDeviceId && item.online) ? defaultDeviceId : null) ?? (targets.items.some(item => item.online && item.deviceId === targets.value?.preferredDeviceId) ? targets.value?.preferredDeviceId : null) ?? "";
  const target = targets.items.find(item => item.deviceId === targetId), selected = target?.online && target.protocolVersion === protocol ? targetId : "";
  const agent = attempt?.input.backend ?? backend ?? target?.agents.find(value => value.available)?.backend ?? target?.agents[0]?.backend ?? "";
  const connected = Boolean(port) && account.state === "ready" && !targets.error, allowed = Boolean(connected && targets.value?.remoteControlEnabled);
  const capability = target?.agents.find(value => value.backend === agent);
  const permissionMode = attempt?.permissionMode ?? completeDraft.permissionMode ?? capability?.options?.permissionMode ?? "approve-for-me";
  const choice = completeDraft.options?.backend === agent ? completeDraft.options : null;
  const feedback = useRemoteFeedback(copy);
  const controls = useRemoteComposerControls({ store, draft: completeDraft, port: platform.commands?.remote, capabilities: capability?.capabilities,
    permissionMode, locale, backend: agent, disabled: busy || Boolean(attempt), copy, feedback });
  const consent = useRemoteConsent(store, locale, target?.name ?? "", `${targetId}/${agent}`);
  const references = useRemoteReferences({ platform, head: null, session: null, target, projectId, store, locale, disabled: busy || Boolean(attempt) });
  const hasInput = Boolean(text.trim() || completeDraft.files.length || completeDraft.references.length);
  const bytes = utf8Length(text), tooLong = bytes > REMOTE_LIMITS.textBytes;
  const disabled = controls.unsupported || controls.editing || tooLong || Boolean(draft?.unsupported) || !allowed || !target || !selected || Boolean(target && targetReason(target, protocol, copy)) || !target.agents.some(value => value.backend === agent && value.available);
  const remoteBlockedReason = !allowed ? targets.value?.remoteControlEnabled === false ? copy.disabled : copy.disconnected : null;
  useEffect(() => { onDirtyChange?.(hasInput || Boolean(attempt)); }, [hasInput, attempt, onDirtyChange]);
  const create = async () => {
    if (!port || !allowed || flight.current || (!attempt && (disabled || !hasInput))) return;
    const input = attempt?.input ?? { createOperationId: crypto.randomUUID(), targetDeviceId: selected, backend: agent as RemoteCreateInput["backend"], projectId };
    const commandId = attempt?.commandId ?? crypto.randomUUID();
    const options = choice ? modelChoice(choice) : undefined;
    const retained = attempt ?? { input, commandId, text, permissionMode, planMode: completeDraft.planMode, references: completeDraft.references.map(reference => reference.value), ...(options ? { options } : {}) };
    const abort = new AbortController(), owner = platform.account.snapshot(); lifecycle.current = abort;
    const valid = () => {
      const current = platform.account.snapshot();
      return mounted.current && !abort.signal.aborted && !platform.commands?.remote?.lifetime?.aborted && current.state === "ready" && current.profile?.userId === owner.profile?.userId && current.deviceId === owner.deviceId;
    };
    const stopAccount = platform.account.subscribe(() => { if (!valid()) abort.abort(); });
    flight.current = true; setBusy(true); setFailure(null); feedback.dismiss(); setAttempt(retained);
    if (!attempt) setText("");
    try {
      if (!platform.chats || !platform.commands) throw new FirstMessageFailure("remote-disabled");
      const receipt = await createAndSend({ account: platform.account, chats: platform.chats, commands: platform.commands,
        executor: platform.executor as ChatPlatform["executor"] }, store, retained, abort.signal, consent.confirm);
      if (valid()) { handoffRemoteDraft(platform, draftKey, `chat:${receipt.chatId}/${receipt.incarnationId}`); await onCreated(receipt, store.snapshot().text); store.update({ creation: null }); }
    } catch (error) {
      if (mounted.current) {
        const reason = remoteReasonSchema.safeParse(error && typeof error === "object" && "data" in error ? error.data : error instanceof Error ? error.message : error);
        if (error instanceof FirstMessageFailure && error.reason === "capacity-exceeded" && !store.snapshot().text) setText(retained.text);
        setFailure(error instanceof FirstMessageFailure ? error.reason : reason.success ? reason.data : "outcome-unknown");
      }
    }
    finally { stopAccount(); flight.current = false; if (mounted.current) setBusy(false); }
  };
  // The first target page in flight is "Connecting…", not a blocked remote: only the menu rows need the reason then.
  const face = computerFace(copy, { blocked: connected && targets.value === null ? null : remoteBlockedReason, loading: targets.value === null, target, selected: Boolean(selected),
    protocol, revoked: false, attention: false, localDeviceId: targets.value?.localDeviceId ?? null });
  const action = sendAction(copy, { head: null, target, ready: true, busy, retryCreate: Boolean(attempt) && !busy });
  const unavailable = targets.value !== null && targets.value?.remoteControlEnabled === false && !onLocalSelect;
  return <section className="flex h-full min-h-0 flex-col" aria-label={copy.newChat}>
    {attempt ? <div className="flex min-h-0 flex-1 flex-col justify-end overflow-auto p-4">
      <p className="whitespace-pre-wrap break-words">{attempt.text}</p>
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><span className="chat-remote-working" aria-hidden="true" />{copy.sent}</p>}
    </div> : <ChatEmptyState title={composerCopy(locale).empty} />}
    <ComposerDock className="chat-remote"><fieldset disabled={busy || Boolean(attempt)} className="min-w-0">{context}</fieldset>
      {unavailable ? <RemoteUnavailable icon={<PlatformGlyph kind="none" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />} title={copy.disabled} description={copy.disabledDescription} actions={disabledActions} /> : <ComposerForm className="chat-remote-form" onSubmit={event => { event.preventDefault(); void create(); }} aria-busy={busy} {...controls.events}>
        {controls.files}
        <RemoteEditor references={completeDraft.references} suggestions={references}
          removeReference={key => store.update({ references: store.snapshot().references.filter(item => (item.value.kind === "file" ? `file:${item.value.path}` : `library:${item.value.libraryId}`) !== key) })} text={text} change={setText} files={completeDraft.files} remove={id => { if (!attempt) store.remove(id); }} disabled={false} placeholder={copy.placeholder}
          label={copy.draft} previewTitle={input.previewFile} onFileClick={controls.openFile} fileStates={controls.fileStates} />
        <ComposerToolbar><PromptInputTools>{controls.tools}
          {tooLong && <span role="alert" className="chat-remote-budget">{budgetLabel(copy, bytes, REMOTE_LIMITS.textBytes)}</span>}
        </PromptInputTools><ComposerActions>
          <DeviceSelector items={targets.items} currentDeviceId={targetId || null} selectedDeviceId={selected} localDeviceId={targets.value?.localDeviceId ?? null} protocol={protocol} copy={copy} face={face}
            disabled={busy || Boolean(attempt) || !allowed && !onLocalSelect} remoteBlockedReason={remoteBlockedReason} onLocalSelect={onLocalSelect}
            onSelect={id => { if (!allowed) return; setSelection(id); setBackend(null); store.update({ options: null }); }} />
          <RemoteAgentSelector locale={locale} target={target} head={null} value={agent} copy={copy} disabled={!allowed || busy || Boolean(attempt)} onSelect={value => { setBackend(value); store.update({ options: null }); }} />
          {capability?.models && <ComposerModelSelector locale={locale} backend={agent || undefined} models={capability.models} disabled={!allowed || busy || Boolean(attempt)}
            value={choice ?? EMPTY_CHOICE} onChange={next => store.update({ options: { backend: agent as RemoteCreateInput["backend"], ...next } })} />}
          {action.kind === "retry-create"
            ? <Button type="submit" size="lg" className="rounded-full px-3 text-sm" aria-label={copy.retry} disabled={!allowed}>{action.label}</Button>
            : <PromptInputSubmit className="shrink-0 rounded-full max-md:size-11 pointer-coarse:size-11" aria-label={copy.send} status={busy ? "submitted" : undefined} disabled={busy || !allowed || disabled || !hasInput} />}
        </ComposerActions></ComposerToolbar>
      </ComposerForm>}
      {failure && <div role="alert" className="chat-remote-hint"><p>{reasonCopy(failure, copy)}</p>
        {attempt?.receipt && <Button type="button" variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          const receipt = attempt.receipt!;
          const session = platform.commands ? remoteCommandSession({ account: platform.account, commands: platform.commands }, receipt.chatId, receipt.incarnationId) : null;
          store.handoffCreation(Boolean(session?.snapshot().entries.some(entry => entry.input.commandId === attempt.commandId)));
          handoffRemoteDraft(platform, draftKey, `chat:${receipt.chatId}/${receipt.incarnationId}`);
          try { await onCreated(receipt, store.snapshot().text); }
          catch { if (mounted.current) setFailure("body-unavailable"); }
          finally { if (mounted.current) setBusy(false); }
        }}>{copy.viewChat}</Button>}
      </div>}
      {controls.dialogs}{consent.dialog}
    </ComposerDock>
  </section>;
}
/* A new chat starts from the catalog default; the selector resolves it from the catalog itself. */
const EMPTY_CHOICE: ModelChoice = {};
function modelChoice(choice: { model?: string; reasoningEffort?: string; serviceTier?: string }): RemoteTurnOptions | undefined {
  const value = { ...(choice.model ? { model: choice.model } : {}), ...(choice.reasoningEffort ? { reasoningEffort: choice.reasoningEffort } : {}), ...(choice.serviceTier ? { serviceTier: choice.serviceTier } : {}) };
  return value.model !== undefined || value.reasoningEffort !== undefined || value.serviceTier !== undefined ? value : undefined;
}
