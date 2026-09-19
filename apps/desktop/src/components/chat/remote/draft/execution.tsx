/**
 * [INPUT]: Native composer controller, account-scoped remote ports and the preferred computer setting.
 * [OUTPUT]: One composer with draft-owned reference provenance, target-checked submission, retry-safe create-and-send adapters and the executor's name for controls only that computer can answer.
 * [POS]: Draft execution boundary; preferences only preselect, local submissions keep original coordinator custody.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import type { ChatSessionController } from "../../runtime/use-chat-session";
import { useDesktopChatSources } from "@/lib/cloud/chat/sources";
import { useDesktopAccountFacade } from "@/lib/cloud/chat/platform/account";
import { useRemoteTargets } from "@ai-chat/chat-ui/remote-hooks";
import { DeviceSelector, RemoteAgentSelector, targetReason } from "@ai-chat/chat-ui/remote-selectors";
import { computerFace } from "@ai-chat/chat-ui/remote-status";
import { remoteCopy } from "@ai-chat/chat-ui/remote-copy";
import { remoteDraftStore, handoffRemoteDraft, type RemoteDraftStore } from "@ai-chat/chat-ui/remote-draft";
import { createAndSend } from "@ai-chat/chat-ui/remote-creation";
import { useRemoteReferences } from "@ai-chat/chat-ui/remote-references";
import { useRemoteConsent } from "@ai-chat/chat-ui/remote-consent";
import { ComposerModelSelector } from "@ai-chat/chat-ui/composer-controls/model";
import { ChatPermissionSelector } from "@ai-chat/chat-ui/composer-controls/permission";
import { settingsStore } from "@/lib/settings-store";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { commitDraftChat, handoffComposerDraft } from "@/lib/chat-composer-store";
import { composerWorkspaceReferences, selectComposerWorkspaceReference } from "@/lib/chat-composer/references";
import { assertLocalDraftReferences, remoteDraftInput } from "./input";
import { remoteInputCopy } from "@ai-chat/chat-ui/remote-input-copy";
import type { RemoteCreateInput } from "@ai-chat/chat-ui/remote-contracts";
import type { AgentTurnOptions } from "../../../../../shared/agent-ipc";
const originalInputs = new WeakMap<RemoteDraftStore, Parameters<ChatSessionController["composer"]["handleSubmit"]>[0]>();
const subscribePreferences = (changed: () => void) => window.cloudRemote && window.settings ? settingsStore.subscribe(changed) : () => {};
export function useDraftExecution(original: ChatSessionController["composer"]) {
  const enabled = !original.persisted && original.project.kind !== "fixed-app";
  const sources = useDesktopChatSources(), account = useDesktopAccountFacade();
  const port = enabled ? sources?.executor.remote : undefined;
  const targets = useRemoteTargets(port, null, original.selectedProjectId);
  const { settings } = useSyncExternalStore(subscribePreferences, settingsStore.getSnapshot);
  const { i18n } = useAppTranslation(), copy = remoteCopy(i18n.language), navigate = useNavigate();
  const [selected, select] = useState<{ scope: object; deviceId: string } | null>(null), [agent, setAgent] = useState<RemoteCreateInput["backend"] | null>(null);
  const [busy, setBusy] = useState(false), flight = useRef(false), lifetime = useRef(new AbortController());
  useEffect(() => { if (window.cloudRemote && window.settings) settingsStore.ensureLoaded(); lifetime.current = new AbortController(); return () => lifetime.current.abort(); }, []);
  const draftKey = `new:${original.chatId}`, store = remoteDraftStore(sources ?? { account }, draftKey);
  const draft = useSyncExternalStore(store.subscribe, store.snapshot);
  const localId = targets.value?.localDeviceId ?? account.snapshot().deviceId;
  const allowed = Boolean(enabled && sources && targets.value?.remoteControlEnabled);
  const preferred = targets.items.find(item => item.deviceId === settings?.defaultExecutionDeviceId && item.online && !item.reason)?.deviceId;
  const selection = selected?.scope === store ? selected.deviceId : null;
  const targetId = draft.creation?.input.targetDeviceId ?? selection ?? preferred ?? localId;
  const target = targets.items.find(item => item.deviceId === targetId);
  if (enabled && selection === null && targets.value && targetId && (preferred || settings)) select({ scope: store, deviceId: targetId });
  const remote = Boolean(enabled && targetId && targetId !== localId);
  const backend = draft.creation?.input.backend ?? agent ?? target?.agents.find(item => item.backend === original.turnOptions.backend && item.available)?.backend ?? target?.agents.find(item => item.available)?.backend ?? original.turnOptions.backend;
  const capability = target?.agents.find(item => item.backend === backend);
  const protocol = targets.value?.sourceProtocolVersion ?? -1;
  const ready = Boolean(allowed && remote && target && capability?.available && !targetReason(target, protocol, copy));
  const options = capability?.options ?? original.turnOptions;
  const turnOptions = { ...options, ...(draft.options?.backend === backend ? draft.options : {}), ...(draft.creation?.options ?? {}), permissionMode: draft.creation?.permissionMode ?? draft.permissionMode ?? options.permissionMode } as AgentTurnOptions;
  const consent = useRemoteConsent(store, i18n.language, target?.name ?? copy.computer, `${targetId}/${backend}`);
  const references = useRemoteReferences({ head: null, projectId: original.selectedProjectId, platform: sources, target, session: null, store, locale: i18n.language, disabled: !remote || busy });
  const controller: typeof original = !remote ? { ...original, handleSubmit: async (message, options) => {
    try { assertLocalDraftReferences(message, composerWorkspaceReferences(original.chatId), localId); }
    catch { throw new Error(remoteInputCopy(i18n.language).referenceChanged); }
    return original.handleSubmit(message, options);
  } } : { ...original, loading: false, inputDisabled: busy, turnControlsDisabled: busy || Boolean(draft.creation),
    settingsLoading: false, settingsSaving: false, backendState: "ready", pendingAgent: null,
    turnOptions, imageInputAvailable: capability?.capabilities?.imageInput ?? false,
    planMode: draft.creation?.planMode ?? draft.planMode, planSupported: capability?.capabilities?.planMode ?? false, planAvailable: capability?.capabilities?.planMode ?? false,
    skillsLoading: false, setPlanMode: value => store.update({ planMode: typeof value === "function" ? value(store.snapshot().planMode) : value }), togglePlanMode: async () => { store.update({ planMode: !store.snapshot().planMode }); },
    handleSubmit: async (message, submitOptions) => {
      if (!sources || !ready || flight.current) throw new Error(copy.disconnected);
      flight.current = true; setBusy(true);
      try {
        let attempt = store.snapshot().creation;
        if (!attempt) {
          const input = await remoteDraftInput(original.chatId, targetId!, message, composerWorkspaceReferences(original.chatId));
          store.reset(); store.text(input.text); store.add(input.files);
          attempt = { input: { createOperationId: crypto.randomUUID(), targetDeviceId: targetId!, backend, projectId: original.selectedProjectId },
            commandId: crypto.randomUUID(), text: input.text, permissionMode: turnOptions.permissionMode, planMode: draft.planMode, references: input.references,
            options: { ...(turnOptions.model ? { model: turnOptions.model } : {}), ...("reasoningEffort" in turnOptions && turnOptions.reasoningEffort ? { reasoningEffort: turnOptions.reasoningEffort } : {}),
              ...("serviceTier" in turnOptions && turnOptions.serviceTier ? { serviceTier: turnOptions.serviceTier } : {}) } };
          originalInputs.set(store, message);
          store.update({ creation: attempt });
        }
        const signal = AbortSignal.any([lifetime.current.signal, ...(submitOptions?.signal ? [submitOptions.signal] : [])]);
        const receipt = await createAndSend(sources, store, attempt, signal, consent.confirm);
        signal.throwIfAborted();
        handoffRemoteDraft(sources, draftKey, `chat:${receipt.chatId}/${receipt.incarnationId}`);
        handoffComposerDraft(original.chatId, receipt.chatId, receipt.incarnationId, originalInputs.get(store));
        originalInputs.delete(store);
        store.update({ creation: null });
        navigate(`/chat/${encodeURIComponent(receipt.chatId)}`); commitDraftChat(original.chatId);
      } finally { flight.current = false; if (!lifetime.current.signal.aborted) setBusy(false); }
    },
  };
  const device = enabled && allowed && (targets.items.length > 1 || targetId !== localId) ? <DeviceSelector items={targets.items} currentDeviceId={targetId ?? null} selectedDeviceId={targetId ?? ""}
    localDeviceId={localId ?? null} protocol={protocol} copy={copy} disabled={busy || Boolean(draft.creation)} onSelect={id => { select({ scope: store, deviceId: id }); setAgent(null); store.update({ options: null }); }}
    face={computerFace(copy, { target, selected: Boolean(target?.online), protocol, localDeviceId: localId ?? null, blocked: null, loading: targets.value === null, revoked: false, attention: false })} /> : null;
  const confirmLocalReference = (suggestion: Parameters<typeof references.onSuggestionSelect>[0]) => {
    if (!remote && suggestion.kind === "workspace-file") {
      selectComposerWorkspaceReference(original.chatId, suggestion.path);
      store.update({ references: store.snapshot().references.filter(item => item.value.kind !== "file" || item.value.path !== suggestion.path) });
    }
  };
  /* §4.3 honest degradation: controls that only the executor can answer say whose computer that is,
     rather than answering with this machine's facts. Built here so the remote catalog stays lazy. */
  const executorLabel = remote ? copy.onComputer.replace("{name}", target?.name ?? copy.computer) : null;
  return { controller, device, remote, executorLabel, confirmLocalReference, referenceProps: remote ? { ...references,
    onSuggestionSelect: async (suggestion: Parameters<typeof references.onSuggestionSelect>[0]) => {
      if (!references.onSuggestionSelect(suggestion)) throw new Error("reference-target-changed");
      if (suggestion.kind === "workspace-file") {
        const reference = store.snapshot().references.find(item => item.value.kind === "file" && item.value.path === suggestion.path)?.value;
        if (reference?.kind !== "file") throw new Error("reference-target-changed");
        selectComposerWorkspaceReference(original.chatId, suggestion.path, reference);
      }
      return false;
    } } : undefined, canSend: remote ? ready : undefined, controls: remote ? {
    agent: <RemoteAgentSelector locale={i18n.language} target={target} head={null} value={backend} copy={copy} disabled={busy || Boolean(draft.creation)} onSelect={value => { setAgent(value); store.update({ options: null }); }} />,
    model: capability?.models ? <ComposerModelSelector locale={i18n.language} backend={backend} models={capability.models} disabled={busy || Boolean(draft.creation)} value={draft.options?.backend === backend ? draft.options : {}}
      onChange={value => store.update({ options: { backend, ...value } })} /> : null,
    permission: <ChatPermissionSelector locale={i18n.language} deferConfirmation value={turnOptions.permissionMode} allowedModes={capability?.capabilities?.permissionModes}
      disabled={busy || Boolean(draft.creation)} onChange={async permissionMode => { store.update({ permissionMode }); }} />,
  } : null, dialogs: remote ? consent.dialog : null };
}

/** Load account-owned remote custody only for a cloud-capable new Chat. */
export default function DraftExecutionAdapter({ controller, children }: { controller: ChatSessionController["composer"]; children(value: ReturnType<typeof useDraftExecution>): React.ReactNode }) {
  return children(useDraftExecution(controller));
}
