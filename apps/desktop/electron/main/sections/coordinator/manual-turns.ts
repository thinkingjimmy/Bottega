/**
 * [INPUT]: Depends on hash-verified prepared Project/Tools/Skill receipts, durable ManualTurnIntent, ChatsService, SettingsStore, session-plan rebuild, and Agent start ports
 * [OUTPUT]: Provides atomic switch replay, durable append-before-cleanup receipts, workspace-fenced persistence, fresh handoff, active Skill custody projection, typed authentication retries, and exact frozen Tools/Skill dispatch
 * [POS]: The durable manual-intent executor of sections/coordinator
 */

import { taskStartFence, StartDeferredError } from "../../presence/lifecycle/start-fence";
import { buildHandoff, handoffInput } from "../../agent/history/builder";
import { isOriginalAdoptedBinding } from "../../../../shared/chat-agent/contracts";
import { switchEligibility, switchReservationInput } from "./agent-switch/eligibility";
import {
  dataUrlByteSize,
  type AgentSendPayload,
  type AgentUserInput,
} from "../../../../shared/agent-ipc";
import type {
  ChatAttachmentMeta,
  ChatRecord,
  UserChatMessage,
} from "../../../../shared/chats-ipc";
import type { ResolvedAgentInput } from "../../backends/types";
import type {
  TrustedManualTurnPersistence as ManualTurnPersistence,
  TrustedManualTurnSubmission as ManualTurnSubmission,
} from "../../../../shared/sections-ipc";
import type { ChatsService } from "../../chats/chats-service";
import type {
  DeepReadonly,
  ManualTurnIntent,
  RelayLedger,
} from "./relay-ledger";
import {
  stableId,
} from "./coordinator-values";
import type { TurnOrigin } from "../../agent/bridge-types";
import {
  type PreparedManualTurn,
} from "./admission/prepared-manual-turn";
import { hydratePreparedTurn } from "./admission/prepared/hydration";
import type { CoordinatorDependencies } from "./coordinator-runtime";
import { ATTACHMENT_ID_PATTERN } from "../../chats/chat-schema";
import {
  assertManualWorkspacePrecondition,
  manualLifecycleProjectId,
} from "./admission/workspace-precondition";

type ManualTurnDependencies = Pick<
  CoordinatorDependencies,
  | "ledger"
  | "chats"
  | "settings"
  | "onManualPersisted"
  | "startTurn"
  | "getProjectWorkspaceSnapshot"
  | "rebuildSessionForTools"
  | "resolveProjectToolsRuntimeIdentity"
  | "assertProjectToolsContext"
  | "hasActivity"
  | "onAgentSwitchCommitted"
  | "getConversationAvailability"
>;

export function preparedSkillSelections(ledger: RelayLedger) {
  return Object.values(ledger.snapshot().manualIntents).flatMap(intent => {
    if (["settled", "failed"].includes(intent.phase) || !intent.payload) return [];
    const prepared = intent.payload as PreparedManualTurn;
    return [{ requestId: intent.requestId, receipt: prepared.skillSelection }];
  });
}

export function manualConversationId(persistence: ManualTurnPersistence) {
  return persistence.kind === "append"
    ? persistence.input.chatId
    : persistence.input.id;
}

export function manualUserMessage(persistence: ManualTurnPersistence) {
  return persistence.kind === "append"
    ? persistence.input.message
    : persistence.input.firstMessage;
}

export function bindAdoptedSessionPlan(
  submission: ManualTurnSubmission,
  toolPlan: Readonly<{ planDigest: string; projectId: string | null }>
): ManualTurnSubmission {
  if (
    submission.persistence.kind !== "adopt" ||
    submission.persistence.input.session.toolPlan
  ) {
    return submission;
  }
  const session = {
    ...submission.persistence.input.session,
    toolPlan: { ...toolPlan },
  };
  return {
    ...submission,
    persistence: {
      kind: "adopt",
      input: { ...submission.persistence.input, session },
    },
    turn: { ...submission.turn, session },
  };
}

export async function manualSubmission(
  intent: DeepReadonly<ManualTurnIntent>,
  resolveRuntimeIdentity?: CoordinatorDependencies["resolveProjectToolsRuntimeIdentity"]
) {
  if (intent.payload === undefined) {
    throw new Error("ManualTurnIntent 已压缩，不再包含可执行 payload");
  }
  return hydratePreparedTurn(intent.payload as PreparedManualTurn, resolveRuntimeIdentity);
}

export async function userMessagePersisted(
  chats: ChatsService,
  conversationId: string,
  messageId: string
) {
  return Boolean(await chats.store.getNativeMessage(conversationId, {
    kind: "id",
    messageId,
  }));
}

export async function assertManualPrecondition(
  submission: ManualTurnSubmission,
  ledger: RelayLedger,
  chats: ChatsService
) {
  const precondition = submission.precondition;
  const conversationId = manualConversationId(submission.persistence);
  const current = chats.store.getMetadata(conversationId);
  const tombstone = ledger.read((state) => state.tombstones[conversationId]);
  if (precondition.kind === "existing") {
    if (
      !current ||
      current.incarnationId !== precondition.incarnationId ||
      tombstone?.incarnationId === precondition.incarnationId
    ) {
      throw new Error("INCARNATION_MISMATCH");
    }
    return;
  }
  const proposed =
    submission.persistence.kind === "append"
      ? undefined
      : submission.persistence.input.incarnationId;
  // absent→create 的崩溃恢复幂等：createUserChat 落盘后、ledger
  // transition 前崩溃，重放看到的是自己创建的 incarnation——按
  // existing(P) 放行，交给 persistManual 的 canonical-user 短路续走。
  //
  // 收养一条已存在的只读 Chat 也只走这一条：代际是收养沿用的那一个，
  // 于是「已存在且同代」就是它的全部合法形态。曾经另设一条只比对
  // id/projectId/agent 的旁路——那条旁路恰恰只在代际不符时才会被走到，
  // 也就是只在该拒绝的时候放行。
  if (current?.incarnationId === precondition.proposedIncarnationId) {
    if (tombstone?.incarnationId === precondition.proposedIncarnationId) {
      throw new Error("INCARNATION_MISMATCH");
    }
    return;
  }
  if (
    current ||
    tombstone ||
    (proposed && proposed !== precondition.proposedIncarnationId)
  ) {
    throw new Error("INCARNATION_MISMATCH");
  }
}

export async function allocateManualSequences(
  chats: ChatsService,
  submission: ManualTurnSubmission
) {
  const conversationId = manualConversationId(submission.persistence);
  const record = chats.store.getMetadata(conversationId);
  if (
    submission.persistence.kind === "adopt" &&
    record?.readOnlyReason === "external-readonly"
  ) {
    return { userSeq: 1, assistantSeq: 2 };
  }
  if (!record) {
    if (submission.persistence.kind === "append") {
      throw new Error("人工 turn 的目标聊天不存在");
    }
    return { userSeq: 1, assistantSeq: 2 };
  }
  if (submission.agentSwitch) {
    return chats.store.reserveAgentSwitchSequences(switchReservationInput(submission));
  }
  const [userSeq, assistantSeq] = await chats.store.reserveSequences(
    conversationId,
    2
  );
  return { userSeq: userSeq!, assistantSeq: assistantSeq! };
}

export async function ensureManualSequences(
  chats: ChatsService,
  ledger: RelayLedger,
  intent: DeepReadonly<ManualTurnIntent>
) {
  if (intent.userSeq !== undefined && intent.assistantSeq !== undefined) {
    return { userSeq: intent.userSeq, assistantSeq: intent.assistantSeq };
  }
  const hydrated = await manualSubmission(intent);
  const sequence = await allocateManualSequences(chats, hydrated.submission);
  await ledger.bindManualSequences(
    intent.id,
    sequence.userSeq,
    sequence.assistantSeq
  );
  return sequence;
}

async function persistManual(
  chats: ChatsService,
  persistence: ManualTurnPersistence,
  userSeq: number,
  assistantSeq: number,
  projectLifecycleHeld: boolean,
  turn: Omit<AgentSendPayload, "input">
) {
  const chatId = manualConversationId(persistence);
  const expected = manualUserMessage(persistence);
  const stored = await chats.store.getNativeMessage(chatId, {
    kind: "id",
    messageId: expected.id,
  });
  if (stored?.role === "user") {
    if (!sameManualUser(expected, stored, persistence)) {
      throw new Error("ManualTurnIntent 与 canonical user 冲突");
    }
    if (persistence.kind !== "append") {
      await chats.commitCreationById(chatId);
    }
    return stored;
  }
  if (persistence.kind === "create") {
    const record = await chats.createUserChat(
      persistence.input,
      { userSeq, assistantSeq },
      projectLifecycleHeld ? "held" : undefined
    );
    await chats.commitCreationById(persistence.input.id);
    return record.messages[0] as UserChatMessage;
  }
  if (persistence.kind === "create-app") {
    const record = await chats.createAppChat(
      persistence.input,
      { userSeq, assistantSeq },
      projectLifecycleHeld ? "held" : undefined
    );
    await chats.commitCreationById(persistence.input.id);
    return record.messages[0] as UserChatMessage;
  }
  if (persistence.kind === "adopt") {
    const record = await chats.createAdoptedChat(
      persistence.input,
      { userSeq, assistantSeq },
      projectLifecycleHeld ? "held" : undefined,
      turn
    );
    await chats.commitCreationById(persistence.input.id);
    return record.messages[0] as UserChatMessage;
  }
  return chats.appendUserMessage(persistence.input, userSeq);
}

function sameManualUser(
  expected: UserChatMessage | Omit<UserChatMessage, "seq">,
  stored: UserChatMessage,
  persistence: ManualTurnPersistence
) {
  return (
    stored.content === expected.content &&
    stored.createdAt === expected.createdAt &&
    manualAttachmentsMatch(expected, stored, persistence)
  );
}

function sameAttachmentMetas(
  expected: readonly ChatAttachmentMeta[],
  stored: readonly ChatAttachmentMeta[]
) {
  return (
    expected.length === stored.length &&
    expected.every((attachment, index) => {
      const candidate = stored[index];
      return (
        candidate?.id === attachment.id &&
        candidate.filename === attachment.filename &&
        candidate.mediaType === attachment.mediaType &&
        candidate.byteSize === attachment.byteSize
      );
    })
  );
}

function manualAttachmentsMatch(
  expected: UserChatMessage | Omit<UserChatMessage, "seq">,
  stored: UserChatMessage,
  persistence: ManualTurnPersistence
) {
  const storedAttachments = stored.attachments ?? [];
  if (persistence.kind === "append" && persistence.input.revise) {
    return true;
  }
  if (expected.attachments !== undefined) {
    return sameAttachmentMetas(expected.attachments, storedAttachments);
  }
  const payloads = persistence.input.attachmentPayloads ?? [];
  const ids = new Set<string>();
  return (
    payloads.length === storedAttachments.length &&
    payloads.every((payload, index) => {
      const candidate = storedAttachments[index];
      if (
        !candidate ||
        !ATTACHMENT_ID_PATTERN.test(candidate.id) ||
        ids.has(candidate.id)
      ) {
        return false;
      }
      ids.add(candidate.id);
      return (
        candidate.filename === payload.filename &&
        candidate.mediaType === payload.mediaType &&
        candidate.byteSize === dataUrlByteSize(payload.dataUrl)
      );
    })
  );
}

function durableTurnOrigin(
  userMessage: { id: string; content: string }
): TurnOrigin {
  return {
    kind: "manual",
    queryText: userMessage.content,
    userText: userMessage.content,
    userMessageId: userMessage.id,
  };
}

/** recoveryInput 只在现有输入前加文本；resolved 资源尾段保持原 custody。 */
export function resolvedInputForFinalPayload(
  finalInput: AgentUserInput[],
  originalInput: AgentUserInput[],
  resolved: ResolvedAgentInput
): ResolvedAgentInput {
  const prefixLength = finalInput.length - originalInput.length;
  if (
    prefixLength < 0 ||
    JSON.stringify(finalInput.slice(prefixLength)) !==
      JSON.stringify(originalInput)
  ) {
    throw new Error("最终 Agent input 与 prepared input 无法对齐");
  }
  const prefix: ResolvedAgentInput["input"] = finalInput
    .slice(0, prefixLength)
    .map((item) => {
      if (item.type === "text" || item.type === "image") return item;
      throw new Error("恢复上下文前缀只能包含文本或图片");
    });
  return {
    ...resolved,
    input: [
      ...prefix,
      ...resolved.input,
    ],
  };
}

function notifyManualPersisted(
  dependencies: ManualTurnDependencies,
  submission: ManualTurnSubmission,
  record: Pick<ChatRecord, "id" | "incarnationId">,
  message: UserChatMessage
) {
  const notify = dependencies.onManualPersisted;
  if (!notify) return;
  try {
    notify({
      chatId: record.id,
      incarnationId: record.incarnationId,
      messageId: message.id,
      content: submission.content,
    });
  } catch (cause) {
    console.warn(
      `[section-coordinator] manual=${submission.intentId} 落盘派生通知失败`,
      cause
    );
  }
}

export async function runManualTurn(
  intent: DeepReadonly<ManualTurnIntent>,
  dependencies: ManualTurnDependencies,
  projectLifecycleHeld = false
) {
  const hydrated = await manualSubmission(intent, dependencies.resolveProjectToolsRuntimeIdentity);
  const submission = bindAdoptedSessionPlan(hydrated.submission, {
    planDigest: hydrated.projectTools.sessionPlanDigest,
    projectId: hydrated.projectTools.receipt.projectContext.projectId,
  });
  const expected = manualUserMessage(submission.persistence);
  const prepared = intent.payload as PreparedManualTurn;
  const currentProjectId = await manualLifecycleProjectId(
    submission,
    dependencies.chats
  );
  if (
    currentProjectId !== prepared.lifecycleProjectId ||
    (currentProjectId !== null && !projectLifecycleHeld)
  ) {
    throw new Error("WORKSPACE_PRECONDITION_MISMATCH");
  }
  await assertManualWorkspacePrecondition(submission, {
    chats: dependencies.chats,
    getProjectWorkspaceSnapshot: dependencies.getProjectWorkspaceSnapshot,
  });
  dependencies.assertProjectToolsContext?.(
    hydrated.projectTools.receipt.projectContext
  );
  if (intent.userSeq === undefined || intent.assistantSeq === undefined) {
    throw new Error("ManualTurnIntent 缺少持久消息序号");
  }
  if (intent.phase === "queued") {
    await assertManualPrecondition(
      submission,
      dependencies.ledger,
      dependencies.chats
    );
    if (prepared.switchCommand) {
      const own = switchEligibility(dependencies as CoordinatorDependencies, intent.conversationId, { ownIntentId: intent.id });
      // Receipt replay must precede current-state policy after a successful commit.
      const current = dependencies.chats.store.getMetadata(intent.conversationId);
      if (!own.eligible && current?.agentRevision === prepared.switchCommand.intent.expectedAgentRevision) {
        throw new Error(`AGENT_SWITCH_BLOCKED:${own.reason}`);
      }
      await dependencies.chats.commitAgentSwitch(prepared.switchCommand, submission.persistence.input.attachmentPayloads ?? []);
    } else {
    await persistManual(
      dependencies.chats,
      submission.persistence.kind === "append" ? submission.persistence : {
        ...submission.persistence,
        input: { ...submission.persistence.input, options: submission.turn.turnOptions },
      } as ManualTurnPersistence,
      intent.userSeq,
      intent.assistantSeq,
      projectLifecycleHeld,
      submission.turn
    );
    }
    const appended = await dependencies.ledger.transitionManual(
      intent.id,
      "queued",
      "appended"
    );
    if (!appended) return;
  }
  if (prepared.switchCommand) {
    const committed = dependencies.chats.store.getMetadata(intent.conversationId);
    if (committed?.agentRevision === prepared.switchCommand.intent.expectedAgentRevision + 1 && !committed.session) {
      await dependencies.onAgentSwitchCommitted?.(intent.conversationId);
    }
  }
  const record = dependencies.chats.store.getMetadata(intent.conversationId);
  if (!record) throw new Error("人工 turn 的目标聊天不存在");
  const expectedIncarnationId =
    submission.precondition.kind === "existing"
      ? submission.precondition.incarnationId
      : submission.precondition.proposedIncarnationId;
  if (
    record.id !== intent.conversationId ||
    record.id !== manualConversationId(submission.persistence) ||
    record.incarnationId !== expectedIncarnationId
  ) {
    throw new Error("ManualTurnIntent 与 canonical chat identity 冲突");
  }
  const stored = await dependencies.chats.store.getNativeMessage(record.id, {
    kind: "id",
    messageId: expected.id,
  });
  if (!stored || stored.role !== "user") {
    throw new Error("ManualTurnIntent 已标记 appended，但 canonical user 缺失");
  }
  if (!sameManualUser(expected, stored, submission.persistence)) {
    throw new Error("ManualTurnIntent 与 canonical user 冲突");
  }
  notifyManualPersisted(dependencies, submission, record, stored);
  const turnOptions = submission.agentSwitch || submission.persistence.kind !== "append"
    ? submission.turn.turnOptions : record.options;
  let session = record.session;
  if (
    session &&
    (!session.toolPlan ||
      session.toolPlan.planDigest !== hydrated.projectTools.sessionPlanDigest ||
      session.toolPlan.projectId !==
        hydrated.projectTools.receipt.projectContext.projectId)
  ) {
    if (isOriginalAdoptedBinding(record)) {
      throw new Error(
        "SESSION_TOOL_PLAN_REBUILD_FAILED: adopted session cannot be replaced safely"
      );
    }
    if (dependencies.rebuildSessionForTools) {
      await dependencies.rebuildSessionForTools(record.id, session);
    } else {
      await dependencies.chats.replaceSession(
        submission.turn.scope,
        session,
        null
      );
    }
    session = null;
  }
  const history = submission.turn.handoff ? null : await dependencies.chats.store.prepareHistory(record.id, intent.userSeq);
  const frozen = submission.turn.handoff ?? (history ? buildHandoff(history, submission.turn.input,
    hydrated.projectTools.receipt.allowedTools.includes("read_chat_history") ? "available" : "unavailable") : undefined);
  const handoff = frozen ? { ...frozen, binding: { ...frozen.binding, view: {
    ...frozen.binding.view, nativeMessageRevision: record.chatMessageRevision,
  } } } : undefined;
  const payload: AgentSendPayload = {
    ...submission.turn, agentRevision: record.agentRevision, handoff,
    preparedSkillSelection: prepared.skillSelection,
    ...(session ? { session } : { session: undefined }),
    input: session ? submission.turn.input : handoffInput(submission.turn.input, handoff),
    turnOptions,
  };
  const resolvedInput = resolvedInputForFinalPayload(
    payload.input,
    submission.turn.input,
    hydrated.resolvedInput
  );
  taskStartFence.assertOpen();
  const claimed = await dependencies.ledger.transitionManual(
    intent.id,
    "appended",
    "claimed"
  );
  if (!claimed) return;
  await dependencies.ledger.markManualDispatching(intent.id);
  try {
    /* projectLifecycleHeld 同时喂给 persistManual 与 startTurn：
       同一把 projects 锁,创建侧靠它跳过 withProject 重入,启动侧靠它跳过
       withConversationAdmission 重入。漏掉后者 = admission 持锁等 startTurn、
       startTurn 等同一把锁,IPC 悬死,renderer 三症并发(不跳转/草稿残留/无响应)。 */
    await dependencies.startTurn(
      payload,
      stableId("assistant", intent.id),
      durableTurnOrigin(expected),
      resolvedInput,
      intent.assistantSeq,
      projectLifecycleHeld,
      hydrated.projectTools
    );
    await dependencies.ledger.markManualDispatched(intent.id);
  } catch (cause) {
    if (cause instanceof StartDeferredError) {
      await dependencies.ledger.deferManualDispatch(intent.id);
      throw cause;
    }
    await dependencies.ledger.markManualDispatchUnknown(intent.id);
    throw cause;
  }
}
