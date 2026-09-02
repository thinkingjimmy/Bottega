/**
 * [INPUT]: Depends on React, renderer locale/catalog runtime and data providers, canonical chat/turn snapshots, PanelSessionContext, session subcontrollers, Agent attach, workspace/skills/files, and Gallery projections
 * [OUTPUT]: Provides the stable ChatSessionController with main-derived resume actions, revision eligibility/submission, injectable panel identity, canonical submission, and side-panel state
 * [POS]: The thin composition root of chat/runtime; durable authority remains in main while renderer owns view generation. Routing stays outside: post-send navigation is the chat route's draft-residence observation, not a session concern
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatStatus } from "ai";
import { richValueDisplayText, type RichValue } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { AgentBackendId, AgentScope, SessionRef, SteerOutboxProjection } from "../../../../shared/agent-ipc";
import type { AppChatRole, ChatMessage } from "../../../../shared/chats-ipc";
import { isFailedAssistant } from "../../../../shared/chat-failure";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import {
  abandonFatalTurn,
  acknowledgeCleanupFailure,
  cancelAgentRequest,
  retryAgentSameSession,
  retryAgentWithoutSession,
  type CodexRequest,
} from "@/lib/agent-client";
import { errorMessage } from "@/lib/errors";
import { useEffectiveLocale } from "@/lib/i18n-locale";
import { translate } from "../../../../shared/i18n/runtime";
import { mergeChatMessages, sameProjectionStatus, type ChatProjectionStatus, type ChatTurnProjection, type ProjectedSubagent } from "@/lib/chat-turn-attach";
import { bindComposerWorkspaceIdentity, reconcileComposerProject, replaceDraftFiles, retainComposerResources, setComposerProject, updateComposer, useComposerState } from "@/lib/chat-composer-store";
import { createChatHydration, hydrationReady } from "@/lib/chat-hydration";
import type { TurnDraft } from "../../../../shared/chat-turn-reducer";
import { type LiveAttachmentPreview } from "./chat-attachments";
import {
  composerGates,
  createPanelSessionContext,
  messageId,
  revisionUnavailableReason as resolveRevisionUnavailableReason,
  type ChatProjectMode,
  type PanelSessionContext,
} from "./chat-session-model";
import { useWorkspaceLifecycle } from "./use-workspace-lifecycle";
import { useRichFileResources } from "./use-rich-file-resources";
import { useMessageQueue } from "./use-message-queue";
import { bindChatAttachment } from "./bind-chat-attachment";
import {
  createSessionSubmit,
} from "./session/create-session-submit";
import { createSessionSubmitLifecycle, useSessionViewFence } from "./session/create-session-submit-lifecycle";
import { useSessionInteractions, type SessionSubmit } from "./session/use-session-interactions";
import { useSessionSidePanel } from "./session/use-session-side-panel";
import { useStableController } from "./use-stable-controller";
import { useSessionRevision } from "./session/use-session-revision";
import {
  useSessionQueuePorts,
  useSessionSubmissionPorts,
} from "./session/use-session-submission-ports";
import { useSessionMessageProjection, useSessionRuntimeCatalogs } from "./session/use-session-runtime-projections";
export type { ChatProjectMode, PendingPlanDecisionState, PendingUserInputState, SidePanelState } from "./chat-session-model";

export function useChatSession({
  scope: inputScope,
  project: inputProject,
  draftAgent,
  panelContext: inputPanelContext,
}: {
  scope: AgentScope;
  project: ChatProjectMode;
  draftAgent?: AgentBackendId;
  panelContext?: PanelSessionContext;
}) {
  const locale = useEffectiveLocale();
  const chatId = inputScope.conversationId;
  const projectKind = inputProject.kind;
  const fixedAppId = projectKind === "fixed-app" ? inputProject.appId : null;
  const fixedAppRole: AppChatRole | null = projectKind === "fixed-app" ? inputProject.appRole : null;
  const scope = useMemo<AgentScope>(() => ({ conversationId: chatId }), [chatId]);
  const project = useMemo<ChatProjectMode>(
    () =>
      projectKind === "fixed-app"
        ? {
            kind: "fixed-app",
            appId: fixedAppId!,
            appRole: fixedAppRole!,
          }
        : { kind: "selectable" },
    [fixedAppId, fixedAppRole, projectKind]
  );
  const { chats, loading: chatsLoading, createChat, createAppChat, appendMessage, getChat } = useChats();
  const { projects, loading: projectsLoading, addProject, ensureForApp, listBranches, checkoutBranch, createBranch } = useProjects();
  const captureView = useSessionViewFence(chatId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [agentSession, setAgentSession] = useState<SessionRef | undefined>();
  const [loading, setLoading] = useState(true);
  const [hydratedChatId, setHydratedChatId] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const composerState = useComposerState(chatId);
  // 草稿与 Project 选择同寿，统一归 composer store，避免重挂载错配旧 scope grant。
  const selectedProjectId = composerState.projectId;
  const richValue = composerState.draft.richValue;
  const attachmentFiles = composerState.draft.files;
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const [queued, setQueued] = useState(false);
  const [queueNotice, setQueueNotice] = useState("");
  const [steerIntents, setSteerIntents] = useState<SteerOutboxProjection[]>([]);
  const [draft, setDraft] = useState<TurnDraft | null>(null);
  const [subagents, setSubagents] = useState<Record<string, ProjectedSubagent>>({});
  const draftRef = useRef<TurnDraft | null>(null);
  const [livePreviews, setLivePreviews] = useState<ReadonlyMap<string, LiveAttachmentPreview[]>>(new Map());
  const requestRef = useRef<CodexRequest | null>(null);
  const submitRef = useRef<SessionSubmit | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const sessionAbortRef = useRef(new AbortController());
  const recordExistsRef = useRef(false);
  const incarnationIdRef = useRef<string | null>(null);
  const attachGenerationRef = useRef(0);
  const [hydration, setHydration] = useState(() => createChatHydration(0));
  const projectionRef = useRef<ChatTurnProjection>({
    messages: [],
    draft: null,
    approvals: [],
    userInputs: [],
    subagents: {},
    blocksNewTurn: true,
    steeringSupported: false,
  });
  const [projectionStatus, setProjectionStatus] =
    useState<ChatProjectionStatus>({});
  // 投影自推状态；同值早退保住队列依赖链的身份。
  const applyProjectionStatus = useCallback((next: ChatProjectionStatus) => {
    setProjectionStatus((current) =>
      sameProjectionStatus(current, next) ? current : next
    );
  }, []);
  // 本地 append 唯一入口：先并入投影，再由投影驱动 state——
  // 绕过投影直写 setMessages 会被下一个 seq 事件的全量投影覆盖。
  const appendProjected = useCallback((message: ChatMessage) => {
    projectionRef.current = {
      ...projectionRef.current,
      messages: mergeChatMessages(projectionRef.current.messages, [message]),
    };
    messagesRef.current = projectionRef.current.messages;
    setMessages(messagesRef.current);
  }, []);
  const appendLocalAssistant = useCallback(
    (content: string, isError = false) =>
      appendProjected({
        id: messageId("assistant"),
        role: "assistant",
        content,
        isError,
        createdAt: Date.now(),
        seq: (projectionRef.current.messages.at(-1)?.seq ?? 0) + 1,
      }),
    [appendProjected]
  );
  const messageSnapshot = useSessionMessageProjection({
    chatId, hydratedChatId, projectionRef, messagesRef, setMessages,
  });
  const {
    workspaceIdentityKey,
    workspacePrecondition,
    workspaceScope,
    workspaceScopeKey,
  } =
    useWorkspaceLifecycle({
    chatId,
    chats,
    composerIncarnationId: composerState.incarnationId,
    messageIncarnationId: messageSnapshot?.incarnationId,
    persisted,
    project,
    projects,
    selectedProjectId,
  });
  const workspaceScopeKeyRef = useRef(workspaceScopeKey);
  useLayoutEffect(() => {
    workspaceScopeKeyRef.current = workspaceScopeKey;
    return () => {
      workspaceScopeKeyRef.current = "";
    };
  }, [workspaceScopeKey]);
  const catalogs = useSessionRuntimeCatalogs({
    scope, sessionReady: !loading && hydratedChatId === chatId,
    workspaceScope, workspaceScopeKey, draftAgent,
  });
  const { setup, settings, selectedBackend, backendState, planSupported, workspaceFileSearch } = catalogs;
  const { lockBackend } = settings;
  const { isPlanCapabilityChecking, planAvailable, planCapabilityChecking, planMode,
    requirePlanCapability, setPlanMode, skills, skillsError, skillsHiddenCount,
    invalidatedSkillRefs, skillsLoading, togglePlanMode } = catalogs.skills;
  const {
    authorize: authorizeRichFile,
    discard: discardRichNode,
    fileFor: richFileFor,
  } = useRichFileResources(chatId, workspaceScope);
  const reportStopError = useCallback(
    (cause: unknown) =>
      setAttachmentNotice(
        translate(locale, "chat.runtime.relayStopFailed", {
          message: errorMessage(cause),
        })
      ),
    [locale]
  );
  const interactions = useSessionInteractions({
    activeRequestId,
    messages,
    requestRef,
    submitRef,
    setPlanMode,
    reportStopError,
  });
  const panelContext = useMemo<PanelSessionContext>(() => {
    if (inputPanelContext) return inputPanelContext;
    return createPanelSessionContext({
      chatId,
      incarnationId: messageSnapshot?.incarnationId,
      adopted,
      project,
      selectedProjectId,
    });
  }, [adopted, chatId, inputPanelContext, messageSnapshot?.incarnationId, project, selectedProjectId]);
  const sidePanel = useSessionSidePanel({
    conversationId: chatId,
    panelContext,
    draft,
    messages,
    status,
    subagents,
    fileFor: richFileFor,
    workspaceScope,
    workspaceScopeKey,
  });
  const {
    approvals,
    approvalBusy,
    approvalError,
    cancelPending,
    continueTurn,
    handleStop: stopTurn,
    pendingPlanDecision,
    pendingUserInput,
    respondApproval,
    respondPlanDecision,
    respondUserInput,
    retryTurn,
    setApprovalBusy,
    setApprovalError,
    setApprovals,
    setCancelPending,
    setPendingPlanDecision,
    setPendingUserInput,
  } = interactions;
  const {
    close: closeSidePanel,
    closeFile: closeSidePanelFile,
    openDraftPlan: openDraftPlanPanel,
    openFile: openFilePanel,
    openWorkspaceFile: openWorkspaceFilePanel,
    openImage,
    openPlan: openPlanPanel,
    openSubagent,
    openTabs,
    reconcileRichValue: reconcileSidePanelRichValue,
    state: sidePanelState,
  } = sidePanel;
  useEffect(
    () =>
      bindChatAttachment({
        chatId,
        getChat,
        onRecordAgent: (agent) => {
          void lockBackend(agent).catch((cause) =>
            appendLocalAssistant(
              translate(locale, "chat.runtime.settings.transcriptReadFailed", {
                message: errorMessage(cause),
              }),
              true
            )
          );
        },
        onRecord: (record) => setAdopted(Boolean(record?.importOrigin)),
        onSteerSnapshot: setSteerIntents,
        refs: {
          generation: attachGenerationRef,
          projection: projectionRef,
          messages: messagesRef,
          draft: draftRef,
          request: requestRef,
          recordExists: recordExistsRef,
          incarnationId: incarnationIdRef,
        },
        set: {
          hydration: setHydration,
          projectionStatus: applyProjectionStatus,
          hydratedChatId: setHydratedChatId,
          loading: setLoading,
          persisted: setPersisted,
          messages: setMessages,
          session: setAgentSession,
          draft: setDraft,
          subagents: setSubagents,
          approvals: setApprovals,
          activeRequestId: setActiveRequestId,
          status: setStatus,
          pendingUserInput: setPendingUserInput,
          pendingPlanDecision: setPendingPlanDecision,
          cancelPending: setCancelPending,
          approvalBusy: setApprovalBusy,
          approvalError: setApprovalError,
          queued: setQueued,
          queueNotice: setQueueNotice,
        },
      }),
    [
      appendLocalAssistant,
      applyProjectionStatus,
      chatId,
      getChat,
      setApprovalBusy,
      setApprovalError,
      setApprovals,
      setCancelPending,
      setPendingPlanDecision,
      setPendingUserInput,
      lockBackend,
      locale,
    ]
  );
  // 路由意图归 ChatRoute；此处只把被删/失效 Project 这一外部事实收敛回根级。
  useEffect(() => {
    if (projectsLoading) return;
    reconcileComposerProject(chatId, (projectId) =>
      projects.some((item) => item.id === projectId && !item.missing)
    );
  }, [chatId, projects, projectsLoading]);
  const editorScopeKey = workspaceScopeKey;
  const workspaceIdentityReady =
    !loading &&
    hydratedChatId === chatId &&
    !projectsLoading &&
    (!persisted || !chatsLoading) &&
    workspacePrecondition !== null;
  /* identity 与 composer 草稿同寿，而非与本 hook 同寿。Project 在卸载
     期间原地 rebind，重挂载的首个已知 identity 仍能与旧值比较；旧版
     entry 没有身份时只对 workspace-bound 节点 fail-closed，text/section 不动。 */
  useLayoutEffect(() => {
    if (!workspaceIdentityReady) return;
    if (!bindComposerWorkspaceIdentity(chatId, workspaceIdentityKey)) return;
    closeSidePanel();
    setPendingPlanDecision(null);
    setPlanMode(false);
  }, [
    chatId,
    closeSidePanel,
    setPendingPlanDecision,
    setPlanMode,
    workspaceIdentityKey,
    workspaceIdentityReady,
  ]);
  const updateRichValue = useCallback(
    (next: RichValue) => {
      updateComposer(chatId, (current) => ({
        ...current,
        draft: { ...current.draft, richValue: next },
      }));
      retainComposerResources(chatId);
      reconcileSidePanelRichValue(next);
    },
    [chatId, reconcileSidePanelRichValue]
  );
  const clearRichInput = useCallback(() => {
    updateComposer(chatId, (current) => ({
      ...current,
      draft: { ...current.draft, richValue: [] },
    }));
    retainComposerResources(chatId);
    closeSidePanelFile();
  }, [chatId, closeSidePanelFile]);
  const buildSubmissionInput = useCallback(() => {
    const submitGeneration = attachGenerationRef.current;
    const isViewCurrent = captureView();
    const lifecycle = createSessionSubmitLifecycle({
      isCurrent: () =>
        isViewCurrent() &&
        attachGenerationRef.current === submitGeneration,
      appendProjected,
      appendLocalAssistant,
      refs: {
        draft: draftRef,
        recordExists: recordExistsRef,
        request: requestRef,
      },
      set: {
        activeRequestId: setActiveRequestId,
        agentSession: setAgentSession,
        attachmentNotice: setAttachmentNotice,
        draft: setDraft,
        livePreviews: setLivePreviews,
        cancelPending: setCancelPending,
        persisted: setPersisted,
        queued: setQueued,
        queueNotice: setQueueNotice,
        status: setStatus,
      },
    });
    return {
      snapshot: {
        chatId,
        scope,
        project,
        selectedProjectId,
        selectedBackend,
        loading,
        status,
        planMode,
        agentSession,
        messages,
        workspaceScopeKey,
        workspacePrecondition,
      },
      services: {
        chats: { appendMessage, createAppChat, createChat, getChat },
        projects: { ensureForApp },
        settings,
        setup,
        isPlanCapabilityChecking,
        requirePlanCapability,
      },
      refs: {
        recordExists: recordExistsRef,
        incarnationId: incarnationIdRef,
        request: requestRef,
        sessionAbort: sessionAbortRef,
        workspaceScopeKey: workspaceScopeKeyRef,
      },
      lifecycle,
    };
  }, [
    agentSession,
    appendLocalAssistant,
    appendMessage,
    appendProjected,
    captureView,
    chatId,
    createAppChat,
    createChat,
    ensureForApp,
    getChat,
    setCancelPending,
    isPlanCapabilityChecking,
    loading,
    messages,
    planMode,
    project,
    requirePlanCapability,
    scope,
    selectedBackend,
    selectedProjectId,
    settings,
    setup,
    status,
    workspaceScopeKey,
    workspacePrecondition,
  ]);
  // ports 每次调用取当刻快照；缓存会发陈货。
  const submissionPorts = useSessionSubmissionPorts(buildSubmissionInput);
  const submitRevision = useSessionRevision(buildSubmissionInput);
  const handleSubmit = useCallback<SessionSubmit>(
    (message, options) =>
      createSessionSubmit(buildSubmissionInput())(message, options),
    [buildSubmissionInput]
  );
  useEffect(() => {
    submitRef.current = handleSubmit;
  }, [handleSubmit]);
  useEffect(
    () => {
      if (sessionAbortRef.current.signal.aborted) {
        sessionAbortRef.current = new AbortController();
      }
      const lifecycle = sessionAbortRef.current;
      return () => {
        lifecycle.abort();
        requestRef.current?.dispose();
        requestRef.current = null;
      };
    },
    []
  );
  const { canDrain, inputDisabled, turnControlsDisabled } = composerGates({
    loading,
    settingsLoading: settings.settingsLoading,
    settingsSaving: settings.settingsSaving,
    planCapabilityChecking,
    hydrationReady:
      hydrationReady(hydration) &&
      workspaceIdentityReady &&
      composerState.workspaceIdentityKey === workspaceIdentityKey,
    backendReady: backendState === "ready",
    turnRunning: status !== "ready",
    awaitingUser:
      Boolean(pendingUserInput) ||
      Boolean(pendingPlanDecision) ||
      approvals.length > 0,
  });
  const queuePorts = useSessionQueuePorts(submissionPorts, setAttachmentNotice);
  const pendingQueue = useMessageQueue({
    chatId,
    canDrain,
    isTurnRunning:
      status !== "ready" && Boolean(projectionStatus.requestId),
    steeringSupported: projectionStatus.steeringSupported === true,
    requestId: projectionStatus.requestId,
    steerIntents,
    ports: queuePorts,
  });
  const canSteerQueueItem = pendingQueue.canSteer;
  const dismissQueueError = pendingQueue.dismissError;
  const editQueueItem = pendingQueue.edit;
  const moveQueueItem = pendingQueue.move;
  const pauseQueue = pendingQueue.pause;
  const queueError = pendingQueue.error;
  const queueItems = pendingQueue.items;
  const queuePaused = pendingQueue.paused;
  const removeAmbiguous = pendingQueue.removeAmbiguous;
  const removeQueueItem = pendingQueue.remove;
  const resendAmbiguous = pendingQueue.resendAmbiguous;
  const resumeQueue = pendingQueue.resume;
  const setQueueReorderLock = pendingQueue.setReorderLock;
  const steerQueueItem = pendingQueue.steer;
  const steerQueueSupported = pendingQueue.steerSupported;
  const sendDirectly =
    status === "ready" &&
    pendingQueue.items.length === 0 &&
    !pendingQueue.paused;
  const enqueuePending = pendingQueue.enqueue;
  const revisionUnavailableReason = resolveRevisionUnavailableReason({
    persisted,
    inputDisabled,
    status,
    queued: pendingQueue.items.length > 0 || pendingQueue.paused,
    adopted,
  });
  const canRevise =
    persisted &&
    !inputDisabled &&
    !revisionUnavailableReason;
  const handleQueueOrSubmit = useCallback<SessionSubmit>(
    (message, options) => {
      if (sendDirectly) return handleSubmit(message, options);
      enqueuePending(message);
      return Promise.resolve();
    },
    [enqueuePending, handleSubmit, sendDirectly]
  );
  const pausePending = pendingQueue.pause;
  const handleStop = useCallback(async () => {
    const result = await stopTurn();
    if (result === "stopped") pausePending();
    return result;
  }, [pausePending, stopTurn]);
  const canAbandonFatal = projectionStatus.persist === "fatal";
  const canAcknowledgeCleanup = projectionStatus.cleanup === "failed";
  const resumeFailure = useMemo(
    () =>
      projectionStatus.phase === "resume-failed" &&
      projectionStatus.requestId &&
      projectionStatus.retryToken
          ? {
            requestId: projectionStatus.requestId,
            retryToken: projectionStatus.retryToken,
            allowedActions: projectionStatus.allowedActions ?? {
              sameSession: false,
              freshSession: false,
              abandon: false,
            },
          }
        : null,
    [
      projectionStatus.phase,
      projectionStatus.requestId,
      projectionStatus.retryToken,
      projectionStatus.allowedActions,
    ]
  );
  const reportActionFailure = useCallback(
    (action: string, cause: unknown) =>
      appendLocalAssistant(
        translate(locale, "chat.runtime.actionFailed", {
          action,
          message: errorMessage(cause),
        }),
        true
      ),
    [appendLocalAssistant, locale]
  );
  const abandonFatal = useCallback(
    () =>
      canAbandonFatal
        ? abandonFatalTurn(chatId).catch((cause) =>
            reportActionFailure(translate(locale, "chat.runtime.abandonTurn"), cause)
          )
        : Promise.resolve(),
    [canAbandonFatal, chatId, locale, reportActionFailure]
  );
  const acknowledgeCleanup = useCallback(
    () =>
      canAcknowledgeCleanup
        ? acknowledgeCleanupFailure(chatId).catch((cause) =>
            reportActionFailure(translate(locale, "chat.runtime.acknowledgeCleanup"), cause)
          )
        : Promise.resolve(),
    [canAcknowledgeCleanup, chatId, locale, reportActionFailure]
  );
  const retryWithoutSession = useCallback(async () => {
    if (!resumeFailure?.allowedActions.freshSession) return;
    await retryAgentWithoutSession(
      resumeFailure.requestId,
      resumeFailure.retryToken
    );
  }, [resumeFailure]);
  const retrySameSession = useCallback(async () => {
    if (!resumeFailure?.allowedActions.sameSession) return;
    await retryAgentSameSession(
      resumeFailure.requestId,
      resumeFailure.retryToken
    );
  }, [resumeFailure]);
  const abandonResumeFailure = useCallback(() => {
    if (!resumeFailure?.allowedActions.abandon) return;
    cancelAgentRequest(resumeFailure.requestId);
  }, [resumeFailure]);
  const createProject = useCallback(async () => {
    const next = await addProject();
    if (next) setComposerProject(chatId, next.id);
  }, [addProject, chatId]);
  const lastMessage = messages[messages.length - 1];
  const canContinue =
    status === "ready" &&
    Boolean(agentSession) &&
    Boolean(lastMessage) &&
    isFailedAssistant(lastMessage) &&
    // 限流卡片自带「立即重试」，通用「继续」在此让位，避免两个按钮抢同一件事
    lastMessage.failureKind !== "usage-limit" &&
    !/安全锁定|进程组清理失败/.test(lastMessage.content);
  const sections = useMemo(
    () =>
      chats
        .filter((chat) => chat.id !== chatId)
        .map((chat) => ({
          chatId: chat.id,
          name: chat.title ?? translate(locale, "chat.runtime.unnamed"),
          agent: chat.agent,
          updatedAt: chat.updatedAt,
        })),
    [chatId, chats, locale]
  );
  const richDisplayText = useMemo(() => richValueDisplayText(richValue), [richValue]);
  const selectProject = useCallback(
    (projectId: string | null) => setComposerProject(chatId, projectId),
    [chatId]
  );
  const replaceAttachmentFiles = useCallback(
    (files: typeof attachmentFiles) => replaceDraftFiles(chatId, files),
    [chatId]
  );
  const transcriptController = useStableController({
      chatId, incarnationId: messageSnapshot?.incarnationId ?? null,
      loading,
      backendId: settings.turnOptions.backend,
      backendDisplayName: selectedBackend?.displayName ?? "Agent",
      messages,
      draft,
      assistantSeq: projectionStatus.assistantSeq,
      livePreviews,
      hasPendingApproval: approvals.length > 0,
      queued,
      canContinue,
      continueTurn,
      retryTurn,
      openPlanPanel,
      openDraftPlanPanel,
      subagents,
      openImage,
      openSubagent,
      canAbandonFatal,
      abandonFatal,
      canAcknowledgeCleanup,
      acknowledgeCleanup,
      canRevise,
      revisionUnavailableReason,
      submitRevision,
    });
  const sidePanelController = useStableController({
      state: sidePanelState,
      context: panelContext,
      subagents,
      openTabs,
      openSubagent,
      close: closeSidePanel,
    });
  const composerController = useStableController({
      chatId, loading,
      persisted,
      project,
      projects,
      projectsLoading,
      selectedProjectId,
      selectProject,
      createProject,
      inputDisabled,
      turnControlsDisabled,
      status,
      cancelPending,
      attachmentNotice,
      setAttachmentNotice,
      queueNotice,
      setQueueNotice,
      approval: approvals[0],
      approvalBusy,
      approvalError,
      respondApproval,
      pendingUserInput,
      respondUserInput,
      hasPendingUserInput: Boolean(pendingUserInput),
      pendingPlanDecision,
      respondPlanDecision,
      planMode,
      planSupported,
      planAvailable,
      setPlanMode,
      togglePlanMode,
      editorScopeKey,
      workspaceScope,
      workspaceScopeKey,
      richValue,
      attachmentFiles,
      replaceAttachmentFiles,
      setRichValue: updateRichValue,
      clearRichInput,
      authorizeRichFile,
      discardRichNode,
      openFilePanel,
      openWorkspaceFilePanel,
      fileNodeCount: richValue.filter((node) => node.type === "file").length,
      skills,
      skillsLoading,
      skillsError,
      skillsHiddenCount,
      invalidatedSkillRefs,
      workspaceFiles: workspaceFileSearch.state,
      setWorkspaceFileQuery: workspaceFileSearch.setQuery,
      sections,
      sectionsLoading: chatsLoading,
      richDisplayText,
      handleSubmit: handleQueueOrSubmit,
      handleQueueOrSubmit,
      handleStop,
      queueItems,
      queuePaused,
      queueError,
      steerQueueSupported,
      canSteerQueueItem,
      removeQueueItem,
      moveQueueItem,
      editQueueItem,
      steerQueueItem,
      resumeQueue,
      pauseQueue,
      dismissQueueError,
      resendAmbiguous,
      removeAmbiguous,
      setQueueReorderLock,
      listBranches,
      checkoutBranch,
      createBranch,
      ...settings,
      serviceTierEffective: projectionStatus.serviceTierEffective,
      selectedBackend,
      backendState,
      imageInputAvailable:
        selectedBackend?.capabilities.imageInput ?? false,
      openSetup: setup.openOnboarding,
      resumeFailure,
      retryWithoutSession,
      retrySameSession,
      abandonResumeFailure,
    });
  return useStableController({
    transcript: transcriptController,
    sidePanel: sidePanelController,
    composer: composerController,
  });
}

export type ChatSessionController = ReturnType<typeof useChatSession>;
