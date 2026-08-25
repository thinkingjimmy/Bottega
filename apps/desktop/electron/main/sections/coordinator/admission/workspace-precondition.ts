/**
 * [INPUT]: Depends on shared WorkspacePrecondition/ManualTurnSubmission, canonical ChatStore and Project binding/revision snapshot
 * [OUTPUT]: Provides manual/Steer current Workspace owner Projects, lifecycle Project affiliates, strict CAS and root/chat-home also accessed universal lifecycle gate helper
 * [POS]: The coordinator/admission of the Workspace identity authority; The renderer is only frozen by the owner, the main is only canonically determined by the facts
 */

import type { ChatRecord } from "../../../../../shared/chats-ipc";
import type { ProjectWorkspaceBinding } from "../../../../../shared/projects-ipc";
import type { TrustedManualTurnSubmission as ManualTurnSubmission } from "../../../../../shared/sections-ipc";
import {
  workspacePreconditionSchema,
  type WorkspacePrecondition,
} from "../../../../../shared/submission";
import type { ChatsService } from "../../../chats/chats-service";

export type ProjectWorkspaceSnapshot = Readonly<{
  membershipRevision: number;
  workspaceBinding: ProjectWorkspaceBinding;
}>;

type WorkspacePreconditionDependencies = {
  chats: ChatsService;
  getProjectWorkspaceSnapshot?: (
    projectId: string
  ) => ProjectWorkspaceSnapshot | undefined;
};

type ConversationWorkspaceDependencies = WorkspacePreconditionDependencies & {
  withWorkspaceLifecycle: <T>(task: () => Promise<T>) => Promise<T>;
};

const chatHome = (record: Pick<ChatRecord, "id" | "incarnationId">) => ({
  kind: "chat-home" as const,
  conversationId: record.id,
  incarnationId: record.incarnationId,
});

function projectSnapshot(
  projectId: string,
  dependencies: WorkspacePreconditionDependencies
) {
  const snapshot = dependencies.getProjectWorkspaceSnapshot?.(projectId);
  if (!snapshot) throw new Error("WORKSPACE_PRECONDITION_MISMATCH");
  return snapshot;
}

function projectOwner(
  projectId: string,
  dependencies: WorkspacePreconditionDependencies
): WorkspacePrecondition {
  return {
    kind: "project",
    projectId,
    membershipRevision: projectSnapshot(projectId, dependencies)
      .membershipRevision,
  };
}

function conversationOwner(
  record: ChatRecord,
  dependencies: WorkspacePreconditionDependencies
): WorkspacePrecondition {
  if (!record.projectId) return chatHome(record);
  const project = projectSnapshot(record.projectId, dependencies);
  return project.workspaceBinding.kind === "none"
    ? chatHome(record)
    : {
        kind: "project",
        projectId: record.projectId,
        membershipRevision: project.membershipRevision,
      };
}

function sameOwner(
  expected: WorkspacePrecondition,
  current: WorkspacePrecondition
) {
  if (expected.kind !== current.kind) return false;
  if (expected.kind === "default") return true;
  if (expected.kind === "app") {
    return current.kind === "app" && expected.appId === current.appId;
  }
  if (expected.kind === "project") {
    return (
      current.kind === "project" &&
      expected.projectId === current.projectId &&
      expected.membershipRevision === current.membershipRevision
    );
  }
  return (
    current.kind === "chat-home" &&
    expected.conversationId === current.conversationId &&
    expected.incarnationId === current.incarnationId
  );
}

export async function manualLifecycleProjectId(
  submission: ManualTurnSubmission,
  chats: ChatsService
) {
  if (submission.persistence.kind !== "append") {
    return submission.persistence.input.projectId ?? null;
  }
  const record = await chats.store.get(submission.persistence.input.chatId);
  if (!record) throw new Error("人工 turn 的目标聊天不存在");
  return record.projectId;
}

export async function assertManualWorkspacePrecondition(
  submission: ManualTurnSubmission,
  dependencies: WorkspacePreconditionDependencies
) {
  const expected = workspacePreconditionSchema.parse(
    submission.workspacePrecondition
  );
  let current: WorkspacePrecondition;
  if (submission.persistence.kind === "append") {
    const record = await dependencies.chats.store.get(
      submission.persistence.input.chatId
    );
    if (!record) throw new Error("WORKSPACE_PRECONDITION_MISMATCH");
    current = conversationOwner(record, dependencies);
  } else if (submission.persistence.kind === "create-app") {
    const project = projectSnapshot(
      submission.persistence.input.projectId,
      dependencies
    );
    const binding = project.workspaceBinding;
    if (
      binding.kind !== "app" ||
      binding.appId !== submission.persistence.input.appId
    ) {
      throw new Error("WORKSPACE_PRECONDITION_MISMATCH");
    }
    current = { kind: "app", appId: binding.appId };
  } else if (submission.persistence.input.projectId) {
    current = projectOwner(
      submission.persistence.input.projectId,
      dependencies
    );
  } else {
    current = { kind: "default" };
  }
  if (!sameOwner(expected, current)) {
    throw new Error("WORKSPACE_PRECONDITION_MISMATCH");
  }
}

export async function assertConversationWorkspacePrecondition(
  conversationId: string,
  expectedValue: WorkspacePrecondition,
  dependencies: WorkspacePreconditionDependencies
) {
  const expected = workspacePreconditionSchema.parse(expectedValue);
  const record = await dependencies.chats.store.get(conversationId);
  if (!record || !sameOwner(expected, conversationOwner(record, dependencies))) {
    throw new Error("WORKSPACE_PRECONDITION_MISMATCH");
  }
  return record;
}

export async function withConversationWorkspacePrecondition<T>(
  conversationId: string,
  expected: WorkspacePrecondition,
  dependencies: ConversationWorkspaceDependencies,
  task: (record: ChatRecord) => Promise<T>
) {
  const run = async () =>
    task(
      await assertConversationWorkspacePrecondition(
        conversationId,
        expected,
        dependencies
      )
    );
  /* 生产端口背后是 Projects 全局排他队列，不是 per-project mutex。
     root/chat-home 同样必须入队，否则 CAS 通过后仍可被 convert/rebind 穿插。 */
  return dependencies.withWorkspaceLifecycle(run);
}
