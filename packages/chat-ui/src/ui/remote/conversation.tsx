/**
 * [INPUT]: Depends on the six Chat facades, confirmed heads and project readiness, shared selection rejection proof, remote target/receipt hooks, the executor's published model catalog and transcript controls.
 * [OUTPUT]: Provides early intent submission with current/next executor separation and remote messaging where every state lives on its control — named computer chip with callouts for computer outcomes, icon Agent chip, model choice, a Send button that is the required action (prepare, retry preparation, bind), a byte budget on the Send row, outcome toasts, and the read-only card in place of the composer for archived, remote-off and imported-not-yet-continued chats and for native chats whose computer is offline, outdated or revoked (Continue on the executor, another computer, Check again); plus definitive selection rejection recovery, immutable unknown attempts, a page or viewport-filling layout mode and one footer slot beneath the conversation.
 * [POS]: Shared Web and desktop mirror composition; optional host layout places sibling panels under one draft callback owner, and native drafts keep their original storage owner.
 */
import { ChatConversation, type ConversationRegions } from "../page/conversation";
import { useArtifactHost, ArtifactHostProvider } from "../../artifacts/context";
import { useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ComposerDock, ComposerForm, ComposerToolbar, ComposerActions } from "../composer/layout";
import { PromptInputSubmit, PromptInputTools } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { Button } from "@ai-chat/ui/components/ui/button";
import { AgentBackendIcon } from "@ai-chat/ui/components/identity/agent";
import { Archive, RefreshCw } from "lucide-react";
import { utf8Length } from "@ai-chat/cloud-protocol/chats/content/parts";
import { artifactFollowUpBlock } from "@ai-chat/cloud-protocol/artifacts/frame-security";
import { REMOTE_LIMITS, type RemoteTurnOptions } from "@ai-chat/cloud-protocol/remote/model";
import { executorSelectionRejection } from "@ai-chat/cloud-protocol/remote/selection";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatPlatform } from "../../platform/contracts";
import type { RemoteCommandInput, RemotePreparationInput, RemoteSelectInput } from "../../platform/remote/contracts";
import { useChatAccount } from "../../platform/presentation/hooks";
import { useRemoteCommands, useRemoteTargets } from "../../platform/remote/hooks";
import { awaitingRemoteAdmission } from "../../platform/remote/commands/session";
import { remoteCopy } from "../../i18n/remote";
import { ChatTranscript } from "../conversation/transcript";
import { ConversationModelProvider } from "../conversation/body/model";
import type { ImageIdentity } from "../side-panel/image/identity";
import { DeviceMenu, DeviceSelector, RemoteAgentSelector, targetReason, type ComputerCallout } from "./computer/selectors";
import { assertRemoteReferenceTarget, isRemoteWorkspaceQuery } from "@ai-chat/cloud-protocol/remote/input/references";
import { RemoteQueue } from "./delivery/queue";
import { queryRemoteWorkspace } from "../../platform/remote/workspace";
import type { WorkspacePreviewRequest } from "../side-panel/workspace";
import { useRemoteReferences } from "./composer/input/references";
import { awaitRemoteResult } from "../../platform/remote/commands/result";
import { RemoteForkDialog } from "./turn/fork";
import { useComposerTranslation } from "../composer/controls/copy/translation";
import { RemoteReceipts } from "./delivery/receipts";
import { remoteDraftStore } from "../../platform/remote/input/draft";
import { useRemoteDraft } from "../../platform/remote/input/hooks";
import { useRemoteComposerControls } from "./composer/controls";
import { useRemoteConsent } from "./composer/consent";
import { useRemoteFeedback } from "./composer/feedback";
import { RemoteEditor } from "./composer/input/editor";
import { RemoteUnavailable, type UnavailableAction } from "./computer/unavailable";
import { PlatformGlyph } from "./computer/glyphs";
import { budgetLabel, computerFace, readOnlyGate, sendAction } from "./composer/status";
import { ChatPlanDecision } from "../composer/controls/plan-decision";
import { planDecisionInput, type PlanDecision } from "../composer/controls/plan";
import { ComposerModelSelector, type ModelChoice } from "../composer/controls/model";
import { remoteInputCopy } from "./composer/copy";
export type RemoteDraft = { text: string; change(text: string): void; ready: boolean; unsupported?: boolean; flush(): Promise<void> };
type Outcome = { message: string; retry: "select" | "preparation" | "refresh" };
export function RemoteConversation(props: RemoteConversationProps) {
  return <ConversationModelProvider><RemoteConversationContent {...props} /></ConversationModelProvider>;
}
type RemoteConversationProps = Parameters<typeof RemoteConversationContent>[0];
function RemoteConversationContent({ head, platform, locale, connected = true, targetMessageId, draft, initialText = "", layout = "page", onDirtyChange, bindProject, footer, readOnlyFooter, navigateToChat, keepComposerVisible = false, restore, onOpenImage, onOpenWorkspaceFile, children, disabledActions }: {
  disabledActions?: UnavailableAction[];
  head: CloudChatHead; platform: ChatPlatform; locale: string; connected?: boolean; targetMessageId?: string | null; draft?: RemoteDraft;
  keepComposerVisible?: boolean; initialText?: string; layout?: "page" | "fill"; onDirtyChange?(dirty: boolean): void; bindProject?(chatId: string): Promise<unknown>;
  /** Always below the conversation, remote control or not: the desktop takeover banner belongs here whatever this device may send. */
  footer?: ReactNode;
  /** Shown in the composer position only while remote control is unavailable. */
  readOnlyFooter?: ReactNode;
  navigateToChat?(chatId: string, messageId: string): void;
  /** Restores an archived chat from the bar that replaces its composer. */
  restore?(): Promise<unknown>;
  onOpenImage?(identity: ImageIdentity): void;
  onOpenWorkspaceFile?(request: WorkspacePreviewRequest): void;
  /** Compose sibling panels under the same draft-scoped artifact capabilities. */
  children?(conversation: ConversationRegions): ReactNode;
}) {
  const translate = useComposerTranslation(locale);
  const [forkAnchor, setForkAnchor] = useState<{ id: string; seq: number } | null>(null);
  const copy = remoteCopy(locale), input = remoteInputCopy(locale), account = useChatAccount(platform.account), port = platform.executor.remote;
  const targets = useRemoteTargets(port, head.chat.id), commands = useRemoteCommands(platform, head.chat.id, head.chat.incarnationId);
  const store = remoteDraftStore(platform, `chat:${head.chat.id}/${head.chat.incarnationId}`, draft?.text ?? initialText);
  const completeDraft = useRemoteDraft(store, platform.commands.remote, head.chat.id);
  const text = draft?.text ?? completeDraft.text, change = useCallback((text: string) => { store.text(text); draft?.change(text); }, [store, draft]);
  const [sendBusy, setSendBusy] = useState(false), [completedPlan, setCompletedPlan] = useState<string | null>(null), [restoring, setRestoring] = useState(false);
  const artifactHost = useArtifactHost(), composerElement = useRef<{ focus(): void }>(null);
  const conversationElement = useRef<HTMLDivElement>(null), focusRequested = useRef(false);
  const bindConversation = useCallback((node: HTMLDivElement | null) => { conversationElement.current = node; }, []);
  const composerLatest = useRef({ text, change });
  useLayoutEffect(() => { composerLatest.current = { text, change }; }, [text, change]);
  useLayoutEffect(() => {
    // A takeover panel must finish its Router POP before the hidden composer can take focus.
    if (focusRequested.current && !conversationElement.current?.closest("[hidden], [inert]")) {
      focusRequested.current = false; composerElement.current?.focus();
    }
  });
  const artifactComposer = useMemo(() => artifactHost ? { ...artifactHost, followUp: (value: { prompt: string; title?: string }) => {
    const current = composerLatest.current;
    const block = artifactFollowUpBlock(current.text, value);
    if (!block) return;
    const next = [current.text, block].filter(Boolean).join("\n\n");
    if (utf8Length(next) > REMOTE_LIMITS.textBytes) return;
    focusRequested.current = true; current.text = next; current.change(next);
  } } : null, [artifactHost]);
  const [pendingAgent, setPendingAgent] = useState<{ backend: CloudChatHead["chat"]["agent"]; head: CloudChatHead } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null), [outcome, setOutcome] = useState<Outcome | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [confirmedSelection, setConfirmedSelection] = useState<CloudChatHead | null>(null);
  const [interactionDrafts, setInteractionDrafts] = useState<Record<string, boolean>>({});
  const draftChanged = useCallback((key: string, dirty: boolean) => setInteractionDrafts(previous => {
    if (Boolean(previous[key]) === dirty) return previous;
    const next = { ...previous }; if (dirty) next[key] = true; else delete next[key]; return next;
  }), []);
  const selectionAttempt = useRef<RemoteSelectInput | null>(null), selectionBusy = useRef(false), sending = useRef(false), mounted = useRef(true), consumed = useRef(new Set<string>()), invalidated = useRef(new Set<string>());
  const preparationAttempt = useRef<RemotePreparationInput | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const feedback = useRemoteFeedback(copy);
  const ordinary = head.chat.classification.conversationKind === "ordinary", enabled = Boolean(targets.value?.remoteControlEnabled && port && commands.session);
  const protocol = targets.value?.sourceProtocolVersion ?? -1;
  const currentExecutor = targets.items.find(item => item.deviceId === head.executorDeviceId);
  const selectionHead = confirmedSelection && confirmedSelection.catalogRevision > head.catalogRevision ? confirmedSelection : head;
  const requestedTarget = switching ?? selectionHead.pendingExecutor?.deviceId ?? selectionHead.executorDeviceId;
  const requested = targets.items.find(item => item.deviceId === requestedTarget);
  const target = head.kind === "external-readonly" || requested?.online && requested.protocolVersion === protocol ? requested :
    targets.items.find(item => item.online && item.protocolVersion === protocol && !targetReason(item, protocol, copy)) ?? requested;

  const selected = target?.online && target.protocolVersion === protocol ? target.deviceId : "";
  const agent = pendingAgent?.backend ?? head.chat.agent, availableAgent = target?.agents.find(item => item.backend === agent)?.available;
  const staleAgent = pendingAgent && (pendingAgent.head.chat.agentRevision !== head.chat.agentRevision || pendingAgent.head.catalogRevision !== head.catalogRevision || pendingAgent.head.executorDeviceId !== head.executorDeviceId);
  // A pending choice re-bases itself on the moved head while its Agent is still offered; only a vanished Agent needs the user.
  useEffect(() => {
    if (!staleAgent || !pendingAgent) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (target?.agents.some(item => item.backend === pendingAgent.backend && item.available)) setPendingAgent({ backend: pendingAgent.backend, head });
    else { setPendingAgent(null); setOutcome({ message: copy.sourceChanged, retry: "refresh" }); }
  }, [staleAgent, pendingAgent, head, target, copy.sourceChanged]);
  useEffect(() => {
    const destination = selectionHead.pendingExecutor?.deviceId ?? selectionHead.executorDeviceId;
    if (destination) void commands.session?.retarget(destination, selectionHead.executionEpoch);
  }, [commands.session, commands.entries, selectionHead]);
  // 01 §2.5: a computer change this session did not make is announced once. The chip already names a computer this session chose.
  const announcedExecutor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = announcedExecutor.current; announcedExecutor.current = head.executorDeviceId;
    if (previous === undefined || previous === head.executorDeviceId || !head.executorDeviceId) return;
    if (switching === head.executorDeviceId || confirmedSelection?.executorDeviceId === head.executorDeviceId || selectionAttempt.current?.targetDeviceId === head.executorDeviceId) return;
    feedback.notice(copy.executingOn.replace("{name}", currentExecutor?.name ?? copy.computer));
  }, [head.executorDeviceId, switching, confirmedSelection, currentExecutor, feedback, copy]);
  const uncertain = commands.entries.some(entry => !isRemoteWorkspaceQuery(entry.input.payload.kind) && awaitingRemoteAdmission(entry) && (!entry.receipt || entry.uncertain || ["pending", "claimed", "outcome-unknown"].includes(entry.receipt.state)));
  const requestBusy = commands.entries.some(entry => !isRemoteWorkspaceQuery(entry.input.payload.kind) && entry.busy), authorized = connected && account.state === "ready" && !targets.error && enabled && ordinary && head.archivedAt === null;
  const importedReadonly = head.kind === "external-readonly", preparation = head.executionPreparation;
  const ready = !importedReadonly && preparation?.state === "ready" && preparation.deviceId === head.executorDeviceId && preparation.executionEpoch === head.executionEpoch;
  const awaitingSelection = Boolean(confirmedSelection && (head.executionEpoch < confirmedSelection.executionEpoch || head.executionEpoch === confirmedSelection.executionEpoch && head.executorDeviceId !== confirmedSelection.executorDeviceId));
  const selecting = Boolean(switching) || awaitingSelection;
  const projectPending = target?.reason === "local-facts-pending";
  const revoked = Boolean(head.executorDeviceId) && targets.value !== null && !target;
  const bindable = target?.projectBound === false && target.deviceId === targets.value?.localDeviceId && Boolean(bindProject);
  const blockedReason = connected && account.state === "ready" && Boolean(port) && !targets.error ? null : copy.disconnected;
  // The read-only card stands where the composer would be: always for an imported chat until it is continued somewhere, and for a native chat while its computer cannot run anything.
  const switchingTarget = switching ?? confirmedSelection?.executorDeviceId ?? head.executorDeviceId;
  const gate = readOnlyGate(copy, { imported: importedReadonly, blocked: blockedReason, loading: targets.value === null, target, protocol, revoked, agent: head.chat.agent, bindable, localDeviceId: targets.value?.localDeviceId ?? null,
    othersOnline: !head.openTurnId && targets.items.some(item => item.deviceId !== head.executorDeviceId && !targetReason(item, protocol, copy)),
    switchingTo: selecting ? targets.items.find(item => item.deviceId === switchingTarget)?.name ?? target?.name ?? copy.computer : null });
  const baseBlocked = !authorized || !selected || !availableAgent || selecting || operationPending || Boolean(staleAgent) || projectPending || target?.projectBound === false || (!draft?.ready || draft.unsupported) && Boolean(draft);
  const capability = target?.agents.find(item => item.backend === agent);
  const permissionMode = completeDraft.permissionMode ?? (pendingAgent ? capability?.options?.permissionMode : head.chat.options.permissionMode) ?? "approve-for-me";
  const controls = useRemoteComposerControls({ store, draft: completeDraft, port: platform.commands.remote, chatId: head.chat.id, copy, feedback,
    capabilities: capability?.capabilities, permissionMode, locale, backend: agent, disabled: uncertain || sendBusy || requestBusy || selecting || operationPending });
  const consent = useRemoteConsent(store, locale, target?.name ?? "", `${head.chat.id}/${head.chat.incarnationId}/${head.executorDeviceId}/${head.executionEpoch}`);
  const pendingFiles = completeDraft.files.some(file => file.state !== "ready");
  const [referenceSelection, setReferenceSelection] = useState<{ requestId: string | null; mode: "next" | "current" }>({ requestId: null, mode: "next" });
  const referenceMode = referenceSelection.requestId === head.openTurnId ? referenceSelection.mode : "next";
  const referenceTarget = referenceMode === "current" && head.openTurnId ? currentExecutor : target;
  const referenceSuggestions = useRemoteReferences({ head, target: referenceTarget, platform, session: commands.session, store, locale, disabled: !authorized || uncertain || sendBusy });
  const referenceMismatch = completeDraft.references.some(reference => reference.value.kind === "file" && reference.value.deviceId !== referenceTarget?.deviceId);
  const hasInput = Boolean(text.trim() || completeDraft.files.length || completeDraft.references.length);
  const bytes = utf8Length(text), tooLong = bytes > REMOTE_LIMITS.textBytes;
  const blocked = referenceMismatch || baseBlocked || controls.unsupported || controls.editing || pendingFiles || sendBusy;
  const runningCapabilities = currentExecutor?.agents.find(item => item.backend === head.chat.agent)?.capabilities;
  const steerBlocked = !authorized || !currentExecutor?.online || controls.editing || pendingFiles || sendBusy ||
    Boolean(draft && (!draft.ready || draft.unsupported)) || completeDraft.files.some(file => file.file.type.startsWith("image/") ? !runningCapabilities?.imageInput : !runningCapabilities?.fileInput);
  const planId = !head.openTurnId && completedPlan && !completeDraft.dismissedPlans.includes(completedPlan) ? completedPlan : null;
  // The chat's own options name the model until this device chooses another one for the same Agent.
  const choice = completeDraft.options?.backend === agent ? completeDraft.options : null;
  const chatOptions = !pendingAgent ? head.chat.options : null;
  const chatModel = chatOptions && "model" in chatOptions ? chatOptions.model : undefined;
  // Without a choice the selector shows the chat's model, and its catalog default when the chat names none.
  const modelValue: ModelChoice = choice ?? { model: chatModel, reasoningEffort: chatOptions && "reasoningEffort" in chatOptions ? chatOptions.reasoningEffort : undefined,
    serviceTier: chatOptions && "serviceTier" in chatOptions ? chatOptions.serviceTier : undefined };
  useEffect(() => {
    for (const entry of commands.entries) {
      if (entry.replacementId) store.transfer(entry.input.commandId, entry.replacementId);
      // A withdrawn intent that needs a fresh confirmation keeps its custody: its text returns to the draft below.
      if (entry.canonical || entry.withdrawnByUser || entry.receipt?.admission && !entry.reconfirmRequired) store.confirmed(entry.input.commandId);
      else if (entry.rejected || entry.receipt && ["rejected", "expired", "cancelled"].includes(entry.receipt.state)) {
        if (!entry.retargetRequested && store.restore(entry.input.commandId) && draft && !text) draft.change(store.snapshot().text);
      }
      if (!invalidated.current.has(entry.input.commandId) && !entry.receipt?.admission && (entry.rejected === "attachment-unavailable" || entry.receipt?.state === "rejected" && entry.receipt.reason === "attachment-unavailable") &&
        (entry.input.payload.kind === "start-turn" || entry.input.payload.kind === "steer")) {
        invalidated.current.add(entry.input.commandId); store.invalidate(entry.input.payload.attachments ?? []);
      }
      if (!entry.owned || consumed.current.has(entry.input.commandId) || (entry.input.payload.kind !== "start-turn" && entry.input.payload.kind !== "retry-authentication" && entry.input.payload.kind !== "steer") || !(entry.canonical || entry.receipt?.admission || entry.receipt && ["awaiting-executor", "awaiting-preparation", "delivered"].includes(entry.receipt.state))) continue;
      consumed.current.add(entry.input.commandId);
      if (entry.canonical || entry.receipt?.admission) store.accepted(entry.input.payload.text, entry.input.payload.attachments, entry.input.payload.references);
      else store.awaiting(entry.input.commandId, entry.input.payload.text, entry.input.payload.attachments, entry.input.payload.references);
      const decision = store.snapshot().submittedPlan;
      if (decision?.commandId === entry.input.commandId) store.update({ planMode: decision.planMode,
        dismissedPlans: [...store.snapshot().dismissedPlans, decision.planId], submittedPlan: null });
      if (draft && text === entry.input.payload.text) draft.change("");
      // The external receipt confirms this exact staged choice, including replies recovered after a transport failure.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (entry.input.payload.kind === "start-turn" && pendingAgent?.backend === entry.input.payload.agentSelection?.backend) setPendingAgent(null);
      // The executor now holds the chosen model on the chat; the draft's override has done its job.
      if (entry.input.payload.kind === "start-turn" && entry.input.payload.options) store.update({ options: null });
    }
  }, [commands.entries, text, change, pendingAgent, store, draft]);
  // A draft behind the card is kept for the composer's return, not an unsaved one to guard.
  useEffect(() => { onDirtyChange?.(Boolean(completeDraft.retainedText) || hasInput && !gate || controls.editing || uncertain || selecting || operationPending || Object.keys(interactionDrafts).length > 0); }, [completeDraft.retainedText, hasInput, gate, controls.editing, uncertain, selecting, operationPending, interactionDrafts, onDirtyChange]);
  const targetsLatest = useRef(targets);
  useLayoutEffect(() => { targetsLatest.current = targets; }, [targets]);
  const refresh = useCallback(() => { setOutcome(null); targetsLatest.current.refresh(); }, []);
  const submit = async (payload: RemoteCommandInput["payload"], decision?: { planId: string; planMode: boolean }) => {
    const destination = payload.kind === "start-turn" ? selected : currentExecutor?.online ? currentExecutor.deviceId : null;
    if (!commands.session || !authorized || !destination || payload.kind === "start-turn" && (selecting || operationPending)) return null;
    if ("requestId" in payload && commands.session.snapshot().entries.some(entry => {
      const previous = entry.input.payload;
      return previous.kind === payload.kind && "requestId" in previous && previous.requestId === payload.requestId &&
        (entry.busy || !entry.rejected && (entry.uncertain || !entry.receipt || !["done", "cancelled", "error", "expired", "rejected"].includes(entry.receipt.state)));
    })) return null;
    const input: RemoteCommandInput = { commandId: crypto.randomUUID(), chatId: head.chat.id, incarnationId: head.chat.incarnationId,
      targetDeviceId: destination, executionEpoch: head.executionEpoch, ...(payload.kind === "start-turn" ? { intent: { baselineAgent: head.chat.agent } } : {}), payload };
    if (decision) store.update({ submittedPlan: { ...decision, commandId: input.commandId } });
    try { return await commands.session.submit(input); }
    catch { if (mounted.current) feedback.notSent(copy.requestFailed, { label: copy.refresh, run: refresh }); return null; }
  };
  const revisionAttempt = useRef<RemoteCommandInput | null>(null);
  const editMessage = async (messageId: string, content: string) => {
    if (!commands.session || !authorized || !currentExecutor?.online || head.openTurnId || !ready || head.pendingExecutor) throw new Error("REVISION_NOT_IDLE");
    const previous = revisionAttempt.current;
    const entry = previous && commands.session.snapshot().entries.find(value => value.input.commandId === previous.commandId);
    if (previous && !entry?.rejected && !["rejected", "expired"].includes(entry?.receipt?.state ?? "")) {
      if (previous.payload.kind !== "edit-message" || previous.payload.text !== content || previous.payload.revision?.supersedesUserMessageId !== messageId) throw new Error(copy.requestFailed);
    } else {
      let fullAccessConsent;
      if (head.chat.options.permissionMode === "full-access") {
        if (!account.profile || !account.deviceId) throw new Error(copy.disconnected);
        fullAccessConsent = await consent.confirm({ userId: account.profile.userId, sourceDeviceId: account.deviceId,
          chatId: head.chat.id, incarnationId: head.chat.incarnationId, targetDeviceId: currentExecutor.deviceId, executionEpoch: head.executionEpoch });
        if (!fullAccessConsent) throw new Error(copy.requestFailed);
      }
      revisionAttempt.current = { commandId: crypto.randomUUID(), chatId: head.chat.id, incarnationId: head.chat.incarnationId,
        targetDeviceId: currentExecutor.deviceId, executionEpoch: head.executionEpoch,
        payload: { kind: "edit-message", text: content, expectedAgentRevision: head.chat.agentRevision,
          revision: { supersedesUserMessageId: messageId, throughSeqEnd: head.headSeq }, ...(fullAccessConsent ? { fullAccessConsent } : {}) } };
    }
    const receipt = await awaitRemoteResult(commands.session, revisionAttempt.current!, platform.commands.remote?.lifetime, 125_000, true);
    if (!receipt.admission) throw new Error(receipt.reason === "revision-stale" ? "REVISION_STALE" : receipt.reason === "revision-busy" ? "REVISION_NOT_IDLE" : copy.requestFailed);
    revisionAttempt.current = null;
  };
  const retryAuth = capability?.reason === "auth-required" && selected === head.executorDeviceId && ready && !head.openTurnId && !head.pendingExecutor;
  const send = async (override?: { displayText: string; planMode: boolean }, steer = false, authenticationRetry = false) => {
    const outgoing = override?.displayText ?? text;
    if (sending.current || (steer ? steerBlocked : authenticationRetry ? !retryAuth || !authorized || controls.editing || pendingFiles || sendBusy : blocked) || requestBusy || uncertain || (!outgoing.trim() && !completeDraft.files.length && !completeDraft.references.length) || utf8Length(outgoing) > REMOTE_LIMITS.textBytes) return;
    sending.current = true; setSendBusy(true); feedback.dismiss();
    try {
      const references = completeDraft.references.map(item => item.value);
      assertRemoteReferenceTarget(references, (steer ? currentExecutor?.deviceId : selected) ?? "");
      await draft?.flush();
      const observed = pendingAgent?.head ?? head;
      const signal = platform.commands.remote?.lifetime ?? new AbortController().signal;
      const attachments = await store.prepare(head.chat.id, platform.commands.remote?.attachments, signal);
      if (steer) {
        if (!head.openTurnId) return;
        await submit({ kind: "steer", requestId: head.openTurnId, text: outgoing, ...(references.length ? { references } : {}), ...(attachments.length ? { attachments } : {}) });
        return;
      }
      if (selected === head.executorDeviceId && !preparation) await retryPreparation();
      if (selected !== (selectionHead.pendingExecutor?.deviceId ?? selectionHead.executorDeviceId)) {
        const confirmed = await select(selected); if (!confirmed) return;
      }
      let fullAccessConsent;
      if (permissionMode === "full-access") {
        if (!account.profile?.userId || !account.deviceId || !head.executorDeviceId) return;
        fullAccessConsent = await consent.confirm({ userId: account.profile.userId, sourceDeviceId: account.deviceId,
          chatId: head.chat.id, incarnationId: head.chat.incarnationId, targetDeviceId: selected, executionEpoch: head.executionEpoch });
        if (!fullAccessConsent) return;
      }
      const options = choice ? turnOptions(choice) : undefined;
      await submit({ kind: authenticationRetry ? "retry-authentication" : "start-turn", text: outgoing, ...(references.length ? { references } : {}), expectedAgentRevision: observed.chat.agentRevision,
        agentSelection: { backend: agent, expectedFactRevision: observed.catalogRevision },
        ...(attachments.length ? { attachments } : {}), permissionMode, planMode: override?.planMode ?? completeDraft.planMode,
        ...(options ? { options } : {}), ...(fullAccessConsent ? { fullAccessConsent } : {}) }, override && planId ? { planId, planMode: override.planMode } : undefined);
    } catch { if (mounted.current) feedback.notSent(copy.requestFailed, { label: copy.refresh, run: refresh }); }
    finally { sending.current = false; if (mounted.current) setSendBusy(false); }
  };
  const decidePlan = (decision: PlanDecision) => {
    if (decision.kind === "skip") { if (planId) store.update({ dismissedPlans: [...completeDraft.dismissedPlans, planId] }); return; }
    const next = planDecisionInput(decision); if (next) { store.update({ planMode: next.planMode }); void send(next); }
  };
  const retryPreparation = async () => {
    if (!port || selectionBusy.current || !authorized || projectPending && !preparationAttempt.current) return;
    selectionBusy.current = true; setSwitching(head.executorDeviceId); setOperationPending(true); setOutcome(null);
    const attempt = preparationAttempt.current ?? { chatId: head.chat.id, incarnationId: head.chat.incarnationId,
      executionEpoch: head.executionEpoch, operationId: crypto.randomUUID() };
    preparationAttempt.current = attempt;
    try {
      await draft?.flush();
      if (attempt.executionEpoch === head.executionEpoch && target?.projectBound === false && target.deviceId === targets.value?.localDeviceId && bindProject) await bindProject(head.chat.id);
      const confirmed = await port.retryPreparation(attempt);
      if (mounted.current) { preparationAttempt.current = null; setOperationPending(false); setConfirmedSelection(confirmed); targets.refresh(); }
    } catch (error) { if (mounted.current) {
      const rejection = executorSelectionRejection(error);
      if (rejection) { preparationAttempt.current = null; setOperationPending(false);
        setOutcome({ message: rejection === "device-revoked" ? copy.revoked : rejection === "executor-changed" ? copy.sourceChanged : copy.preparationFailed, retry: "refresh" }); targets.refresh(); }
      else setOutcome({ message: copy.preparationFailed, retry: "preparation" });
    } }
    finally { selectionBusy.current = false; if (mounted.current) setSwitching(null); }
  };
  const select = async (deviceId: string, allowStaleSnapshot = false) => {
    if (!port || selectionBusy.current || !authorized) return;
    const previous = !allowStaleSnapshot && selectionAttempt.current?.targetDeviceId === deviceId ? selectionAttempt.current : null;
    const chosen = targets.items.find(item => item.deviceId === deviceId);
    if (!previous && (!chosen || targetReason(chosen, protocol, copy, deviceId === targets.value?.localDeviceId))) return;
    // An unknown claim keeps its original identity even after its promoted or prepared head arrives.
    if (!previous && deviceId === head.executorDeviceId && !head.pendingExecutor && !importedReadonly) {
      if (!preparationAttempt.current && chosen?.projectBound !== false && (ready || preparation?.state === "pending" && preparation.deviceId === deviceId && preparation.executionEpoch === head.executionEpoch)) return;
      await retryPreparation(); return;
    }
    selectionBusy.current = true; setSwitching(deviceId); setOperationPending(true); setOutcome(null);
    const attempt = previous ?? { chatId: head.chat.id, incarnationId: head.chat.incarnationId,
      expectedEpoch: head.executionEpoch, targetDeviceId: deviceId, operationId: crypto.randomUUID(), ...(allowStaleSnapshot ? { allowStaleSnapshot } : {}) };
    selectionAttempt.current = attempt;
    try {
      await draft?.flush();
      if (!previous && chosen?.projectBound === false && deviceId === targets.value?.localDeviceId && bindProject) await bindProject(head.chat.id);
      const confirmed = await port.select(attempt);
      if (mounted.current) { selectionAttempt.current = null; setOperationPending(false); setConfirmedSelection(confirmed); setPendingAgent(null); store.update({ options: null }); targets.refresh(); }
      return confirmed;
    } catch (error) { if (mounted.current) {
      const rejection = executorSelectionRejection(error);
      if (rejection) { selectionAttempt.current = null; setOperationPending(false);
        setOutcome({ message: rejection === "device-revoked" ? copy.revoked : rejection === "executor-changed" ? copy.sourceChanged : copy.couldNotSwitch.replace("{name}", chosen?.name ?? copy.computer), retry: "refresh" }); targets.refresh(); }
      else setOutcome({ message: copy.couldNotSwitch.replace("{name}", chosen?.name ?? copy.computer), retry: "select" });
    } }
    finally { selectionBusy.current = false; if (mounted.current) setSwitching(null); }
  };
  const interactionControls = { recoveryEnabled: platform.capabilities.recovery, entries: commands.entries, copy, locale, backendName: agent, submit, draftChanged, disabled: !authorized || !currentExecutor?.online };
  // An outcome needs its anchor: the chip stays while a callout is open, even on a desktop whose only computer is itself.
  const showDevice = keepComposerVisible || Boolean(outcome) || !ready || !targets.value?.localDeviceId || targets.items.length !== 1 || head.executorDeviceId !== targets.value.localDeviceId || !selected;
  const face = computerFace(copy, { blocked: blockedReason, loading: targets.value === null, target, selected: Boolean(selected), protocol, revoked,
    attention: Boolean(outcome), localDeviceId: targets.value?.localDeviceId ?? null });
  const callout: ComputerCallout | null = outcome ? { message: outcome.message, dismiss: () => setOutcome(null),
    action: { label: outcome.retry === "refresh" ? copy.refresh : outcome.retry === "select" ? copy.retryShort : copy.retryPreparation,
      run: () => { if (outcome.retry === "select" && selectionAttempt.current) void select(selectionAttempt.current.targetDeviceId); else if (outcome.retry === "preparation") void retryPreparation(); else refresh(); } } } : null;
  const action = bindable ? { kind: "bind" as const, label: copy.bindProject } : sendAction(copy, { head, target, ready: preparation?.state !== "blocked", busy: sendBusy || requestBusy || uncertain, retryCreate: false });
  const act = () => {
    if (action.kind === "send") { void send(undefined, referenceMode === "current" && Boolean(head.openTurnId)); return; }
    if (!authorized || selecting || operationPending || projectPending || !head.executorDeviceId) return;
    if (action.kind === "retry-preparation") void retryPreparation();
    else if (action.kind === "bind") void select(head.executorDeviceId);
  };
  // The card's actions are the same claim the chip makes, so a failed one retries through the same attempt.
  const cardDisabled = !authorized || selecting || operationPending || uncertain;
  const computerMenu = (align: "start" | "end") => <DeviceMenu align={align} items={targets.items} selectedDeviceId={selected} localDeviceId={targets.value?.localDeviceId ?? null} protocol={protocol} copy={copy}
    disabled={cardDisabled} sameAgent={agent === head.chat.agent} allowLocalBinding={Boolean(bindProject)} onSelect={deviceId => void select(deviceId)} />;
  // A lost claim stays pending until its own attempt is retried: Retry is then the card's one filled action, as it is in the chip's callout.
  const retryLostSelection = () => { const attempt = selectionAttempt.current; if (attempt) void select(attempt.targetDeviceId); };
  const continueOnExecutor = () => { if (head.executorDeviceId) void select(head.executorDeviceId); };
  const cardActions: UnavailableAction[] = !gate ? [] : outcome?.retry === "select"
    ? [{ label: copy.retryShort, disabled: !authorized || selecting || uncertain, run: retryLostSelection }]
    : [
      ...(gate.primary?.kind === "choose" ? [{ label: copy.chooseComputer, disabled: cardDisabled, menu: computerMenu("start") }]
        : gate.primary ? [{ label: gate.primary.kind === "bind" ? copy.bindProject : copy.continueOn.replace("{name}", target?.name ?? copy.computer), disabled: cardDisabled || gate.primary.disabled, run: continueOnExecutor }] : []),
      ...(gate.secondary === "another" ? [{ label: copy.anotherComputer, outline: true, disabled: cardDisabled, menu: computerMenu("start") }]
        : gate.secondary === "check" || outcome?.retry === "refresh" ? [{ label: copy.checkAgain, outline: true, disabled: !connected, icon: <RefreshCw aria-hidden="true" data-icon="inline-start" />, run: refresh }] : []),
    ];
  const cardIcon = (glyph: ReactNode) => selecting ? <span className="chat-remote-working mt-0.5 shrink-0">{glyph}</span> : glyph;
  // Restoring is one submit: the card's own busy state is what prevents a second one.
  const runRestore = () => { if (!restore || restoring) return; setRestoring(true); void restore().catch(() => {}).finally(() => { if (mounted.current) setRestoring(false); }); };
  const remoteOff = !enabled && targets.value !== null;
  const overlay = forkAnchor && commands.session && navigateToChat && <RemoteForkDialog key={`${head.chat.incarnationId}:${forkAnchor.id}`}
      head={head} anchor={forkAnchor} session={commands.session} chats={platform.chats} locale={locale}
      navigate={id => navigateToChat(id, "")} onClose={() => setForkAnchor(null)} />;
  const transcript = <ChatTranscript findEnabled={platform.capabilities.find} outlineEnabled={platform.capabilities.outline} onEdit={ordinary && authorized && ready && currentExecutor?.online && !head.pendingExecutor && !head.openTurnId ? editMessage : undefined} onFork={ordinary && enabled && authorized && head.chat.classification.projectId && !head.archivedAt && currentExecutor?.online && navigateToChat
      ? { label: translate("fork.action"), run: setForkAnchor } : undefined} onOpenImage={onOpenImage} head={head} source={platform.transcript} live={platform.live} commands={platform.commands} locale={locale} targetMessageId={targetMessageId}
      lineage={navigateToChat ? { chats: platform.chats, navigate: navigateToChat } : undefined}
      onCompletedPlan={setCompletedPlan} remote={ordinary && enabled ? interactionControls : undefined} onCanonicalCommands={commands.session?.canonical} />;
  const composer = ordinary && (enabled || keepComposerVisible || remoteOff) && <ComposerDock className="chat-remote">
      {completeDraft.retainedText && <div className="chat-remote-hint" data-retained-draft>
        <p className="whitespace-pre-wrap break-words">{completeDraft.retainedText}</p>
        <Button type="button" variant="outline" disabled={uncertain || requestBusy || sendBusy} onClick={() => { store.restoreText(); draft?.change(store.snapshot().text); }}>{input.restoreDraft}</Button>
      </div>}
      {head.pendingExecutor && !head.openTurnId && head.pendingExecutor.snapshotRequired && <div className="chat-remote-hint" role="status">
        <p>{copy.waitingFiles.replace("{name}", currentExecutor?.name ?? copy.computer)}</p>
        <Button type="button" variant="ghost" disabled={selecting} onClick={() => void select(head.pendingExecutor!.deviceId, true)}>{copy.usePreviousFiles}</Button>
      </div>}
      {enabled && platform.capabilities.queue && commands.session && platform.commands.remote && <RemoteQueue head={head} port={platform.commands.remote} session={commands.session}
        entries={commands.entries} locale={locale} disabled={!authorized} />}
      {planId && <ChatPlanDecision locale={locale} pending={{ busy: blocked || requestBusy || uncertain }} onDecision={decidePlan} />}
      {head.archivedAt !== null ? <RemoteUnavailable icon={<Archive aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />} title={copy.archivedTitle} description={restore ? copy.restoreToSend : undefined}
          actions={restore ? [{ label: copy.restore, disabled: restoring, run: runRestore }] : []} />
        : remoteOff ? <RemoteUnavailable icon={<PlatformGlyph kind="none" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />} title={copy.disabled} description={copy.disabledDescription} actions={disabledActions} />
        : gate ? <RemoteUnavailable icon={cardIcon(importedReadonly ? <AgentBackendIcon backend={head.chat.agent} className={selecting ? "size-3.5" : "mt-0.5 size-5 shrink-0 text-muted-foreground"} />
            : <PlatformGlyph kind={target?.platform ?? "none"} className={selecting ? "size-3.5" : "mt-0.5 size-5 shrink-0 text-muted-foreground"} />)} title={copy.readOnly} description={gate.description}
          error={outcome?.message} actions={cardActions} />
        : <ComposerForm className="chat-remote-form" onSubmit={event => { event.preventDefault(); act(); }} {...controls.events}>
        {controls.files}
        {referenceMismatch && <p role="alert" className="chat-remote-hint">{input.referenceChanged}</p>}
        <RemoteEditor onWorkspaceFileClick={node => {
          const reference = completeDraft.references.find(item => item.value.kind === "file" && item.value.path === node.path)?.value;
          if (!onOpenWorkspaceFile || reference?.kind !== "file" || !commands.session) return;
          const session = commands.session;
          onOpenWorkspaceFile({ key: JSON.stringify(reference), title: reference.path, unavailableMessage: copy.computerOffline.replace("{name}", targetsLatest.current.items.find(target => target.deviceId === reference.deviceId)?.name ?? copy.computer), read: async signal => {
            if (!targetsLatest.current.items.find(target => target.deviceId === reference.deviceId)?.online) throw new Error("target-offline");
            const result = await queryRemoteWorkspace({ session, transcript: platform.transcript }, head, reference.deviceId, { kind: "read-workspace-file", reference }, signal);
            if (result.kind !== "workspace-text") throw new Error("workspace-text-unavailable"); return result.content;
          } });
        }} references={completeDraft.references} suggestions={referenceSuggestions} removeReference={key => store.update({ references: completeDraft.references.filter(item =>
          (item.value.kind === "file" ? `file:${item.value.path}` : `library:${item.value.libraryId}`) !== key) })} ref={composerElement} text={text} change={change} files={completeDraft.files} remove={id => store.remove(id)} placeholder={copy.placeholder} label={copy.draft}
          disabled={uncertain || sendBusy || requestBusy || (draft ? !draft.ready : false)} previewTitle={input.previewFile} onFileClick={controls.openFile} fileStates={controls.fileStates} />
        <ComposerToolbar><PromptInputTools>{controls.tools}
          {head.openTurnId && <Button type="button" variant="ghost" size="sm" aria-pressed={referenceMode === "current"} disabled={sendBusy || uncertain} onClick={() => setReferenceSelection({ requestId: head.openTurnId, mode: referenceMode === "next" ? "current" : "next" })}>{referenceMode === "current" ? input.currentTurn : input.nextMessage}</Button>}
          {tooLong && <span role="alert" className="chat-remote-budget">{budgetLabel(copy, bytes, REMOTE_LIMITS.textBytes)}</span>}
        </PromptInputTools><ComposerActions>
          {showDevice && <DeviceSelector items={targets.items} currentDeviceId={head.executorDeviceId} selectedDeviceId={selected} localDeviceId={targets.value?.localDeviceId ?? null} protocol={protocol} copy={copy} face={face} callout={callout}
            disabled={!authorized || selecting || operationPending || uncertain} sameAgent={agent === head.chat.agent} allowLocalBinding={Boolean(bindProject)} onSelect={deviceId => void select(deviceId)} />}
          <RemoteAgentSelector quotaEnabled={platform.capabilities.quota} locale={locale} target={target} head={head} value={agent} copy={copy} disabled={!authorized || selecting || operationPending || uncertain} onSelect={backend => { setPendingAgent({ backend, head }); store.update({ options: null }); }} />
          {capability?.models && <ComposerModelSelector locale={locale} backend={agent} models={platform.capabilities.serviceTier ? capability.models : capability.models.map(model => ({ ...model, serviceTiers: undefined }))} value={modelValue} disabled={!authorized || selecting || operationPending || uncertain}
            onChange={next => store.update({ options: { backend: agent, ...next } })} />}
          {retryAuth && <Button type="button" variant="outline" disabled={!authorized || requestBusy || uncertain || sendBusy || pendingFiles} onClick={() => void send(hasInput ? undefined : { displayText: copy.retryShort, planMode: false }, false, true)}>{copy.retryShort}</Button>}
          {action.kind === "send"
            ? <PromptInputSubmit className="shrink-0 rounded-full max-md:size-11 pointer-coarse:size-11" aria-label={referenceMode === "current" && head.openTurnId ? input.guide : copy.send} status={action.busy ? "submitted" : undefined} disabled={(referenceMode === "current" && head.openTurnId ? steerBlocked || referenceMismatch : blocked) || requestBusy || uncertain || !hasInput || tooLong} />
            : <Button type="submit" size="lg" className="rounded-full px-3 text-sm" data-send-action={action.kind} disabled={!authorized || selecting || operationPending || uncertain || projectPending}>{action.label}</Button>}
        </ComposerActions></ComposerToolbar>
      </ComposerForm>}
      {controls.dialogs}{consent.dialog}
      {commands.session && <RemoteReceipts entries={commands.entries.filter(entry => !isRemoteWorkspaceQuery(entry.input.payload.kind))} session={commands.session} copy={copy} locale={locale} disabled={!authorized} reexecuteDisabled={blocked || uncertain || requestBusy}
        reexecute={entry => { if (!blocked && !uncertain && !requestBusy && entry.input.payload.kind === "start-turn") {
          const original = entry.input.payload;
          if (entry.input.targetDeviceId !== head.executorDeviceId || entry.input.executionEpoch !== head.executionEpoch ||
            original.agentSelection && original.agentSelection.backend !== agent) { setOutcome({ message: copy.sourceChanged, retry: "refresh" }); return; }
          void submit({ ...original, expectedAgentRevision: head.chat.agentRevision,
            ...(original.agentSelection ? { agentSelection: { ...original.agentSelection, expectedFactRevision: head.catalogRevision } } : {}) });
        } }} />}
      {commands.more && <Button type="button" variant="outline" disabled={commands.loading} onClick={() => void commands.session?.more()}>{copy.check}</Button>}
    </ComposerDock>;
  const regions: ConversationRegions = { overlay, transcript, composer, footer: footer ?? (!enabled && readOnlyFooter),
    containerRef: bindConversation, className: "chat-remote-conversation", layout };
  // The page render port only forwards the callback ref to React; no ref is read during render.
  // eslint-disable-next-line react-hooks/refs
  return <ArtifactHostProvider value={artifactComposer}>{children ? children(regions) : <ChatConversation {...regions} />}</ArtifactHostProvider>;
}
function turnOptions(choice: { model?: string; reasoningEffort?: string; serviceTier?: string }): RemoteTurnOptions | undefined {
  const value = { ...(choice.model ? { model: choice.model } : {}), ...(choice.reasoningEffort ? { reasoningEffort: choice.reasoningEffort } : {}), ...(choice.serviceTier ? { serviceTier: choice.serviceTier } : {}) };
  return value.model !== undefined || value.reasoningEffort !== undefined || value.serviceTier !== undefined ? value : undefined;
}
