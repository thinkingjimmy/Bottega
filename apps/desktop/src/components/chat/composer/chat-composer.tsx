/**
 * [INPUT]: Depends on React/router, runtime controller, Chat composer i18n, canonical Project Settings routing, workspace candidate/image transaction hooks, Gallery store/freeze/focus, PromptInputProvider and RichInput
 * [OUTPUT]: Provides localized ChatComposer with rich submission, capability-aware controls, exact-Project settings entry, Gallery/Section image gates, and the explicit safe Resume Failure decision surface
 * [POS]: Chat command surface; candidate projection is read-only while drafts, attachments, and Gallery custody remain in the per-Chat store
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputAdapter,
  type RichNode,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import { PromptInputAttachments } from "@ai-chat/ui/components/ai-elements/prompt-input-attachments";
import { Separator } from "@ai-chat/ui/components/ui/separator";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  RichInput,
  type RichInputHandle,
  type RichInputProps,
} from "@ai-chat/ui/components/ai-elements/rich-input";
import {
  FileUpIcon,
  ImagesIcon,
  LightbulbIcon,
  PlusIcon,
  Settings,
  XIcon,
} from "lucide-react";
import {
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
  SECTION_ATTACHMENT_COUNT_LIMIT,
  SECTION_ATTACHMENT_TOTAL_BYTE_LIMIT,
} from "../../../../shared/agent-ipc";
import type { ChatSessionController } from "../runtime/use-chat-session";
import { ChatApprovalCard } from "./chat-approval-card";
import { ChatAgentSelector } from "./chat-agent-selector";
import { ChatBackendUnavailable } from "./chat-backend-unavailable";
import { ChatBranchSelector } from "./chat-branch-selector";
import { ChatModelListSelector } from "./chat-model-list-selector";
import { ChatModelSelector } from "./chat-model-selector";
import { ChatPlanChip } from "./chat-plan-chip";
import { ChatPlanDecision } from "./chat-plan-decision";
import { ChatPermissionSelector } from "./chat-permission-selector";
import { ChatProjectSelector } from "./chat-project-selector";
import { ChatUserInputSelector } from "./chat-user-input-selector";
import { ResumeFailureDialog } from "./resume-failure-dialog";
import { FileAuthorizationQueue } from "./file-authorization-queue";
import { MessageQueuePanel } from "./queue/message-queue-panel";
import {
  AgentBackendIcon,
  isAgentBackendId,
} from "@/lib/agent-backends";
import {
  applyGalleryAttachmentCommand,
  clearGalleryComments,
  gallerySendGate,
  resumeGalleryAfterCapability,
  suspendGalleryForCapability,
  syncGalleryEnvironment,
  useGalleryState,
} from "@/lib/gallery/store";
import {
  focusGallery,
  registerComposerFocus,
} from "@/lib/gallery/focus-controller";
import { freezeGalleryDraft } from "@/lib/gallery/submission";
import { isReportedFailure } from "@/lib/errors";
import { projectSettingsRoute } from "@/lib/draft-route";
import { useComposerSuggestions } from "./workspace/use-composer-suggestions";
import { useWorkspaceImageSelection } from "./workspace/use-workspace-image-selection";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import "./chat-composer-inline.css";
function ChatAddMenu({
  controller,
  editor,
  disabled,
  turnControlsDisabled,
}: {
  controller: ChatSessionController["composer"];
  editor: React.RefObject<RichInputHandle | null>;
  disabled: boolean;
  turnControlsDisabled: boolean;
}) {
  const { t } = useAppTranslation();
  const attachments = usePromptInputAttachments();
  const planUnavailable =
    !controller.planSupported ||
    (!controller.planMode && !controller.planAvailable);
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger
        aria-label={t("chat.composer.add")}
        className="rounded-full"
        disabled={disabled}
      >
        <PlusIcon className="size-4" />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent side="top">
        {controller.imageInputAvailable && (
          <PromptInputActionMenuItem
            onSelect={() => {
              editor.current?.saveSelection();
              attachments.openFileDialog();
            }}
          >
            <FileUpIcon className="size-4" />
            {t("chat.composer.files")}
          </PromptInputActionMenuItem>
        )}
        <PromptInputActionMenuItem
          disabled={
            turnControlsDisabled ||
            controller.skillsLoading ||
            !controller.planSupported
          }
          onSelect={() => void controller.togglePlanMode()}
          title={
            planUnavailable
              ? !controller.planSupported
                ? t("chat.composer.planUnavailable")
                : controller.skillsError || t("chat.composer.planCheck")
              : undefined
          }
        >
          <LightbulbIcon className="size-4" />
          {controller.planMode
            ? t("chat.composer.disablePlan")
            : t("chat.composer.surface.plan")}
        </PromptInputActionMenuItem>
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

function ChatComposerContent({
  controller,
  focusOnReady = false,
  enableSidePanel = true,
  collapseWhenIdle = false,
}: {
  controller: ChatSessionController["composer"];
  focusOnReady?: boolean;
  enableSidePanel?: boolean;
  collapseWhenIdle?: boolean;
}) {
  const { t } = useAppTranslation();
  const inputRef = useRef<RichInputHandle>(null);
  const attachments = usePromptInputAttachments();
  const priorImageCapability = useRef(controller.imageInputAvailable);
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
    controller.inputDisabled ||
    branchBusy ||
    authorizationPending > 0 ||
    workspaceSelectionPending;
  const turnControlsDisabled =
    controller.turnControlsDisabled ||
    branchBusy ||
    authorizationPending > 0 ||
    workspaceSelectionPending ||
    submissionPending;
  const isGenerating =
    controller.status === "submitted" || controller.status === "streaming";
  /* ============================================================
   * 主按钮归属：有待发内容就归提交，否则生成中归停止。
   *
   * 判据里带上「发得出去」不是谨慎，是唯一能让死锁消失的写法：若只看
   * 「有没有内容」，那么内容在手而提交被门禁挡住的那一刻，按钮既是提交
   * 形态又是 disabled——用户既发不出去也停不下来。把可行性并进归属判定，
   * 发不出去时按钮自动退回停止形态，那个卡死的组合根本无法构造。
   * ============================================================ */
  const hasDraftContent =
    Boolean(controller.richDisplayText.trim()) ||
    controller.attachmentFiles.length > 0 ||
    controller.fileNodeCount > 0;
  const draftReady =
    hasDraftContent &&
    !editingDisabled &&
    !gallerySendGate(controller.chatId);
  const stopping = isGenerating && !draftReady;
  const actionDisabled =
    controller.cancelPending ||
    (!stopping &&
      (editingDisabled || gallerySendGate(controller.chatId)));
  const unavailableBackend =
    controller.persisted &&
    controller.lockedBackend &&
    controller.backendState === "unavailable"
      ? controller.lockedBackend
      : null;
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
  useEffect(() => {
    if (!focusOnReady || editingDisabled || !editorActive) return;
    if (focusedRef.current || !inputRef.current) return;
    inputRef.current.focus();
    focusedRef.current = true;
  }, [editingDisabled, editorActive, focusOnReady]);
  useEffect(
    () =>
      registerComposerFocus(controller.chatId, () => inputRef.current?.focus()),
    [controller.chatId]
  );
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
  useEffect(() => {
    const previous = priorImageCapability.current;
    priorImageCapability.current = controller.imageInputAvailable;
    if (!controller.imageInputAvailable) {
      suspendGalleryForCapability(controller.chatId);
      const images = controller.attachmentFiles.filter((file) =>
        file.mediaType?.startsWith("image/")
      );
      if (images.length) {
        controller.replaceAttachmentFiles(
          controller.attachmentFiles.filter(
            (file) => !file.mediaType?.startsWith("image/")
          )
        );
      }
      if (images.length || gallery.selections.size) {
        controller.setAttachmentNotice(
          t("chat.composer.surface.imageUnsupported")
        );
      }
      return;
    }
    if (!previous && controller.imageInputAvailable) {
      void resumeGalleryAfterCapability(controller.chatId);
    }
  }, [
    controller,
    controller.attachmentFiles,
    controller.chatId,
    controller.imageInputAvailable,
    controller.replaceAttachmentFiles,
    controller.setAttachmentNotice,
    gallery.selections.size,
    t,
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
      snapshot: () => ({
        kind: "rich",
        value: controller.richValue,
        displayText: controller.richDisplayText,
      }),
      clear: controller.clearRichInput,
    }),
    [
      controller.clearRichInput,
      controller.richDisplayText,
      controller.richValue,
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
  const modelCapability =
    controller.selectedBackend?.capabilities.modelOptions ?? "none";
  /* `backend === "codex"` 已把联合收窄到 CodexTurnOptions，而 reasoningEffort /
     serviceTier 是它的必填字段——再补两个 `in` 检查是同一判定写第二遍。 */
  const fullModelOptions =
    modelCapability === "full" && controller.turnOptions.backend === "codex"
      ? controller.turnOptions
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 pt-0">
      <ResumeFailureDialog controller={controller} />
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
      <MessageQueuePanel
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
      />
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
          <div className="relative z-0 mx-3 -mb-px flex min-w-0 items-center gap-2 rounded-t-2xl bg-muted px-2 py-[calc(1rem/3)]">
            <ChatProjectSelector
              projects={controller.projects}
              selectedProjectId={controller.selectedProjectId}
              disabled={controller.projectsLoading || turnControlsDisabled}
              onChange={controller.selectProject}
              onNewProject={controller.createProject}
            />
            {controller.selectedProjectId && (
              <>
                <ChatBranchSelector
                  key={controller.selectedProjectId}
                  projectId={controller.selectedProjectId}
                  disabled={turnControlsDisabled}
                  listBranches={controller.listBranches}
                  checkoutBranch={controller.checkoutBranch}
                  createBranch={controller.createBranch}
                  onBusyChange={setBranchBusy}
                />
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
          </div>
        )}
      {unavailableBackend ? (
        <ChatBackendUnavailable
          backend={unavailableBackend}
          info={controller.selectedBackend}
          onConfigure={controller.openSetup}
          onRetry={controller.retryBackends}
        />
      ) : controller.approval?.purpose === "plan-review" ? (
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
        className="relative z-10 [&_[data-slot=input-group]]:overflow-visible [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:bg-background"
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
        prepareSubmission={(message) =>
          freezeGalleryDraft(controller.chatId, message)
        }
        onSubmit={(message, _event, { signal }) => {
          if (branchBusy) {
            throw new Error(t("chat.composer.surface.branchBusy"));
          }
          if (authorizationQueueRef.current?.isBusy()) {
            throw new Error(t("chat.composer.surface.fileAuthorizationBusy"));
          }
          return controller.handleSubmit(message, { signal });
        }}
      >
        <button
          aria-hidden="true"
          className="pointer-events-none absolute size-px overflow-hidden opacity-0"
          disabled={
            // Enter 提交与可见按钮同一 gate：漏掉 gallerySendGate 会把 pending/failed 选图静默丢下发送
            editingDisabled ||
            controller.cancelPending ||
            gallerySendGate(controller.chatId)
          }
          tabIndex={-1}
          type="submit"
        />
        <PromptInputBody>
          <PromptInputAttachments />
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
            onQueryChange={handleQueryChange}
            onSuggestionPendingChange={setWorkspaceSelectionPending}
            onSuggestionSelect={consumeWorkspaceImage}
            suggestionCopy={suggestionCopy}
            suggestions={suggestions}
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
              />
            )}
            <ChatPermissionSelector
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
              allowedModes={controller.selectedBackend?.capabilities.permissionModes}
            />
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
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <ChatAgentSelector
              value={controller.turnOptions.backend}
              backends={controller.backends}
              locked={
                controller.persisted || Boolean(controller.lockedBackend)
              }
              checking={controller.backendState === "checking"}
              saving={controller.settingsSaving}
              disabled={turnControlsDisabled}
              onChange={controller.selectBackend}
            />
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
                settingsError={controller.settingsError}
                saving={controller.settingsSaving}
                streaming={isGenerating}
                disabled={turnControlsDisabled}
                onChange={controller.updateTurnOptions}
                onRetryModels={controller.retryModels}
              />
            )}
            <PromptInputSubmit
              className="shrink-0 rounded-full"
              status={controller.status}
              onStop={controller.handleStop}
              preferSubmit={draftReady}
              disabled={actionDisabled}
              {...(isGenerating && draftReady
                ? {
                    "aria-label": t("chat.composer.surface.queueSubmit"),
                  }
                : {})}
            />
          </div>
        </PromptInputFooter>
      </PromptInput>
      )}
    </div>
  );
}

export const ChatComposer = memo(function ChatComposer(props: {
  controller: ChatSessionController["composer"];
  focusOnReady?: boolean;
  enableSidePanel?: boolean;
  /** 全屏 Base dock：闲置时收成单行，避免空输入框占掉两行悬浮面积 */
  collapseWhenIdle?: boolean;
}) {
  return (
    <PromptInputProvider
      attachments={{
        files: props.controller.attachmentFiles,
        onChange: props.controller.replaceAttachmentFiles,
        onCommand: (command, nextFiles) => {
          applyGalleryAttachmentCommand(props.controller.chatId, command);
          props.controller.replaceAttachmentFiles(nextFiles);
        },
      }}
    >
      <ChatComposerContent {...props} />
    </PromptInputProvider>
  );
});
