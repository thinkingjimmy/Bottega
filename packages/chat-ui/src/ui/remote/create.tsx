/**
 * [INPUT]: Account/target capabilities, frozen first-message custody, original command settlement and host destination preparation/navigation.
 * [OUTPUT]: RemoteCreateChat and destination/context contracts: immediate user bubble, editable next draft and continuous Thinking through prepared route handoff; confirmed Stop/completion ends activity. App Edit creation remains text only and follows an existing Edit Chat unsent.
 * [POS]: Shared creation form; account-fenced original IDs own recovery, and destination commit releases the creation view.
 */
import { useRemoteReferences } from "./composer/input/references";
import { remoteDraftStore, handoffRemoteDraft } from "../../platform/remote/input/draft";
import { remoteCommandSession } from "../../platform/remote/commands/registry";
import { commandFinished } from "../../platform/remote/commands/presentation";
import { useRemoteDraft } from "../../platform/remote/input/hooks";
import { useRemoteComposerControls } from "./composer/controls";
import { useRemoteConsent } from "./composer/consent";
import { useRemoteFeedback } from "./composer/feedback";
import { RemoteEditor } from "./composer/input/editor";
import { draftBudget, sendAction, type OwnerBlock } from "./composer/status";
import { remoteInputCopy } from "./composer/copy";
import { AppEditFailure, AppEditTextOnly, appEditFilledNotice, appEditTextOnly } from "./composer/app-edit";
import { ComposerModelSelector, remoteTurnOptions, type ModelChoice } from "../composer/controls/model";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { PromptInputSubmit, PromptInputTools } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { Button } from "@ai-chat/ui/components/ui/button";
import { ComposerDock, ComposerForm, ComposerToolbar, ComposerActions } from "../composer/layout";
import { Conversation, ConversationContent } from "@ai-chat/ui/components/ai-elements/conversation";
import { conversationColumnClassName } from "@ai-chat/ui/components/conversation/layout";
import { TranscriptFile } from "../conversation/body/file";
import { ConversationUser } from "../conversation/turn/user";
import { ConversationActions } from "@ai-chat/ui/components/conversation/actions";
import { turnCopy } from "../conversation/turn/copy";
import { ConversationDraft } from "../conversation/turn/draft";
import { chatCopy } from "../../i18n/copy";
import { ChatEmptyState } from "../composer/empty";
import { composerCopy } from "../composer/copy";
import { FirstMessageFailure } from "../../platform/remote/creation/first-message";
import { createAndSend, firstMessageFileReady, type CreationOutcome } from "../../platform/remote/creation/submit";
import type { ChatPlatform } from "../../platform/contracts";
import type { RemoteCreated, RemoteCreateInput } from "../../platform/remote/contracts";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { useChatAccount } from "../../platform/presentation/hooks";
import { useRemoteTargets } from "../../platform/remote/hooks";
import { reasonCopy } from "./delivery/receipts";
import { remoteReasonSchema, type RemoteReason, type RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import { remoteCopy } from "../../i18n/messages/remote";
import { targetReason } from "./computer/selectors";
import { RemoteAgentSelector } from "./computer/agent";
import { Cloud } from "lucide-react";
import { RemoteUnavailable } from "./computer/unavailable";
import { PlatformGlyph } from "./computer/glyphs";
export type RemoteCreateContext = { target?: RemoteTarget; locked: boolean; unavailable: string | null };
export type RemoteChatDestination = Pick<RemoteCreated, "chatId" | "incarnationId"> & { head?: CloudChatHead | null };
export function RemoteCreateChat({ platform, locale, projectId, appTarget, appName, prepareDestination, onCreated, onDirtyChange, heading: _heading = true, computer, draft, context, contextBusy = false, disabledActions }: {
  platform: Pick<ChatPlatform, "account"> & Partial<Pick<ChatPlatform, "chats" | "commands" | "skills" | "capabilities" | "transcript">> & { execution: Pick<ChatPlatform["execution"], "remote"> }; locale: string; projectId: string | null;
  disabledActions?: import("./computer/unavailable").UnavailableAction[];
  /** The computer this Chat is created on — its installations and the one sentence to say when it cannot take one. Nothing is chosen here; `null` is an account with no computer and `undefined` an answer not in yet. */
  computer?: { installations: readonly string[]; block: OwnerBlock | null } | null;
  draft?: { text: string; change(text: string): void; unsupported?: boolean }; context?: ReactNode | ((state: RemoteCreateContext) => ReactNode); contextBusy?: boolean;
  /** U06 Q7-d: the App whose first Edit Chat this creates; it replaces `projectId` (the computer derives the App's Project). */
  appTarget?: NonNullable<RemoteCreateInput["target"]>;
  /** The App's name for the lines of its first Edit message (U06-c). */
  appName?: string;
  /** Keep the current conversation and draft mounted until the host can paint the destination. */
  prepareDestination?(destination: RemoteChatDestination, signal: AbortSignal): Promise<void>;
  /** `notice`: why the destination is not the Chat this form created (the App already had its Edit Chat), for the page it opens to say. */
  onCreated(destination: Pick<RemoteCreated, "chatId" | "incarnationId">, text: string, notice?: string): void | Promise<void>; onDirtyChange?(dirty: boolean): void; heading?: boolean;
}) {
  const reading = chatCopy(locale), copy = remoteCopy(locale), input = remoteInputCopy(locale), port = platform.execution.remote, account = useChatAccount(platform.account), targets = useRemoteTargets(port, null, projectId);
  const [backend, setBackend] = useState<RemoteCreateInput["backend"] | null>(null);
  const draftKey = `new:${projectId ?? "root"}`, [initialDraft] = useState(draft?.text);
  // A route transition can retain this form after the registry key moves to its destination.
  const store = useMemo(() => remoteDraftStore(platform, draftKey, initialDraft), [platform, draftKey, initialDraft]);
  const completeDraft = useRemoteDraft(store, platform.commands?.remote);
  const attempt = completeDraft.creation ?? null, setAttempt = (value: typeof attempt) => store.update({ creation: value });
  const firstSession = attempt?.receipt && platform.commands
    ? remoteCommandSession({ account: platform.account, commands: platform.commands }, attempt.receipt.chatId, attempt.receipt.incarnationId) : null;
  const firstCommand = useSyncExternalStore(firstSession?.subscribe ?? noSubscribe,
    () => firstSession?.snapshot().entries.find(entry => entry.input.commandId === attempt?.commandId));
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<RemoteReason | null>(null);
  const [opening, setOpening] = useState(false);
  /* The first message was refused because of its files before anything was stored: the draft's files, references, Plan and permission unlock and Retry sends them as a new message on the same Chat. */
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState(false), frozen = refused ? null : attempt, locked = busy || Boolean(frozen);
  const text = draft?.text ?? completeDraft.text, setText = (value: string) => { store.text(value); draft?.change(value); };
  const flight = useRef(false), mounted = useRef(true), lifecycle = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lifecycle.current?.abort(); }; }, []);
  const protocol = targets.value?.sourceProtocolVersion ?? -1;
  /* The named computer answers as one: whichever of its installations is up takes the Chat, and a retained attempt keeps the one it already named. */
  const targetId = attempt?.input.targetDeviceId ?? targets.items.find(item => computer?.installations.includes(item.deviceId) && item.online)?.deviceId ?? "";
  const target = targets.items.find(item => item.deviceId === targetId), selected = target?.online && target.protocolVersion === protocol ? targetId : "";
  const agent = attempt?.input.backend ?? backend ?? target?.agents.find(value => value.available)?.backend ?? target?.agents[0]?.backend ?? "";
  const connected = Boolean(port) && account.state === "ready" && !targets.error, allowed = Boolean(connected && targets.value?.remoteControlEnabled);
  const capability = target?.agents.find(value => value.backend === agent);
  const permissionMode = frozen?.permissionMode ?? completeDraft.permissionMode ?? attempt?.permissionMode ?? capability?.options?.permissionMode ?? "approve-for-me";
  const choice = completeDraft.options?.backend === agent ? completeDraft.options : null;
  const feedback = useRemoteFeedback(copy);
  const controls = useRemoteComposerControls({ store, draft: completeDraft, port: platform.commands?.remote, capabilities: capability?.capabilities,
    permissionMode, locale, backend: agent, disabled: locked, copy, feedback, plugins:target?.plugins,ownerDeviceId:targetId,draftKey, textOnly: appTarget ? appEditTextOnly(locale) : undefined });
  const consent = useRemoteConsent(store, locale, target?.name ?? "", `${targetId}/${agent}`);
  // An App's first Edit message is text only (§8.2): no references either.
  const references = useRemoteReferences({ platform, head: null, session: null, target, projectId, store, locale, disabled: locked || Boolean(appTarget) });
  const appValues = { app: appName ?? "", computer: target?.name ?? "" };
  const hasInput = Boolean(text.trim() || completeDraft.files.length || completeDraft.references.length);
  const draftReferences = completeDraft.references.map(item => item.value);
  const budget = draftBudget(copy, { text, references: draftReferences, files: completeDraft.files.length }), tooLong = budget !== null;
  // A retry sends the attempt's own text with the unlocked draft's references and files, so that is what it is measured by — not the next draft.
  const retryBudget = attempt ? draftBudget(copy, { text: attempt.text, references: draftReferences, files: completeDraft.files.length }) : null;
  const filesBlocked = completeDraft.files.some(file => !firstMessageFileReady(file, Boolean(attempt)));
  const retryBlocked = contextBusy || filesBlocked || refused && (retryBudget !== null || controls.unsupported || controls.editing || !attempt?.text.trim() && !completeDraft.files.length && !completeDraft.references.length);
  const disabled = contextBusy || filesBlocked || controls.unsupported || controls.editing || tooLong || Boolean(draft?.unsupported) || !allowed || !target || !selected || Boolean(target && targetReason(target, protocol, copy)) || !target.agents.some(value => value.backend === agent && value.available);
  const remoteBlockedReason = !allowed ? targets.value?.remoteControlEnabled === false ? copy.disabled : copy.disconnected : null;
  useEffect(() => { onDirtyChange?.(hasInput || Boolean(attempt)); }, [hasInput, attempt, onDirtyChange]);
  const openDestination = async (destination: RemoteChatDestination, sent = true, notice?: string) => {
    const abort = lifecycle.current ?? new AbortController(), owner = platform.account.snapshot();
    lifecycle.current = abort;
    await prepareDestination?.(destination, abort.signal);
    const current = platform.account.snapshot();
    if (!mounted.current || abort.signal.aborted || platform.commands?.remote?.lifetime?.aborted ||
      current.profile?.userId !== owner.profile?.userId || current.deviceId !== owner.deviceId) return;
    setOpening(true);
    if (!sent) store.handoffCreation(false);
    handoffRemoteDraft(platform, draftKey, `chat:${destination.chatId}/${destination.incarnationId}`);
    try { await onCreated(destination, store.snapshot().text, notice); }
    catch (error) { if (mounted.current) setOpening(false); throw error; }
  };
  const create = async () => {
    if (!port || !allowed || contextBusy || flight.current || (attempt ? retryBlocked : disabled || !hasInput)) return;
    const input = attempt?.input ?? { createOperationId: crypto.randomUUID(), targetDeviceId: selected, backend: agent as RemoteCreateInput["backend"],
      projectId: appTarget ? null : projectId, ...(appTarget ? { target: appTarget } : {}) };
    const options = choice ? remoteTurnOptions(choice) : undefined;
    const retained = frozen ?? { ...attempt, input, commandId: crypto.randomUUID(), text: attempt?.text ?? text, permissionMode, planMode: completeDraft.planMode,
      references: completeDraft.references.map(reference => reference.value), ...(!attempt && options ? { options } : {}) };
    const abort = new AbortController(), owner = platform.account.snapshot(); lifecycle.current = abort;
    const valid = () => {
      const current = platform.account.snapshot();
      // Temporary checking/offline states retain this admitted identity and its original request.
      return mounted.current && !abort.signal.aborted && !platform.commands?.remote?.lifetime?.aborted && current.profile?.userId === owner.profile?.userId && current.deviceId === owner.deviceId;
    };
    const stopAccount = platform.account.subscribe(() => { if (!valid()) abort.abort(); });
    flight.current = true; setBusy(true); setFailure(null); setRefusal(undefined); setRefused(false); feedback.dismiss(); setAttempt(retained);
    if (!attempt) setText("");
    let handoffPromise: Promise<void> | null = null;
    const handoff = (outcome: CreationOutcome) => handoffPromise ??= !valid() ? Promise.resolve() :
      openDestination(outcome, outcome.sent, outcome.sent ? undefined : appEditFilledNotice(locale, appValues))
        .catch(error => { handoffPromise = null; throw error; });
    try {
      if (!platform.chats || !platform.commands) throw new FirstMessageFailure("remote-disabled");
      const outcome = await createAndSend({ account: platform.account, chats: platform.chats, commands: platform.commands,
        execution: platform.execution as ChatPlatform["execution"] }, store, retained, abort.signal, consent.confirm,
        outcome => { void handoff(outcome).catch(() => { if (valid()) setFailure("outcome-unknown"); }); });
      await handoff(outcome);
    } catch (error) {
      if (mounted.current && !abort.signal.aborted) {
        const reason = remoteReasonSchema.safeParse(error && typeof error === "object" && "data" in error ? error.data : error instanceof Error ? error.message : error);
        if (error instanceof FirstMessageFailure && ["capacity-exceeded", "entitlement-required", "quota-exceeded"].includes(error.reason) && !store.snapshot().text) setText(retained.text);
        const checking = error instanceof FirstMessageFailure && error.reason === "identity-changed" && platform.account.snapshot().state !== "ready" && valid();
        setFailure(checking ? "outcome-unknown" : error instanceof FirstMessageFailure ? error.reason : reason.success ? reason.data : "outcome-unknown");
        setRefusal(error instanceof FirstMessageFailure ? error.refusal : undefined);
        setRefused(error instanceof FirstMessageFailure && error.attachments && Boolean(store.snapshot().creation));
      }
    }
    finally { stopAccount(); flight.current = false; if (mounted.current) setBusy(false); }
  };
  // A restored creation is reconciled by its original identities before continuing.
  const recovered = attempt?.recovered ? attempt : null;
  useEffect(() => {
    if (!recovered || !port || flight.current) return;
    flight.current = true;
    void (async () => {
      try {
        const receipt = recovered.receipt ?? await port.created(recovered.input.createOperationId);
        if (!mounted.current || store.snapshot().creation?.commandId !== recovered.commandId) return;
        store.update({ creation: { ...recovered, recovered: false, ...(receipt ? { receipt } : {}) } });
        if (!receipt || receipt.deleted) { setFailure("outcome-unknown"); return; }
        const session = platform.commands ? remoteCommandSession({ account: platform.account, commands: platform.commands }, receipt.chatId, receipt.incarnationId) : null;
        await session?.load(recovered.commandId);
        if (!mounted.current) return;
        if (!session?.snapshot().entries.some(entry => entry.input.commandId === recovered.commandId)) { setFailure("outcome-unknown"); return; }
        await openDestination(receipt);
      } catch { if (mounted.current) setFailure("outcome-unknown"); }
      finally { flight.current = false; }
    })();
  }, [recovered, port, store, platform, draftKey, onCreated, prepareDestination]); // eslint-disable-line react-hooks/exhaustive-deps
  // A transport failure is not evidence that creation or its first message failed.
  useEffect(() => {
    if (failure !== "outcome-unknown" || !attempt || !port) return;
    let cancelled = false, step = 0;
    let timer: ReturnType<typeof setTimeout>;
    let reading = false;
    const recover = async () => {
      if (reading || cancelled) return;
      reading = true;
      try {
        const receipt = attempt.receipt ?? await port.created(attempt.input.createOperationId);
        if (!receipt || receipt.deleted || cancelled || !platform.commands || !platform.chats) return;
        const session = remoteCommandSession({ account: platform.account, commands: platform.commands }, receipt.chatId, receipt.incarnationId);
        const command = store.custody().commands.get(attempt.commandId);
        if (command) session?.adopt(command);
        await session?.load(attempt.commandId);
        if (cancelled) return;
        if (!session?.snapshot().entries.some(entry => entry.input.commandId === attempt.commandId)) {
          // Creation succeeded but no first command was started. Continue that original intent once.
          if (!attempt.commandStarted && !command) await create();
          return;
        }
        await openDestination(receipt);
      } catch { /* Retain the original operation and try its read again. */ }
      finally { reading = false; if (!cancelled) timer = setTimeout(recover, [2000, 5000, 15000, 30000][Math.min(step++, 3)]); }
    };
    const resume = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void recover(); } };
    void recover();
    window.addEventListener("online", resume); window.addEventListener("pageshow", resume); document.addEventListener("visibilitychange", resume);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener("online", resume); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume); };
  }, [failure, attempt, port, platform, store, draftKey, onCreated, prepareDestination]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = !(firstCommand && commandFinished(firstCommand)) && (busy || opening || Boolean(attempt && failure === "outcome-unknown"));
  const stop = () => {
    const current = store.snapshot().creation;
    if (!current) return;
    const session = current.receipt && platform.commands ? remoteCommandSession({ account: platform.account, commands: platform.commands }, current.receipt.chatId, current.receipt.incarnationId) : null;
    if (session?.snapshot().entries.some(entry => entry.input.commandId === current.commandId)) { session.open(); session.stop(current.commandId); return; }
    lifecycle.current?.abort();
    if (store.restore(current.commandId)) store.handoffCreation(true); else store.handoffCreation(false);
    setFailure(null); setBusy(false);
  };
  const action = sendAction(copy, { head: null, target, ready: true, busy, retryCreate: Boolean(attempt) && !waiting });
  const unavailable = targets.value !== null && targets.value.remoteControlEnabled === false;
  /* Targets still arriving is not "sync is disconnected": the card waits until the account or the port has actually failed. */
  const syncDisconnected = remoteBlockedReason === copy.disconnected && !(targets.value === null && connected);
  /* The computer is named by the sidebar, so this composer only speaks when it cannot take the message. */
  const block = computer?.block ?? null;
  const notice = remoteBlockedReason
    ?? (block ? [block.reason, ...(block.hint ? [block.hint] : [])].join(copy.sentenceGap) : null)
    ?? (target ? targetReason(target, protocol, copy) : null)
    ?? (computer === null ? copy.noComputers : computer && targets.value !== null && !targetId ? copy.noComputerOnline : null);
  return <section className="flex h-full min-h-0 flex-col" aria-label={copy.newChat}>
    {attempt ? <Conversation className="min-h-0 min-w-0 flex-1" initial="instant" resize="instant">
      <ConversationContent className={`${conversationColumnClassName} gap-6`}>
        <ConversationUser content={attempt.text} showMore={reading.showMore} showLess={reading.showLess}
          attachments={(store.submittedDraft(attempt.commandId)?.files ?? completeDraft.files).map(file => file.attachment && platform.transcript
            ? <TranscriptFile key={file.id} chatId={attempt.receipt?.chatId ?? ""} descriptor={file.attachment.blob} name={file.file.name} source={platform.transcript} copy={reading} />
            : <div key={file.id} className="chat-file"><button type="button" disabled>{reading.attachment} · {file.file.name}</button></div>)}
          actions={<ConversationActions role="user" copyLabel={reading.copy} copiedLabel={reading.copied} onCopy={() => navigator.clipboard.writeText(attempt.text)} />} />
        {waiting && <ConversationDraft label={turnCopy(locale).thinking} />}
      </ConversationContent>
    </Conversation> : <ChatEmptyState title={composerCopy(locale).empty} />}
    <ComposerDock className="chat-remote"><fieldset disabled={busy || Boolean(attempt)} className="min-w-0">{typeof context === "function" ? context({ target, locked: busy || Boolean(attempt), unavailable: notice }) : context}</fieldset>
      {notice && !waiting && !unavailable && !syncDisconnected && !(targets.value === null && notice === copy.disconnected) && <div className="chat-remote-hint" role="status" data-computer-notice><p>{notice}</p></div>}
      {unavailable ? <RemoteUnavailable icon={<PlatformGlyph kind="none" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />} title={copy.disabled} description={copy.disabledDescription} actions={disabledActions} />
        : syncDisconnected && !waiting ? <RemoteUnavailable icon={<Cloud aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />} title={copy.disconnectedTitle} description={copy.disconnectedDescription} />
        : <ComposerForm className="chat-remote-form" onSubmit={event => { event.preventDefault(); void create(); }} aria-busy={busy} {...controls.events}>
        {!attempt && controls.files}
        <RemoteEditor references={completeDraft.references} suggestions={references}
          removeReference={key => store.update({ references: store.snapshot().references.filter(item => (item.value.kind === "file" ? `file:${item.value.path}` : `library:${item.value.libraryId}`) !== key) })} text={text} change={setText} files={attempt ? [] : completeDraft.files} remove={id => { if (!locked) store.remove(id); }} disabled={false} placeholder={copy.placeholder}
          label={copy.draft} previewTitle={input.previewFile} onFileClick={controls.openFile} fileStates={controls.fileStates} />
        <ComposerToolbar><PromptInputTools>{controls.tools}
          {budget && <span role="alert" className="chat-remote-budget">{budget}</span>}
        </PromptInputTools><ComposerActions>
          <RemoteAgentSelector locale={locale} target={target} value={agent} copy={copy} disabled={!allowed || busy || Boolean(attempt)} onSelect={value => { setBackend(value); store.update({ options: null }); }} />
          {capability?.models && <ComposerModelSelector locale={locale} backend={agent || undefined} models={capability.models} disabled={!allowed || busy || Boolean(attempt)}
            value={choice ?? EMPTY_CHOICE} onChange={next => store.update({ options: { backend: agent as RemoteCreateInput["backend"], ...next } })} />}
          {action.kind === "retry-create"
            ? <Button type="submit" size="lg" className="rounded-full px-3 text-sm" aria-label={copy.retry} disabled={!allowed || retryBlocked}>{action.label}</Button>
            : <PromptInputSubmit className="shrink-0 rounded-full max-md:size-11 pointer-coarse:size-11" aria-label={waiting ? copy.stop : copy.send} status={waiting ? "submitted" : undefined} onStop={stop} preferSubmit={!waiting} tooltip={block?.reason} disabled={waiting ? false : !allowed || disabled || !hasInput} />}
        </ComposerActions></ComposerToolbar>
      </ComposerForm>}
      {appTarget && !unavailable && !syncDisconnected && <AppEditTextOnly locale={locale} />}
      {failure && failure !== "outcome-unknown" && <div role="alert" className="chat-remote-hint"><p>{refused && retryBudget ? retryBudget : appTarget
        ? <AppEditFailure locale={locale} failure={{ reason: failure, refusal }} values={appValues} fallback={reasonCopy(failure, copy)} /> : reasonCopy(failure, copy)}</p>
        {attempt?.receipt && <Button type="button" variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          const receipt = attempt.receipt!;
          const session = platform.commands ? remoteCommandSession({ account: platform.account, commands: platform.commands }, receipt.chatId, receipt.incarnationId) : null;
          try { await openDestination(receipt, Boolean(session?.snapshot().entries.some(entry => entry.input.commandId === attempt.commandId))); }
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
const noSubscribe = () => () => {};
