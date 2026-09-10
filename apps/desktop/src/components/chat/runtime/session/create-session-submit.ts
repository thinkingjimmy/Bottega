/**
 * [INPUT]: Depends on Chat/Project/Setup ports, Conversation Coordinator, session-submission-payload, renderer locale/catalog runtime, errors, attachment sequencing, and Abort tools
 * [OUTPUT]: Provides workspace-fenced manual submission/revision with canonical Agent revision checks, availability, and explicit authentication retry
 * [POS]: The limit of the submission of chat/runtime/session transactions; The main custody is not cancelled due to view switching, and the delayed return can only be written back to the still matched renderer generation
 */
import { submissionDecision } from "../../../../../shared/agent-availability/projection";


import { assertNoPendingAgent, bindAgentSubmission, rejectAgentSubmission } from "@/lib/chat-agent-draft/submission";
import { readAgentDraft, consumeAgentSubmission, receiveCanonicalAgent } from "@/lib/chat-agent-draft/state";
import type { MutableRefObject } from "react";
import type { ChatStatus } from "ai";
import {
  awaitSubmissionStep,
  throwIfSubmissionAborted,
} from "@ai-chat/ui/lib/prompt-input-submission";
import type {
  AgentScope,
  BackendInfo,
  SessionRef,
  SteerAdmission,
} from "../../../../../shared/agent-ipc";
import type {
  ChatMessage,
  UnsequencedUserMessage,
} from "../../../../../shared/chats-ipc";
import { REVISION_NOT_IDLE, REVISION_STALE } from "../../../../../shared/chats-ipc";
import type {
  AdmissionResult,
  ManualTurnPersistence,
  ManualTurnSubmission,
} from "../../../../../shared/sections-ipc";
import type {
  IncarnationPrecondition,
  WorkspacePrecondition,
} from "../../../../../shared/submission";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { useChats } from "@/components/providers/chats-provider";
import type { useProjects } from "@/components/providers/projects-provider";
import type { useSetup } from "@/components/providers/setup-provider";
import {
  respondAgentApproval,
  respondAgentUserInput,
  ackAgentSteerIntents,
  type AgentRequest,
} from "@/lib/agent-client";
import {
  flushPendingComposerAcks,
  registerPendingComposerAck,
  retainComposerResources,
  updateComposer,
} from "@/lib/chat-composer-store";
import { readGalleryState } from "@/lib/gallery/store";
import {
  adoptAmbiguousSubmission,
  queuedPrompt,
} from "@/lib/message-queue-model";
import { errorMessage, reportedFailure } from "@/lib/errors";
import { effectiveLocale } from "@/lib/i18n-locale";
import { admissionReasonText } from "@/lib/skill-failure-text";
import { translate } from "../../../../../shared/i18n/runtime";
import {
  ackManualIntents,
  ackSubmissionOutcome,
  cancelManualTurn,
  getSubmissionOutcome,
  submitManualTurn,
} from "@/lib/sections-client";
import { splitChatAttachments } from "../chat-attachments";
import {
  messageId,
  serializeCurrentInput,
  submitBlocked,
  type ChatProjectMode,
} from "../chat-session-model";
import type { useChatSettings } from "../use-chat-settings";
import type { SessionSubmitLifecycle } from "./create-session-submit-lifecycle";
import type { SessionSubmit } from "./use-session-interactions";
import { gallerySnapshot, submissionContent } from "./session-submission-payload";
export { assembleFirstTurnPayload } from "./session-submission-payload";

type ChatsPort = Pick<ReturnType<typeof useChats>, "getChat">;
type ProjectsPort = Pick<ReturnType<typeof useProjects>, "ensureForApp">;
type SetupPort = Pick<ReturnType<typeof useSetup>, "openAgentSettings">;
type SettingsPort = Pick<
  ReturnType<typeof useChatSettings>,
  | "lockBackend"
  | "settingsLoading"
  | "settingsSaving"
  | "turnOptions"
>;

export type SessionSubmitInput = {
  snapshot: {
    chatId: string;
    scope: AgentScope;
    project: ChatProjectMode;
    selectedProjectId: string | null;
    selectedBackend: BackendInfo | undefined;
    loading: boolean;
    status: ChatStatus;
    planMode: boolean;
    agentSession: SessionRef | undefined;
    messages: ChatMessage[];
    workspaceScopeKey: string;
    workspacePrecondition: WorkspacePrecondition | null;
  };
  services: {
    chats: ChatsPort;
    projects: ProjectsPort;
    settings: SettingsPort;
    setup: SetupPort;
    isPlanCapabilityChecking: () => boolean;
    requirePlanCapability: () => Promise<void>;
  };
  refs: {
    recordExists: MutableRefObject<boolean>;
    incarnationId?: MutableRefObject<string | null>;
    request: MutableRefObject<AgentRequest | null>;
    workspaceScopeKey: MutableRefObject<string>;
  };
  lifecycle: SessionSubmitLifecycle;
};

export type SessionSubmissionPorts = {
  assembleSubmission(
    message: PromptInputMessage,
    options?: Parameters<SessionSubmit>[1]
  ): Promise<ManualTurnSubmission>;
  admitSubmission(envelope: ManualTurnSubmission): Promise<AdmissionResult>;
  assembleSteer(
    message: PromptInputMessage,
    identity: {
      requestId: string;
      outboxRef: string;
      createdAt: number;
    }
  ): Promise<SteerAdmission>;
  assembleRevision(
    messageId: string,
    content: string
  ): Promise<ManualTurnSubmission>;
};

type AssemblyArtifacts = {
  previews: ReturnType<typeof splitChatAttachments>["previews"];
};

type SubmissionFence = {
  captured: string;
  current: MutableRefObject<string>;
  required: boolean;
  isViewCurrent: () => boolean;
};

const submissionFences = new WeakMap<
  ManualTurnSubmission,
  SubmissionFence
>();

const workspaceBoundMessage = (message: PromptInputMessage) =>
  message.input.kind === "rich" &&
  message.input.value.some(
    (node) => node.type !== "text" && node.type !== "section"
  );

function workspaceFenceError(fence: SubmissionFence | undefined) {
  return fence?.required && fence.captured !== fence.current.current
    ? "Workspace 已变化，请重新选择文件或 Skill 后再发送"
    : null;
}

const flushAcks = () =>
  flushPendingComposerAcks({
    manual: ackManualIntents,
    steer: ackAgentSteerIntents,
  });

/** Renderer handle for a main-custodied manual turn; dispose only severs local control. */
function manualTurnRequest(requestId: string): AgentRequest {
  let active = true;
  const ended = () => Promise.reject(new Error("Agent 请求已结束"));
  return {
    requestId,
    cancel: () => {
      if (active) void cancelManualTurn(requestId);
    },
    dispose: () => {
      active = false;
    },
    respondApproval: (approvalId, decision) =>
      active ? respondAgentApproval(requestId, approvalId, decision) : ended(),
    respondUserInput: (userInputId, answers) =>
      active ? respondAgentUserInput(requestId, userInputId, answers) : ended(),
  };
}

export function createSessionSubmissionPorts(
  input: SessionSubmitInput
): SessionSubmissionPorts & {
  artifacts(intentId: string): AssemblyArtifacts | undefined;
} {
  const {
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
      projects,
      settings,
      setup,
      isPlanCapabilityChecking,
      requirePlanCapability,
    },
    refs,
    lifecycle,
  } = input;
  const artifactsByIntent = new Map<string, AssemblyArtifacts>();

  const assembleSubmission: SessionSubmissionPorts["assembleSubmission"] =
  async (message, options = {}) => {
    if (!workspacePrecondition) {
      throw new Error("Workspace 身份尚未完成水合，拒绝提交");
    }
    // PromptInput 把 signal 在 seed 时移交给事务；desktop 开启
    // preserveSubmissionOnUnmount 后它不随组件卸载 abort。这里禁止再与
    // sessionAbort 合并，否则 main 已取得 custody 时 renderer 卸载仍会伪造取消。
    const signal = options.signal ?? new AbortController().signal;
    const planIntent = options.planIntent ?? planMode;
    const workspaceFence = {
      captured: workspaceScopeKey,
      current: refs.workspaceScopeKey,
      required: workspaceBoundMessage(message),
      // queue drain 的 assemble/admit 会跨两个临时 port；世代所有权必须跟
      // envelope 走，不能在 admit 时从当下视图重新铸造。
      isViewCurrent: lifecycle.isCurrent,
    };
    const assertWorkspaceFence = () => {
      const reason = workspaceFenceError(workspaceFence);
      if (reason) throw new Error(reason);
    };
    // seed 身份在首个 await 前冻结；后续 route/Project 解析只能填 wrapper，
    // 不能重铸 intent/request/incarnation。
    const agentDraft = readAgentDraft(chatId);
    if (agentDraft.pending?.submitting || agentDraft.pending?.stale) throw new Error(translate(effectiveLocale(), "chat.agentSwitch.stale"));
    const switchIntent = agentDraft.pending?.intent;
    const intentId = `manual_${crypto.randomUUID().replaceAll("-", "")}`;
    const requestId = `request_${crypto.randomUUID().replaceAll("-", "")}`;
    const userCreatedAt = Date.now();
    const proposedIncarnationId = crypto.randomUUID().replaceAll("-", "");
    throwIfSubmissionAborted(signal);
    const gallery = gallerySnapshot(
      message,
      chatId,
      settings.turnOptions.backend,
      selectedBackend
    );
    const displayText = message.input.displayText.trim();
    if (
      submitBlocked({
        displayText,
        attachmentCount: message.files.length,
        loading,
        settingsBusy: settings.settingsLoading || settings.settingsSaving,
        status,
        planChecking: isPlanCapabilityChecking(),
        hasActiveRequest: Boolean(refs.request.current),
      })
    ) {
      throw new Error("当前不能发送消息");
    }
    const availability = submissionDecision(selectedBackend, Date.now());
    if (availability.reason === "auth-required" && !options.authenticationRetry) throw new Error(translate(effectiveLocale(), "agentAvailability.blocked", { backend: selectedBackend?.displayName ?? "Agent" }));
    if (selectedBackend?.runtimeStatus !== "installed") {
      void setup.openAgentSettings();
      lifecycle.showLocalAssistant(
        translate(
          effectiveLocale(),
          "chat.runtime.submission.backendSetupRequired",
          {
            backend: selectedBackend?.displayName ?? settings.turnOptions.backend,
          }
        ),
        true
      );
      throw new Error("Agent 未初始化");
    }
    if (planIntent) {
      await awaitSubmissionStep(signal, requirePlanCapability);
      assertWorkspaceFence();
    }
    const attachments = splitChatAttachments(message.files);
    const userMessage: UnsequencedUserMessage = {
      id: messageId("user"),
      role: "user",
      content: displayText,
      createdAt: userCreatedAt,
    };
    const serialized = serializeCurrentInput({
      message,
      attachmentInput: attachments.input,
    });
    // chat 已确立 = 挂载时读到 record，或本挂载内 create 已被 main 录取
    //（port 晋升 incarnationId）。persistence 与 precondition 必须同源，
    // 否则会出现 create-persistence + existing-precondition 的撕裂对。
    const chatEstablished = Boolean(
      refs.recordExists.current || refs.incarnationId?.current
    );
    const projectId =
      !chatEstablished && project.kind === "fixed-app"
        ? (
            await awaitSubmissionStep(signal, () =>
              projects.ensureForApp(project.appId)
            )
          ).id
        : selectedProjectId;
    assertWorkspaceFence();
    const persistence: ManualTurnPersistence = chatEstablished
      ? {
          kind: "append",
          input: {
            chatId,
            message: userMessage,
            ...(attachments.payloads.length
              ? { attachmentPayloads: attachments.payloads }
              : {}),
          },
        }
      : project.kind === "fixed-app"
        ? {
            kind: "create-app",
            input: {
              id: chatId,
              appId: project.appId,
              projectId: projectId!,
              appRole: project.appRole,
              agent: settings.turnOptions.backend,
              incarnationId: proposedIncarnationId,
              firstMessage: userMessage,
              ...(attachments.payloads.length
                ? { attachmentPayloads: attachments.payloads }
                : {}),
            },
          }
        : {
            kind: "create",
            input: {
              id: chatId,
              agent: settings.turnOptions.backend,
              firstMessage: userMessage,
              projectId,
              incarnationId: proposedIncarnationId,
              ...(attachments.payloads.length
                ? { attachmentPayloads: attachments.payloads }
                : {}),
            },
          };
    const content = submissionContent(message, gallery, chatId);
    const precondition: IncarnationPrecondition = chatEstablished
      ? refs.incarnationId?.current
        ? {
            kind: "existing",
            incarnationId: refs.incarnationId.current,
          }
        : (() => {
            throw new Error("当前聊天缺少 incarnationId，拒绝无 CAS 提交");
          })()
      : {
          kind: "absent",
          proposedIncarnationId,
        };
    const durablePersistence: ManualTurnPersistence =
      persistence.kind === "append"
        ? {
            ...persistence,
            input: { ...persistence.input, precondition },
          }
        : persistence;
    const envelope: ManualTurnSubmission = {
      intentId,
      expectedAgentRevision: agentDraft.canonical?.agentRevision ?? 0,
      ...(switchIntent ? { agentSwitch: switchIntent } : {}),
      ...(options.authenticationRetry ? { authenticationRetry: options.authenticationRetry } : {}),
      persistence: durablePersistence,
      content,
      precondition,
      workspacePrecondition,
      turn: {
        requestId,
        ...(agentSession && !switchIntent ? { session: agentSession } : {}),
        scope,
        turnOptions: settings.turnOptions,
        input: serialized,
        ...(planIntent ? { planMode: true } : {}),
      },
    };
    assertWorkspaceFence();
    submissionFences.set(envelope, workspaceFence);
    artifactsByIntent.set(intentId, { previews: attachments.previews });
    return envelope;
  };

  const admitSubmission: SessionSubmissionPorts["admitSubmission"] =
    async (envelope) => {
      const fenceFailure = workspaceFenceError(submissionFences.get(envelope));
      if (fenceFailure) {
        return { kind: "rejectedBeforeAdmission", reason: fenceFailure };
      }
      try {
        bindAgentSubmission(envelope);
        const result = await submitManualTurn(envelope);
        if (result.kind === "rejectedBeforeAdmission") rejectAgentSubmission(chatId, envelope.intentId);
        // absent→create 被 main 录取即原子晋升 existing(P)：direct 与
        // queue drain 共用本 port，同一挂载内后续提交不再重复 create。
        if (
          result.kind === "accepted" &&
          envelope.precondition.kind === "absent" &&
          (result.receipt.phase !== "failed" ||
            result.receipt.userPersisted) &&
          refs.incarnationId &&
          submissionFences.get(envelope)?.isViewCurrent()
        ) {
          refs.incarnationId.current =
            envelope.precondition.proposedIncarnationId;
        }
        return result;
      } catch (cause) {
        const message = errorMessage(cause);
        if (
          message.includes(REVISION_NOT_IDLE) ||
          message.includes(REVISION_STALE)
        ) {
          return { kind: "rejectedBeforeAdmission", reason: message };
        }
        return { kind: "ambiguous", cause: message };
      }
    };

  const assembleSteer: SessionSubmissionPorts["assembleSteer"] =
    async (message, identity) => {
      if (!workspacePrecondition) {
        throw new Error("Workspace 身份尚未完成水合，拒绝插入消息");
      }
      if (!refs.recordExists.current) {
        throw new Error("聊天尚未持久化，不能插入运行中 turn");
      }
      const displayText = message.input.displayText.trim();
      const gallery = gallerySnapshot(
        message,
        chatId,
        settings.turnOptions.backend,
        selectedBackend,
        "steer"
      );
      const attachments = splitChatAttachments(message.files);
      if (!displayText && attachments.input.length === 0) {
        throw new Error("消息不能为空");
      }
      const userMessage: UnsequencedUserMessage = {
        id: identity.outboxRef,
        role: "user",
        content: displayText,
        createdAt: identity.createdAt,
      };
      return {
        ...identity,
        input: serializeCurrentInput({
          message,
          attachmentInput: attachments.input,
        }),
        displayText,
        userMessage,
        ...(attachments.payloads.length
          ? { attachmentPayloads: attachments.payloads }
          : {}),
        content: submissionContent(message, gallery, chatId),
        workspacePrecondition,
      };
    };

  const assembleRevision: SessionSubmissionPorts["assembleRevision"] = (
    supersedesUserMessageId,
    rawContent
  ) => {
    if (!workspacePrecondition || !refs.incarnationId?.current) {
      throw new Error("当前聊天身份尚未完成水合");
    }
    const target = messages.find(
      (message) => message.id === supersedesUserMessageId
    );
    const lastUser = messages.findLast((message) => message.role === "user");
    const throughSeqEnd = messages.at(-1)?.seq;
    if (
      target?.role !== "user" ||
      lastUser?.id !== target.id ||
      throughSeqEnd === undefined
    ) {
      throw new Error(REVISION_STALE);
    }
    const content = rawContent.trim();
    if (!content && !target.attachments?.length) {
      throw new Error("消息不能为空");
    }
    const intentId = `manual_${crypto.randomUUID().replaceAll("-", "")}`;
    const requestId = `request_${crypto.randomUUID().replaceAll("-", "")}`;
    const userMessage: UnsequencedUserMessage = {
      id: messageId("user"),
      role: "user",
      content,
      createdAt: Date.now(),
    };
    const precondition: IncarnationPrecondition = {
      kind: "existing",
      incarnationId: refs.incarnationId.current,
    };
    const gallery = readGalleryState(chatId);
    const envelope: ManualTurnSubmission = {
      intentId,
      expectedAgentRevision: readAgentDraft(chatId).canonical?.agentRevision ?? 0,
      persistence: {
        kind: "append",
        input: {
          chatId,
          message: userMessage,
          precondition,
          revise: { supersedesUserMessageId, throughSeqEnd },
        },
      },
      content: {
        schemaVersion: 1,
        content: {
          richValue: content
            ? [{ id: crypto.randomUUID(), type: "text", value: content }]
            : [],
          displayText: content,
          files: [],
        },
        origin: "composer",
        capabilityEpoch: gallery.capabilityEpoch,
        backendEpoch: gallery.backendEpoch,
      },
      precondition,
      workspacePrecondition,
      turn: {
        requestId,
        ...(agentSession ? { session: agentSession } : {}),
        scope,
        turnOptions: settings.turnOptions,
        input: content ? [{ type: "text", text: content }] : [],
      },
    };
    submissionFences.set(envelope, {
      captured: workspaceScopeKey,
      current: refs.workspaceScopeKey,
      required: false,
      isViewCurrent: lifecycle.isCurrent,
    });
    return Promise.resolve(envelope);
  };

  return {
    assembleSubmission,
    admitSubmission,
    assembleSteer,
    assembleRevision,
    artifacts: (intentId) => artifactsByIntent.get(intentId),
  };
}

export type SessionRevisionSubmit = (
  messageId: string,
  content: string
) => Promise<void>;

/** 修订拒绝排队；replace 事件是消息视图唯一权威，不做 renderer 乐观截尾。 */
export function createSessionRevisionSubmit(
  input: SessionSubmitInput
): SessionRevisionSubmit {
  return async (messageId, content) => {
    assertNoPendingAgent(input.snapshot.chatId);
  const ports = createSessionSubmissionPorts(input);
    const envelope = await ports.assembleRevision(messageId, content);
    const result = await ports.admitSubmission(envelope);
    if (result.kind === "ambiguous") throw new Error(result.cause);
    if (result.kind === "rejectedBeforeAdmission") {
      throw new Error(admissionReasonText(result));
    }
    const receipt = result.receipt;
    if (receipt.phase === "queued") throw new Error(REVISION_NOT_IDLE);
    registerPendingComposerAck({
      kind: "manual",
      id: envelope.intentId,
      chatId: input.snapshot.chatId,
    });
    if (receipt.phase === "failed") {
      await flushAcks();
      if (!receipt.userPersisted) throw new Error(REVISION_STALE);
      return;
    }
    if (receipt.phase === "settled") {
      await flushAcks();
      return;
    }
    input.lifecycle.begin();
    input.lifecycle.accept(receipt, []);
    void flushAcks();
    input.lifecycle.attachRequest(manualTurnRequest(envelope.turn.requestId));
  };
}

export function createSessionSubmit(input: SessionSubmitInput): SessionSubmit {
  const ports = createSessionSubmissionPorts(input);
  return async (message, options = {}) => {
    const signal = options.signal ?? new AbortController().signal;
    let envelope: ManualTurnSubmission;
    try {
      envelope = await ports.assembleSubmission(message, options);
    } catch (cause) {
      throwIfSubmissionAborted(signal);
      input.lifecycle.rejectBeforeAdmission(
        translate(effectiveLocale(), "chat.runtime.submission.localPreparationFailed", {
          message: errorMessage(cause),
        })
      );
      throw reportedFailure(cause);
    }
    const artifacts = ports.artifacts(envelope.intentId)!;
    const fenceFailure = workspaceFenceError(submissionFences.get(envelope));
    if (fenceFailure) {
      input.lifecycle.rejectBeforeAdmission(fenceFailure);
      throw reportedFailure(new Error(fenceFailure));
    }
    input.lifecycle.clearAttachmentNotice();
    const synchronizeAcceptedRecord = async () => {
      if (!input.lifecycle.isCurrent()) return;
      const record = await input.services.chats.getChat(input.snapshot.chatId);
      if (!record || !input.lifecycle.isCurrent()) return;
      receiveCanonicalAgent(input.snapshot.chatId, record);
      consumeAgentSubmission(input.snapshot.chatId, envelope.intentId, record);
      input.lifecycle.syncSession(record.session ?? undefined);
      if (record.agent !== input.services.settings.turnOptions.backend) {
        if (!input.lifecycle.isCurrent()) return;
        await input.services.settings.lockBackend(record.agent);
      }
    };
    const result = await awaitSubmissionStep(signal, () =>
      ports.admitSubmission(envelope)
    );
    if (result.kind === "ambiguous") {
      if (envelope.agentSwitch) {
        retainComposerResources(input.snapshot.chatId);
        input.lifecycle.holdAmbiguousAdmission(result.cause);
        throw reportedFailure(new Error(translate(effectiveLocale(), "chat.agentSwitch.confirming")));
      }
      updateComposer(input.snapshot.chatId, (current) => ({
        ...current,
        queue: adoptAmbiguousSubmission(
          current.queue,
          queuedPrompt(message),
          envelope,
          result.cause
        ),
      }));
      retainComposerResources(input.snapshot.chatId);
      input.lifecycle.holdAmbiguousAdmission(result.cause);
      return;
    }
    if (result.kind === "rejectedBeforeAdmission") {
      rejectAgentSubmission(input.snapshot.chatId, envelope.intentId);
      input.lifecycle.rejectBeforeAdmission(admissionReasonText(result));
      throw reportedFailure(new Error(result.reason));
    }
    const receipt = result.receipt;
    if (envelope.agentSwitch && receipt.phase === "queued") {
      input.lifecycle.holdAmbiguousAdmission(translate(effectiveLocale(), "chat.agentSwitch.recovering"));
      throw reportedFailure(new Error(translate(effectiveLocale(), "chat.agentSwitch.recovering")));
    }
    if (envelope.agentSwitch && !(receipt.phase === "failed" && !receipt.userPersisted)) await synchronizeAcceptedRecord();
    registerPendingComposerAck({
      kind: "manual",
      id: envelope.intentId,
      chatId: input.snapshot.chatId,
    });
    void getSubmissionOutcome(envelope.intentId).then((outcome) =>
      outcome.kind === "notFound"
        ? undefined
        : ackSubmissionOutcome({
            intentId: envelope.intentId,
            outcomeRevision: outcome.revision,
            kind: "admission",
          })
    );
    if (receipt.phase === "failed" && !receipt.userPersisted) {
      rejectAgentSubmission(input.snapshot.chatId, envelope.intentId);
      const reason = translate(effectiveLocale(), "chat.runtime.queue.notPersisted");
      input.lifecycle.rejectBeforeAdmission(reason);
      await flushAcks();
      throw reportedFailure(new Error(reason));
    }
    if (receipt.phase === "settled" || receipt.phase === "failed") {
      await flushAcks();
      return;
    }
    input.lifecycle.begin();
    input.lifecycle.accept(receipt, artifacts.previews);
    void flushAcks();
    void synchronizeAcceptedRecord().catch(
      input.lifecycle.reportAcceptedSyncFailure
    );
    input.lifecycle.attachRequest(manualTurnRequest(envelope.turn.requestId));
  };
}
