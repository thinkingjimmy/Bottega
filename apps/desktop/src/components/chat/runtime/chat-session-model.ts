/**
 * [INPUT]: Depends on the shared RichInput wire projection, shared Agent/Chat/Project/Submission contracts, PromptInput, and transcript recovery helpers
 * [OUTPUT]: Provides the React-free session controller model, structured user-input errors, strict PanelSessionContext, App conversation-context projection, derived identity keys, eligibility reasons, open commands, and composer/transcript contracts
 * [POS]: The canonical type and pure-policy layer for chat/runtime
 */

import type {
  AgentUserInput,
  AgentWorkspaceScope,
} from "../../../../shared/agent-ipc";
import type {
  AppChatRole,
  ChatAttachmentMeta,
  ChatMessage,
} from "../../../../shared/chats-ipc";
import type { ConversationContext } from "../../../../shared/placement/facts";
import { CHAT_PANEL_CAPABILITIES } from "../../../../shared/placement/facts";
import type { GallerySourceRef } from "../../../../shared/gallery-media-ipc";
import type { Project } from "../../../../shared/projects-ipc";
import type { WorkspacePrecondition } from "../../../../shared/submission";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { buildRecoveryInput } from "@/lib/chat-transcript";
import type { PendingUserInputState } from "@/lib/chat-user-input-state";
import { projectRichInput } from "../../../../shared/rich-input-projection";

export type { PendingUserInputState } from "@/lib/chat-user-input-state";

/* 「这条会话的 Project 能不能由用户挑」只有两种答案。selectable 不再携带
   initialProjectId：草稿的 scope 归路由（`chat-composer-store` 的
   `setDraftRouteProject` 是唯一写者），本 hook 无从分辨「路由没发话」与
   「路由说的是根级」，替它猜就会猜错其中一种。 */
export type ChatProjectMode =
  | { kind: "selectable" }
  | { kind: "fixed-app"; appId: string; appRole: AppChatRole };

/* ============================================================
 * 第三栏身份：一份上下文，三个派生问题
 *
 * conversationKey 回答“是哪段会话”，generationKey 回答“是哪一代”，
 * productRef 回答“能否触碰产品所有权”。三者都从判别联合派生，不再让
 * chatId/incarnationId 在调用点互相冒充。外源会话不再有独立身份——同步
 * 之后它就是一条只读 canonical Chat，走 product 这一支。
 * ============================================================ */
export type PanelSessionContext =
  | { kind: "draft"; draftKey: string; conversationContext?: ConversationContext; productRef?: never }
  | {
      kind: "product" | "adopted";
      productRef: { chatId: string; incarnationId: string };
      conversationContext?: ConversationContext;
    };

export const panelConversationContext = (
  project: ChatProjectMode,
  selectedProjectId: string | null
): ConversationContext =>
  project.kind !== "fixed-app"
    ? { kind: "ordinary" }
    : project.appRole === "use"
      ? { kind: "app-use", appId: project.appId }
      : {
          kind: "app-edit",
          appId: project.appId,
          projectId: selectedProjectId ?? "pending",
        };

export const createPanelSessionContext = (input: {
  chatId: string;
  incarnationId?: string;
  adopted: boolean;
  project: ChatProjectMode;
  selectedProjectId: string | null;
}): PanelSessionContext => {
  const conversationContext = panelConversationContext(
    input.project,
    input.selectedProjectId
  );
  if (!input.incarnationId) {
    return { kind: "draft", draftKey: input.chatId, conversationContext };
  }
  return {
    kind: input.adopted ? "adopted" : "product",
    productRef: {
      chatId: input.chatId,
      incarnationId: input.incarnationId,
    },
    conversationContext,
  };
};

export const panelConversationKey = (context: PanelSessionContext) =>
  context.kind === "draft" ? context.draftKey : context.productRef.chatId;

export const panelGenerationKey = (context: PanelSessionContext) =>
  context.kind === "draft" ? "" : context.productRef.incarnationId;

export type PanelCapability =
  | "base"
  | "app"
  | "subagents"
  | "browser"
  | "image";

export type PanelEligibilityReason = "app-context-base-unavailable";

export type PanelEligibility =
  | { allowed: true }
  | { allowed: false; reason: PanelEligibilityReason };

export function panelEligibility(
  context: PanelSessionContext,
  capability: PanelCapability
): PanelEligibility {
  return capability === "base" &&
    context.conversationContext &&
    !CHAT_PANEL_CAPABILITIES[context.conversationContext.kind].base
    ? { allowed: false, reason: "app-context-base-unavailable" }
    : { allowed: true };
}

export type SidePanelState =
  | { kind: "none" }
  | {
      kind: "tabs";
      context: PanelSessionContext;
      command?: SidePanelTabCommand;
    }
  | {
      kind: "plan";
      messageId: string;
      planItemId?: string;
      content: string;
      title: string;
    }
  | {
      kind: "file";
      nodeId: string;
      filename: string;
      content: string;
      loading: boolean;
      error?: string;
    }
  | {
      kind: "workspace-preview";
      nodeId: string;
      filename: string;
      status: "loading" | "text" | "metadata" | "error";
      content?: string;
      size?: number;
      mtimeMs?: number;
      reason?: "too-large" | "binary";
      error?: string;
    };

export type ConversationImageSource =
  | {
      kind: "generated";
      sourceRef: GallerySourceRef;
      title: string;
    }
  | {
      kind: "attachment";
      chatId: string;
      incarnationId: string;
      attachment: ChatAttachmentMeta;
    };

export type SidePanelTabCommand =
  | { target: "openShell" | "base" | "browser"; nonce: number }
  | { target: "app"; appId: string; nonce: number }
  | { target: "subagents"; agentThreadId?: string; nonce: number }
  | { target: "image"; source: ConversationImageSource; nonce: number };

export type SidePanelTabCommandInput = SidePanelTabCommand extends infer Command
  ? Command extends SidePanelTabCommand
    ? Omit<Command, "nonce">
    : never
  : never;

export type SidePanelRequest = {
  conversationKey: string;
  command: SidePanelTabCommand;
};

/* ============================================================
 * Composer 三闸：同一份前提，三种结论
 *
 * 三者共享同一组「会话本身还没准备好」的前提，此前各自展开一遍，于是
 * 差异藏在五条相同条件的缝里没人看得见——真正区分它们的只有两问：
 *
 *   turnRunning   有没有活动 turn。**只关停控件，不关输入**：运行中打的
 *                 字去队列，这正是队列存在的理由。
 *   awaitingUser  turn 是否停在用户身上（追问/Plan 决策/未闭合审批）。
 *                 只挡排空——此时替用户自动发下一条是抢答。
 *
 * 写成一处后，「运行中能不能打字」不再是三个表达式的联立推论，而是一行
 * 可以被直接断言的事实。
 * ============================================================ */
export type ComposerGateInput = {
  loading: boolean;
  settingsLoading: boolean;
  settingsSaving: boolean;
  planCapabilityChecking: boolean;
  hydrationReady: boolean;
  backendReady: boolean;
  turnRunning: boolean;
  awaitingUser: boolean;
};

type ComposerGates = {
  inputDisabled: boolean;
  turnControlsDisabled: boolean;
  canDrain: boolean;
};

export function composerGates(input: ComposerGateInput): ComposerGates {
  const sessionReady =
    !input.loading &&
    !input.settingsLoading &&
    !input.settingsSaving &&
    !input.planCapabilityChecking &&
    input.hydrationReady &&
    input.backendReady;
  return {
    inputDisabled: !sessionReady,
    turnControlsDisabled: !sessionReady || input.turnRunning,
    canDrain: sessionReady && !input.turnRunning && !input.awaitingUser,
  };
}

type WorkspaceProject = Pick<
  Project,
  "id" | "membershipRevision" | "workspaceBinding"
>;

const projectWorkspacePrecondition = (
  project: WorkspaceProject | undefined
): WorkspacePrecondition | null =>
  project
    ? {
        kind: "project",
        projectId: project.id,
        membershipRevision: project.membershipRevision,
      }
    : null;

/** renderer 与 main 的 effective workspace owner 必须同构。 */
export function workspacePreconditionFor(
  scope: AgentWorkspaceScope,
  project: WorkspaceProject | undefined,
  incarnationId: string | null
): WorkspacePrecondition | null {
  if (scope.kind === "project") {
    return project?.id === scope.projectId
      ? projectWorkspacePrecondition(project)
      : null;
  }
  if (scope.kind === "conversation") {
    if (project && project.workspaceBinding.kind !== "none") {
      return projectWorkspacePrecondition(project);
    }
    return incarnationId
      ? {
          kind: "chat-home",
          conversationId: scope.conversationId,
          incarnationId,
        }
      : null;
  }
  return scope;
}

let sidePanelCommandNonce = 0;
export const nextSidePanelCommandNonce = () => ++sidePanelCommandNonce;

export function matchesSidePanelRequest(
  request: SidePanelRequest | null | undefined,
  context: PanelSessionContext
): request is SidePanelRequest {
  return request?.conversationKey === panelConversationKey(context);
}

export function consumeSidePanelRequest(
  current: SidePanelRequest | null,
  nonce: number
) {
  return current?.command.nonce === nonce ? null : current;
}

export type PendingPlanDecisionState = {
  messageId: string;
  busy: boolean;
  error: string;
};

type UserInputAdvance =
  | { kind: "blocked"; state: PendingUserInputState }
  | {
      kind: "next" | "submit";
      state: PendingUserInputState;
      answers: PendingUserInputState["answers"];
    };

export function advanceUserInput(
  pending: PendingUserInputState,
  answers: string[],
  now = Date.now()
): UserInputAdvance {
  if (pending.expiresAt && pending.expiresAt <= now) {
    return {
      kind: "blocked",
      state: { ...pending, error: { copyKey: "chat.userInput.expired" } },
    };
  }
  const question = pending.request.questions[pending.index];
  if (!question || !answers.length || answers.some((answer) => !answer.trim())) {
    return {
      kind: "blocked",
      state: { ...pending, error: { copyKey: "chat.userInput.answerRequired" } },
    };
  }
  const nextAnswers = {
    ...pending.answers,
    [question.id]: { answers: answers.map((answer) => answer.trim()) },
  };
  const submit = pending.index >= pending.request.questions.length - 1;
  return {
    kind: submit ? "submit" : "next",
    answers: nextAnswers,
    state: {
      ...pending,
      index: submit ? pending.index : pending.index + 1,
      answers: nextAnswers,
      busy: submit,
      error: "",
    },
  };
}

export const MARKDOWN_PATTERN = /\.(?:md|mdx|markdown)$/i;
export const MARKDOWN_PREVIEW_LIMIT = 1024 * 1024;

export function workspacePreviewMetadataMessage(
  reason: Extract<SidePanelState, { kind: "workspace-preview" }>["reason"]
) {
  return reason === "too-large"
    ? "文件超过当前预览大小上限，仅显示元信息。"
    : "这是二进制文件，仅显示元信息。";
}

export const messageId = (role: ChatMessage["role"]) =>
  `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type SubmitGate = {
  displayText: string;
  attachmentCount?: number;
  loading: boolean;
  settingsBusy: boolean;
  status: string;
  planChecking: boolean;
  hasActiveRequest: boolean;
};

export type RevisionUnavailableReason =
  | "busy"
  | "queued"
  | "adopted-history";

export function revisionUnavailableReason(input: Readonly<{
  persisted: boolean;
  inputDisabled: boolean;
  status: string;
  queued: boolean;
  adopted: boolean;
}>): RevisionUnavailableReason | undefined {
  if (!input.persisted || input.inputDisabled) return undefined;
  if (input.status !== "ready") return "busy";
  if (input.queued) return "queued";
  return input.adopted ? "adopted-history" : undefined;
}

/** 提交门禁：任一条件不满足即拒绝发送（对应"当前不能发送消息"） */
export const submitBlocked = (gate: SubmitGate) =>
  (!gate.displayText && !(gate.attachmentCount && gate.attachmentCount > 0)) ||
  gate.loading ||
  gate.settingsBusy ||
  gate.status !== "ready" ||
  gate.planChecking ||
  gate.hasActiveRequest;

/**
 * Electron coordinator 路径只序列化当前输入；canonical session 与历史
 * 折叠只能由 main 在持久账本上决定。
 */
export function serializeCurrentInput(args: {
  message: PromptInputMessage;
  attachmentInput: AgentUserInput[];
}): AgentUserInput[] {
  const structured: AgentUserInput[] =
    args.message.input.kind === "rich"
      ? projectRichInput(args.message.input.value)
      : [{ type: "text", text: args.message.input.displayText }];
  return [...structured, ...args.attachmentInput];
}

/** 浏览器 mock 没有 main coordinator，故只在此 fallback 保留 recovery 折叠。 */
export function buildMockTurnInput(args: {
  message: PromptInputMessage;
  attachmentInput: AgentUserInput[];
  history: ChatMessage[];
  activeThreadId: string | undefined;
}): AgentUserInput[] {
  const current = serializeCurrentInput(args);
  return args.history.length > 0 && !args.activeThreadId
    ? buildRecoveryInput(args.history, current)
    : current;
}
