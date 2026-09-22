/**
 * [INPUT]: Depends on React/router, runtime controller, Agent submission custody, cloud account predicates, idle chunk prefetch, queue capacity, Chat i18n, workspace hooks, Gallery/Sketch custody, the Agent connection warm-up client, startup marks, PromptInputProvider and RichInput.
 * [OUTPUT]: Presents Agent selection, explicit local reference reselection, native rich submission, Sketch, lazy recovery UI and queue feedback without discarding drafts; an account-owned draft adapter loads only for an account that can execute remotely, and never disables typing while it loads
 * [POS]: Chat command surface; candidate projection is read-only while drafts, attachments, and Gallery custody remain in the per-Chat store
 */
import { ComposerDock, ComposerContext, ComposerInput as PromptInput, ComposerToolbar as PromptInputFooter, ComposerActions } from "@ai-chat/chat-ui/composer";
import type { useDraftExecution } from "../remote/draft/execution";
import { useSettingsNavigation } from "@/components/providers/navigation/context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai-chat/ui/components/ui/tooltip";
import { useSetup } from "@/components/providers/setup-provider";
import { projectAvailability } from "../../../../shared/agent-availability/projection";


import { PendingAgentStatus } from "../agent-switch/pending";
import { applyComposerAttachmentCommand, readComposerInput } from "@/lib/chat-composer-store";
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { PromptInputBody, PromptInputProvider, PromptInputSubmit, PromptInputTools, usePromptInputAttachments, type PromptInputAdapter, type RichNode } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { PromptInputAttachments } from "@ai-chat/ui/components/ai-elements/prompt-input-attachments";
import { Separator } from "@ai-chat/ui/components/ui/separator";
import { Button } from "@ai-chat/ui/components/ui/button";
import { RichInput, type RichInputHandle, type RichInputProps } from "@ai-chat/ui/components/ai-elements/rich-input";
import { GitBranch, ImagesIcon, Settings, XIcon } from "lucide-react";
import { ComposerAddMenu as SharedComposerAddMenu } from "@ai-chat/chat-ui/composer-controls/add";
import { ATTACHMENT_BYTE_LIMIT, ATTACHMENT_LIMIT, SECTION_ATTACHMENT_COUNT_LIMIT, SECTION_ATTACHMENT_TOTAL_BYTE_LIMIT } from "../../../../shared/agent-ipc";
import type { ChatSessionController } from "../runtime/use-chat-session";
import { ChatApprovalCard } from "./chat-approval-card";
import { ChatAgentSelector } from "./chat-agent-selector";
import { ChatBranchSelector } from "./chat-branch-selector";
import { ChatModelListSelector } from "./chat-model-list-selector";
import { ChatModelSelector } from "./chat-model-selector";
import { ChatManagedWorktreeRow } from "./chat-managed-worktree-row";
import { ChatPlanChip } from "./chat-plan-chip";
import { ChatPlanDecision } from "./chat-plan-decision";
import { ChatPermissionSelector } from "./chat-permission-selector";
import { ChatProjectSelector, composerContextButtonClass } from "./chat-project-selector";
import { ChatUserInputSelector } from "./chat-user-input-selector";
import { FileAuthorizationQueue } from "./file-authorization-queue";
const MessageQueuePanel = lazy(() => import("./queue/message-queue-panel").then(module => ({ default: module.MessageQueuePanel })));
import {
  AgentBackendIcon,
  isAgentBackendId,
} from "@/lib/agent-backends";
import { useComposerWarmup } from "@/lib/agent-connections-client";
import {
  applyGalleryAttachmentCommand,
  clearGalleryComments,
  gallerySendGate,
  syncGalleryEnvironment,
  useGalleryState,
} from "@/lib/gallery/store";
import {
  focusGallery,
  registerComposerFocus,
} from "@/lib/gallery/focus-controller";
import { useSketchComposer } from "../sketch/host/use-sketch-composer";
import { isReportedFailure } from "@ai-chat/ui/lib/errors";
import { markStartup } from "@/lib/startup-marks";
import { QUEUE_LIMIT } from "@/lib/message-queue-model";
import { projectSettingsRoute } from "@/lib/draft-route";
import { useComposerSuggestions } from "./workspace/use-composer-suggestions";
import { useWorkspaceImageSelection } from "./workspace/use-workspace-image-selection";
const InteractionResults = lazy(() => import("@ai-chat/chat-ui/interaction-results").then(module => ({ default: module.InteractionResults })));
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useCloudAccount } from "@/lib/cloud/client";
import { cloudRemoteAllowed } from "@/lib/cloud/chat/access";
import { prefetchWhenIdle } from "@/lib/idle-prefetch";
import "./chat-composer-inline.css";
const ResumeFailureDialog = lazy(() => import("./resume-failure-dialog").then(module => ({ default: module.ResumeFailureDialog })));
function ChatAddMenu({
  controller,
  editor,
  disabled,
  turnControlsDisabled,
  sketch,
}: {
  controller: ChatSessionController["composer"];
  editor: React.RefObject<RichInputHandle | null>;
  disabled: boolean;
  turnControlsDisabled: boolean;
  sketch: ReturnType<typeof useSketchComposer>;
}) {
  const { t, i18n } = useAppTranslation();
  const attachments = usePromptInputAttachments();
  return <SharedComposerAddMenu locale={i18n.language} disabled={disabled}
    files={controller.imageInputAvailable ? { run: () => { editor.current?.saveSelection(); attachments.openFileDialog(); } } : undefined}
    sketch={controller.imageInputAvailable ? { disabled: sketch.newDisabled, reason: sketch.disabledReason, run: anchor => sketch.open(anchor) } : undefined}
    preload={controller.imageInputAvailable && !sketch.newDisabled ? sketch.preload : undefined}
    plan={{ active: controller.planMode, disabled: turnControlsDisabled || controller.skillsLoading || !controller.planSupported,
      reason: !controller.planSupported ? t("chat.composer.planUnavailable") : !controller.planMode && !controller.planAvailable ? controller.skillsError || t("chat.composer.planCheck") : undefined,
      run: () => { void controller.togglePlanMode(); } }} />;
}

type DraftExecution = Omit<ReturnType<typeof useDraftExecution>, "confirmLocalReference"> & Partial<Pick<ReturnType<typeof useDraftExecution>, "confirmLocalReference">>;
/* A named loader, not an inline import: `prefetchWhenIdle` keys its once-guard on loader identity. */
const loadDraftExecutionChunk = () => import("../remote/draft/execution");
const DraftExecutionAdapter = lazy(loadDraftExecutionChunk);
/* The local half of the composer while the account-owned adapter is still in flight: typing is never
   taken away — only Send waits, until the chunk names the computer this draft would run on. */
const LOCAL_EXECUTION = { remote: false, controls: null, dialogs: null, ownerLabel: null, referenceProps: undefined } as const;

function ChatComposerContent({
  execution,
  focusOnReady = false,
  enableSidePanel = true,
  collapseWhenIdle = false,
  managedWorktree = false,
}: {
  execution: DraftExecution;
  focusOnReady?: boolean;
  enableSidePanel?: boolean;
  collapseWhenIdle?: boolean;
  managedWorktree?: boolean;
}) {
  const controller = execution.controller;
  const { t, i18n } = useAppTranslation();
  const inputRef = useRef<RichInputHandle>(null);
  const attachments = usePromptInputAttachments();
  const setup = useSetup();
  const settingsNavigation = useSettingsNavigation();
  const recent = setup.recentTurns?.get(controller.chatId);
  const availability = projectAvailability(controller.selectedBackend, setup.now, {
    conversationId: controller.chatId, recent,
    target: recent ? { ...recent.target, providerId: undefined, configKey: undefined, backend: controller.turnOptions.backend,
      environmentGeneration: controller.selectedBackend?.availability?.environmentGeneration ?? -1,
      model: controller.turnOptions.model ?? undefined } : undefined,
  });
  const imagesBlocked = controller.selectedBackend?.availability?.capabilityKnowledge !== "unknown" &&
    !controller.imageInputAvailable && controller.attachmentFiles.some((file) => file.mediaType?.startsWith("image/"));
  const sendBlocked = (execution.canSend === undefined ? availability.policy.decision !== "allow" : !execution.canSend) || imagesBlocked;
  const recoveryBlocked = Boolean(controller.resumeFailure);
  const showAvailabilityNotice = execution.canSend === undefined && (imagesBlocked || (availability.state !== "missing" &&
    (sendBlocked || (recent?.outcome !== "success" && availability.state !== "ready" && availability.state !== "unverified"))));
  const focusedRef = useRef(false);
  const [branchBusy, setBranchBusy] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [authorizationPending, setAuthorizationPending] = useState(0);
  const [submissionPending, setSubmissionPending] = useState(false);
  const [workspaceSelectionPending, setWorkspaceSelectionPending] =
    useState(false);
  const hasSectionReference = controller.richValue.some(
    (node) => node.type === "section"
  );
  const authorizationQueueRef = useRef<
    FileAuthorizationQueue<
      File,
      Extract<RichNode, { type: "file" }>
    > | null
  >(null);
  const editorActive =
    !controller.pendingUserInput && !controller.pendingPlanDecision;
  const editingDisabled =
    controller.inputDisabled || Boolean(controller.pendingAgent?.submitting || controller.pendingAgent?.stale) ||
    branchBusy ||
    authorizationPending > 0 ||
    workspaceSelectionPending;
  const turnControlsDisabled =
    controller.turnControlsDisabled ||
    Boolean(controller.pendingAgent?.submitting) ||
    branchBusy ||
    authorizationPending > 0 ||
    workspaceSelectionPending ||
    submissionPending;
  const sketch = useSketchComposer(controller, inputRef, editingDisabled);
  const isGenerating =
    controller.status === "submitted" || controller.status === "streaming";
  // Availability gates keep Stop reachable; queue capacity separately disables Send.
  const hasDraftContent =
    Boolean(controller.richDisplayText.trim()) ||
    controller.attachmentFiles.length > 0 ||
    controller.fileNodeCount > 0;
  const draftReady =
    hasDraftContent &&
    !editingDisabled && !sendBlocked && !recoveryBlocked &&
    !gallerySendGate(controller.chatId);
  const stopping = isGenerating && !draftReady;
  const queueFull = controller.queueItems.length >= QUEUE_LIMIT;
  const showQueueLimit = queueFull && !stopping;
  const actionDisabled =
    controller.cancelPending ||
    (!stopping &&
      (editingDisabled || sendBlocked || recoveryBlocked || queueFull || gallerySendGate(controller.chatId)));
  const {
    authorizeRichFile,
    discardRichNode,
    setAttachmentNotice,
    setWorkspaceFileQuery,
  } = controller;
  const gallery = useGalleryState(controller.chatId);
  const galleryCommentCount = [...gallery.comments.values()].reduce(
    (count, comments) => count + comments.length,
    0
  );
  /* 闲置 = 编辑区里没有任何要展示的东西。有一个字符就回到两行——单行只承诺
     "空着的时候不占两行"，不承诺把内容挤进一行。判定不看焦点：光标落进空框
     仍是空框，跟着焦点抖动反而比常驻两行更烦人。与主按钮归属共用同一个
     `hasDraftContent`：两处若各自展开三个字段，迟早在某次加字段时分叉。 */
  const inlineLayout =
    collapseWhenIdle && !hasDraftContent && !controller.planMode;

  /* 抢焦点的时机是「编辑区第一次真正可用」，不是「组件挂载完成」。卡片顶替编辑区
     期间 inputRef 为空，只判 editingDisabled 会让 effect 空转一次便再无人唤醒——
     editorActive 必须同时进卫语句与依赖。后端不可用是第四条顶替分支，但它蕴含
     backendState !== "ready" 即 editingDisabled，已被前一个条件盖住。 */
  /* 聚焦即预热：用户已经在准备说话，没必要再等视图那边的 800 ms 停留。
     后端未解析（目录还没到）时不发——那时连哪一家都还说不准。 */
  const warmConnection = useComposerWarmup(
    controller.selectedBackend
      ? { conversationId: controller.chatId, backend: controller.turnOptions.backend }
      : null
  );
  useEffect(() => {
    if (!focusOnReady || editingDisabled || !editorActive) return;
    if (focusedRef.current || !inputRef.current) return;
    inputRef.current.focus();
    focusedRef.current = true;
    warmConnection();
  }, [editingDisabled, editorActive, focusOnReady, warmConnection]);
  useEffect(
    () =>
      registerComposerFocus(controller.chatId, () => {
        inputRef.current?.focus();
        warmConnection();
      }),
    [controller.chatId, warmConnection]
  );
  /* "Able to type" is the milestone startup is actually measured against. */
  useEffect(() => markStartup("composer-mounted"), []);
  useEffect(() => {
    syncGalleryEnvironment(
      controller.chatId,
      controller.turnOptions.backend,
      controller.imageInputAvailable
    );
  }, [
    controller.chatId,
    controller.imageInputAvailable,
    controller.turnOptions.backend,
  ]);
  useLayoutEffect(() => {
    const dependencies = {
      authorize: authorizeRichFile,
      discard: (node: Extract<RichNode, { type: "file" }>) =>
        discardRichNode(node),
      insert: (node: Extract<RichNode, { type: "file" }>) => {
        const editor = inputRef.current;
        if (!editor) return false;
        editor.insertNode(node);
        return true;
      },
      onPendingChange: setAuthorizationPending,
      reportError: (cause: unknown, file: File) =>
        setAttachmentNotice(
          cause instanceof Error
            ? cause.message
            : t("chat.composer.surface.authorizeFileFailed", {
                file: file.name,
              })
        ),
    };
    if (authorizationQueueRef.current) {
      authorizationQueueRef.current.setDependencies(dependencies);
    } else {
      authorizationQueueRef.current = new FileAuthorizationQueue(dependencies);
    }
  }, [authorizeRichFile, discardRichNode, setAttachmentNotice, t]);

  useLayoutEffect(() => {
    const authorizationQueue = authorizationQueueRef.current;
    if (!authorizationQueue) return;
    authorizationQueue.setContext(
      editorActive ? controller.editorScopeKey : undefined
    );
    return () => authorizationQueue.clearContext();
  }, [controller.editorScopeKey, editorActive]);

  const inputAdapter = useMemo<PromptInputAdapter>(
    () => ({
      snapshot: () => readComposerInput(controller.chatId),
      clear: controller.clearRichInput,
    }),
    [
      controller.clearRichInput,
      controller.chatId,
    ]
  );
  const { suggestionCopy, suggestions } = useComposerSuggestions(
    controller,
    mentionQuery
  );
  const handleQueryChange = useCallback<
    NonNullable<RichInputProps["onQueryChange"]>
  >((query) => {
    const next = query?.kind === "mention" ? query.value : null;
    setMentionQuery(next);
    setWorkspaceFileQuery(next);
  }, [setWorkspaceFileQuery]);

  const handleAcceptedFiles = (files: File[]) => {
    const nonImages = files.filter((file) => !file.type.startsWith("image/"));
    if (nonImages.length === 0) return;
    inputRef.current?.saveSelection();
    void authorizationQueueRef.current?.accept(nonImages);
  };
  const consumeWorkspaceImage = useWorkspaceImageSelection({
    attachments,
    controller,
  });
  const modelCapability = execution.controls ? "none" : controller.selectedBackend?.capabilities.modelOptions ?? "none";
  /* `backend === "codex"` 已把联合收窄到 CodexTurnOptions，而 reasoningEffort /
     serviceTier 是它的必填字段——再补两个 `in` 检查是同一判定写第二遍。 */
  const fullModelOptions =
    modelCapability === "full" && controller.turnOptions.backend === "codex"
      ? controller.turnOptions
      : null;

  return (
    <ComposerDock>
      {Boolean(controller.interactionResults?.length) && <Suspense fallback={null}><InteractionResults results={controller.interactionResults} locale={i18n.language} /></Suspense>}
      {controller.resumeFailure && <Suspense fallback={
        <div className="mb-3 rounded-xl border bg-muted/30 px-3 py-2 text-xs" role="status">
          <p className="font-medium">{t("chat.resumeFailure.pendingTitle")}</p>
          <p className="mt-1 text-muted-foreground">{t("chat.resumeFailure.pendingDetail")}</p>
        </div>
      }><ResumeFailureDialog controller={controller} /></Suspense>}
      {/* plan-review 是完整的决策时刻，占据输入框槽位（见下方三元链）；
          只有普通命令/文件/权限审批才叠在输入框上方——它们放行后 turn
          立即继续，输入框留着正是为了排队下一句 */}
      {controller.approval && controller.approval.purpose !== "plan-review" && (
        <ChatApprovalCard
          approval={controller.approval}
          backendDisplayName={
            controller.selectedBackend?.displayName ?? "Agent"
          }
          busy={controller.approvalBusy}
          error={controller.approvalError}
          onDecision={(decision) => void controller.respondApproval(decision)}
        />
      )}
      {controller.attachmentNotice && (
        <div className="mb-2 flex items-start gap-2 text-destructive text-xs">
          <p className="min-w-0 flex-1">{controller.attachmentNotice}</p>
          <button
            aria-label={t("chat.composer.dismissNotice")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => controller.setAttachmentNotice("")}
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      {controller.queueNotice && (
        <div className="mb-2 flex items-start gap-2 text-muted-foreground text-xs">
          <p className="min-w-0 flex-1">{controller.queueNotice}</p>
          <button
            aria-label={t("chat.composer.dismissQueueNotice")}
            className="shrink-0 hover:text-foreground"
            onClick={() => controller.setQueueNotice("")}
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      {(controller.queueItems.length > 0 || controller.queueError || controller.queuePaused) && <Suspense fallback={null}><MessageQueuePanel
        canSteer={controller.canSteerQueueItem}
        steerSupported={controller.steerQueueSupported}
        items={controller.queueItems}
        paused={controller.queuePaused}
        queueError={controller.queueError}
        onDismissError={controller.dismissQueueError}
        onEdit={(id) => {
          if (controller.editQueueItem(id)) inputRef.current?.focus();
        }}
        onMove={controller.moveQueueItem}
        onRemove={controller.removeQueueItem}
        onRemoveAmbiguous={controller.removeAmbiguous}
        onReorderLock={controller.setQueueReorderLock}
        onResendAmbiguous={controller.resendAmbiguous}
        onResume={controller.resumeQueue}
        onSteer={controller.steerQueueItem}
      /></Suspense>}
      {(galleryCommentCount > 0 || gallery.selections.size > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {galleryCommentCount > 0 && (
            <span className="inline-flex min-h-11 items-center rounded-full border bg-background pl-3 text-xs">
              ⊕ {t("chat.composer.galleryComments", { count: galleryCommentCount })}
              <button
                aria-label={t("chat.composer.clearGalleryComments")}
                className="grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => clearGalleryComments(controller.chatId)}
                type="button"
              >
                <XIcon className="size-3.5" />
              </button>
            </span>
          )}
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-background px-3 text-xs"
            onClick={() => focusGallery(controller.chatId)}
            type="button"
          >
            <ImagesIcon className="size-3.5" />
            {t("chat.composer.focusGallery")}
          </button>
        </div>
      )}
      {!controller.loading &&
        !controller.persisted &&
        controller.project.kind === "selectable" && (
          <ComposerContext>
            <ChatProjectSelector
              projects={controller.projects}
              selectedProjectId={controller.selectedProjectId}
              disabled={controller.projectsLoading || turnControlsDisabled}
              onChange={controller.selectProject}
              onNewProject={controller.createProject}
            />
            {controller.selectedProjectId && (
              <>
                {execution.remote ? (
                  /* The branch lives on the owner, so the control keeps its place, names that computer
                     and stays inert. Showing this machine's HEAD instead would be a confident wrong answer. */
                  <Button
                    className={`${composerContextButtonClass} max-w-56 gap-2`}
                    disabled
                    size="lg"
                    type="button"
                    variant="ghost"
                  >
                    <GitBranch className="size-4" />
                    <span className="truncate">{execution.ownerLabel}</span>
                  </Button>
                ) : (
                <ChatBranchSelector
                  key={controller.selectedProjectId}
                  projectId={controller.selectedProjectId}
                  disabled={turnControlsDisabled}
                  listBranches={controller.listBranches}
                  checkoutBranch={controller.checkoutBranch}
                  createBranch={controller.createBranch}
                  onBusyChange={setBranchBusy}
                />
                )}
                <Button
                  aria-label={t("projectSettings.open")}
                  asChild
                  className="relative ml-auto rounded-full touch-target-44 hover:bg-muted-foreground/10"
                  size="icon-lg"
                  variant="ghost"
                >
                  <Link to={projectSettingsRoute(controller.selectedProjectId)}>
                    <Settings />
                  </Link>
                </Button>
              </>
            )}
          </ComposerContext>
        )}
      {!controller.loading && managedWorktree && (
        <ChatManagedWorktreeRow controller={controller} />
      )}
      <PendingAgentStatus pending={controller.pendingAgent} undo={controller.undoAgentSwitch} />
      {controller.approval?.purpose === "plan-review" ? (
        <ChatApprovalCard
          approval={controller.approval}
          backendDisplayName={
            controller.selectedBackend?.displayName ?? "Agent"
          }
          busy={controller.approvalBusy}
          error={controller.approvalError}
          onDecision={(decision) => void controller.respondApproval(decision)}
        />
      ) : controller.pendingUserInput ? (
        <ChatUserInputSelector
          pending={controller.pendingUserInput}
          onAnswer={(answers) => void controller.respondUserInput(answers)}
        />
      ) : controller.pendingPlanDecision ? (
        <ChatPlanDecision
          pending={controller.pendingPlanDecision}
          onDecision={(decision) =>
            void controller.respondPlanDecision(decision)
          }
        />
      ) : (
      <PromptInput

        data-composer-layout={inlineLayout ? "inline" : undefined}
        accept={window.app ? undefined : "image/*"}
        attachmentFileFilter={(file) => file.type.startsWith("image/")}
        attachmentsDisabled={editingDisabled || !controller.imageInputAvailable}
        clearIfUnchanged
        externalFileCount={controller.fileNodeCount}
        inputAdapter={inputAdapter}
        maxFileSize={ATTACHMENT_BYTE_LIMIT}
        maxFiles={ATTACHMENT_LIMIT}
        multiple
        onFilesAccepted={handleAcceptedFiles}
        /* 提交事务已把病因写进 transcript 的失败不在输入框上重播；这里只
           留给没人认领的准入失败——附件超限、branch 忙、Gallery 冻结失败。 */
        onError={(error) => {
          if (isReportedFailure(error.cause)) return;
          controller.setAttachmentNotice(error.message);
        }}
        onSubmissionPendingChange={(pending) => {
          setSubmissionPending(pending);
        }}
        preserveSubmissionOnUnmount
        prepareSubmission={sketch.prepare}
        onSubmissionSettled={sketch.settled}
        onSubmit={(message, _event, { signal }) => {
          if (recoveryBlocked) throw new Error(t("chat.resumeFailure.pendingDetail"));
          if (branchBusy) {
            throw new Error(t("chat.composer.surface.branchBusy"));
          }
          if (authorizationQueueRef.current?.isBusy()) {
            throw new Error(t("chat.composer.surface.fileAuthorizationBusy"));
          }
          const authenticationRetry = (_event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "authentication-retry";
          if (sendBlocked && !(authenticationRetry && availability.policy.reason === "auth-required")) throw new Error(t("agentAvailability.blocked", { backend: controller.selectedBackend?.displayName ?? "Agent" }));
          return controller.handleSubmit(message, { signal, ...(authenticationRetry ? { authenticationRetry: { kind: "retry-authentication" as const } } : {}) });
        }}
      >
        <button
          aria-hidden="true"
          className="pointer-events-none absolute size-px overflow-hidden opacity-0"
          disabled={
            // Enter 提交与可见按钮同一 gate：漏掉 gallerySendGate 会把 pending/failed 选图静默丢下发送
            editingDisabled || sendBlocked || recoveryBlocked || queueFull ||
            controller.cancelPending ||
            gallerySendGate(controller.chatId)
          }
          tabIndex={-1}
          type="submit"
        />
        {showAvailabilityNotice && <div className="flex flex-wrap items-center gap-2 px-3 pt-3 text-xs text-muted-foreground">
          <span>{imagesBlocked ? t("agentAvailability.imagesPreserved") : t(`agentAvailability.state.${availability.state}`)}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void controller.openSetup()}>{t("agentAvailability.manage")}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void setup.recheckBackend(controller.turnOptions.backend)}>{t("chat.checkAgain")}</Button>
          {availability.policy.reason === "auth-required" && <Tooltip><TooltipTrigger asChild>
            <Button type={hasDraftContent ? "submit" : "button"} name="authentication-retry" onClick={() => { if (!hasDraftContent) controller.retryAuthentication(); }} variant="outline" size="sm" disabled={editingDisabled || recoveryBlocked || submissionPending || isGenerating || queueFull || (!hasDraftContent && (!recent || recent.outcome === "success")) || imagesBlocked || gallerySendGate(controller.chatId)}>{t("agentAvailability.retrySending")}</Button>
          </TooltipTrigger><TooltipContent className="max-w-72">{t("agentAvailability.retryExplanation")}</TooltipContent></Tooltip>}
        </div>}
        <PromptInputBody>
          <PromptInputAttachments attachmentAction={sketch.attachmentAction} />
          <RichInput
            ref={inputRef}
            disabled={editingDisabled}
            placeholder={t("ui.askAnything")}
            invalidSkillRefs={controller.invalidatedSkillRefs}
            invalidSkillTitle={t("chat.skillControl.invalidated")}
            fileClickTitle={
              enableSidePanel
                ? t("chat.composer.surface.previewMarkdown")
                : undefined
            }
            onChange={controller.setRichValue}
            onFileClick={
              enableSidePanel
                ? (node) => void controller.openFilePanel(node)
                : undefined
            }
            onWorkspaceFileClick={
              enableSidePanel
                ? (node) => void controller.openWorkspaceFilePanel(node)
                : undefined
            }
            workspaceFileClickTitle={
              enableSidePanel
                ? t("chat.composer.surface.previewWorkspaceFile")
                : undefined
            }
            onNodeDiscarded={controller.discardRichNode}
            onQueryChange={execution.referenceProps?.onQueryChange ?? handleQueryChange}
            onSuggestionPendingChange={setWorkspaceSelectionPending}
            onSuggestionSelect={execution.referenceProps?.onSuggestionSelect ?? (async suggestion => {
              const consumed = await consumeWorkspaceImage(suggestion);
              if (!consumed) execution.confirmLocalReference?.(suggestion);
              return consumed;
            })}
            suggestionCopy={execution.referenceProps?.suggestionCopy ?? suggestionCopy}
            suggestions={execution.referenceProps?.suggestions ?? suggestions}
            renderSectionIcon={(agent) =>
              isAgentBackendId(agent) ? (
                <AgentBackendIcon backend={agent} className="size-3.5" />
              ) : null
            }
            value={controller.richValue}
          />
          {hasSectionReference && (
            <p className="px-3 pb-1 text-muted-foreground text-[11px]">
              {controller.imageInputAvailable
                ? t("chat.sectionImagesDisclosure", {
                    count: SECTION_ATTACHMENT_COUNT_LIMIT,
                    megabytes: SECTION_ATTACHMENT_TOTAL_BYTE_LIMIT / 1024 / 1024,
                    backend: controller.selectedBackend?.displayName ?? "Agent",
                  })
                : t("chat.sectionImagesUnsupported", {
                    backend: controller.selectedBackend?.displayName ?? "Agent",
                  })}
            </p>
          )}
        </PromptInputBody>
        {/* 这一行的自适应只看自己有多宽，不看视口：第三栏拉宽时窗口没变、
            栏变窄，媒体查询会全程失效。 */}
        <PromptInputFooter className="@container/composer">
          <PromptInputTools>
            {/* 菜单里只有 Files 与 Plan：两者都不可得时不给入口。点开一个只剩
                灰字的加号，说的是「你可以」，而事实是不能——空菜单比没有菜单更贵。 */}
            {(controller.imageInputAvailable || controller.planSupported) && (
              <ChatAddMenu
                controller={controller}
                disabled={editingDisabled}
                editor={inputRef}
                turnControlsDisabled={turnControlsDisabled}
                sketch={sketch}
              />
            )}
            {execution.controls?.permission ?? <ChatPermissionSelector
              value={controller.turnOptions.permissionMode}
              backendDisplayName={
                controller.selectedBackend?.displayName ?? "Agent"
              }
              saving={controller.settingsSaving}
              disabled={turnControlsDisabled}
              onChange={(permissionMode) =>
                controller.updateTurnOptions({
                  ...controller.turnOptions,
                  permissionMode,
                })
              }
              allowedModes={controller.selectedBackend?.capabilities.permissionModes.filter(
                (mode) => !managedWorktree || mode !== "full-access"
              )}
            />}
            {managedWorktree && (
              <span className="hidden text-[11px] text-muted-foreground @lg/composer:inline">
                {t("chat.fork.worktreePermission")}
              </span>
            )}
            {controller.planMode && (
              <>
                <Separator
                  aria-hidden="true"
                  className="mx-1 h-4 data-vertical:self-center"
                  orientation="vertical"
                />
                <ChatPlanChip onClose={() => controller.setPlanMode(false)} />
              </>
            )}
          </PromptInputTools>
          <ComposerActions>
            {execution.controls?.agent ?? <ChatAgentSelector
              value={controller.turnOptions.backend}
              revertTo={controller.pendingAgent ? controller.canonicalAgent ?? undefined : undefined}
              backends={controller.backends}
              locked={controller.switchLocked || isGenerating || submissionPending || controller.queueItems.length > 0 || controller.queuePaused || Boolean(controller.pendingAgent?.submitting)}
              saving={controller.settingsSaving}
              reason={controller.switchReason ? t(`chat.agentSwitch.${controller.switchReason}`) : controller.queueItems.length || controller.queuePaused ? t("chat.agentSwitch.queue") : isGenerating ? t("chat.agentSwitch.running") : controller.pendingAgent?.submitting ? t("chat.agentSwitch.submission") : undefined}
              onChange={controller.selectBackend}
              onOpenUsage={settingsNavigation?.openUsage}
              onManage={() => void controller.openSetup()}
              customProvider={Boolean(recent?.target.providerId || recent?.target.configKey)}
              now={setup.now}
              currentState={availability.state}
              appBound={controller.project.kind === "fixed-app"}
              onRecheck={(backend) => void setup.recheckBackend(backend)}
              onRepair={(backend, action) => void setup.terminalAction(backend, action)}
              usageResetsAt={recent?.limit?.resetsAt}
            />}
            {execution.controls?.model}
            {fullModelOptions && (
              <ChatModelSelector
                value={fullModelOptions}
                effectiveServiceTier={controller.serviceTierEffective}
                models={controller.models.filter(
                  (model): model is typeof model & {
                    defaultReasoningEffort: string;
                    supportedReasoningEfforts: NonNullable<
                      typeof model.supportedReasoningEfforts
                    >;
                    serviceTiers: NonNullable<typeof model.serviceTiers>;
                  } =>
                    Boolean(
                      model.defaultReasoningEffort &&
                        model.supportedReasoningEfforts &&
                        model.serviceTiers
                    )
                )}
                modelsLoading={controller.modelsLoading}
                modelsError={controller.modelsError}
                modelsEmpty={controller.modelsEmpty}
                settingsError={controller.settingsError}
                saving={controller.settingsSaving}
                streaming={isGenerating}
                disabled={turnControlsDisabled}
                onChange={controller.updateTurnOptions}
                onRetryModels={controller.retryModels}
              />
            )}
            {modelCapability === "list-only" && (
              <ChatModelListSelector
                value={controller.turnOptions}
                effectiveServiceTier={controller.serviceTierEffective}
                models={controller.models}
                modelsLoading={controller.modelsLoading}
                modelsError={controller.modelsError}
                modelsEmpty={controller.modelsEmpty}
                settingsError={controller.settingsError}
                saving={controller.settingsSaving}
                streaming={isGenerating}
                disabled={turnControlsDisabled}
                onChange={controller.updateTurnOptions}
                onRetryModels={controller.retryModels}
              />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  tabIndex={showQueueLimit ? 0 : undefined}
                >
                  <PromptInputSubmit
                    className="shrink-0 rounded-full"
                    status={controller.status}
                    onStop={controller.handleStop}
                    preferSubmit={draftReady}
                    disabled={actionDisabled}
                    {...(recent && recent.outcome !== "success" && availability.policy.decision === "allow" && !isGenerating
                      ? { "aria-label": t("agentAvailability.retrySending"), title: showQueueLimit ? undefined : t("agentAvailability.retrySending") } : {})}
                    {...(isGenerating && draftReady
                      ? { "aria-label": t("chat.composer.surface.queueSubmit") }
                      : {})}
                  />
                </span>
              </TooltipTrigger>
              {showQueueLimit && (
                <TooltipContent side="top">
                  {t("chat.queue.limit", { count: QUEUE_LIMIT })}
                </TooltipContent>
              )}
            </Tooltip>
          </ComposerActions>
        </PromptInputFooter>
      </PromptInput>
      )}
      {execution.dialogs}
    </ComposerDock>
  );
}

export const ChatComposer = memo(function ChatComposer(props: {
  controller: ChatSessionController["composer"];
  focusOnReady?: boolean;
  enableSidePanel?: boolean;
  /** 全屏 Base dock：闲置时收成单行，避免空输入框占掉两行悬浮面积 */
  collapseWhenIdle?: boolean;
  managedWorktree?: boolean;
}) {
  const account = useCloudAccount();
  /* `window.cloudRemote` is injected into every main window, signed in or not — gating on it made the
     blank page wait for an account-owned chunk that could never do anything. Only an account that can
     really execute remotely loads it, and it is warmed at idle so no one ever meets the fallback. */
  const remoteDrafts = !props.controller.persisted && props.controller.project.kind !== "fixed-app" && cloudRemoteAllowed(account);
  useEffect(() => (remoteDrafts ? prefetchWhenIdle(loadDraftExecutionChunk) : undefined), [remoteDrafts]);
  return (
    <PromptInputProvider
      attachments={{
        files: props.controller.attachmentFiles,
        onChange: props.controller.replaceAttachmentFiles,
        onCommand: (command) => {
          applyGalleryAttachmentCommand(props.controller.chatId, command);
          applyComposerAttachmentCommand(props.controller.chatId, command);
        },
      }}
    >
      {remoteDrafts ?
        <Suspense fallback={<ChatComposerContent {...props} execution={{ ...LOCAL_EXECUTION, controller: props.controller, canSend: false }} />}>
          <DraftExecutionAdapter controller={props.controller}>{execution => <ChatComposerContent {...props} execution={execution} />}</DraftExecutionAdapter>
        </Suspense> : <ChatComposerContent {...props} execution={{ ...LOCAL_EXECUTION, controller: props.controller, canSend: undefined }} />}
    </PromptInputProvider>
  );
});
