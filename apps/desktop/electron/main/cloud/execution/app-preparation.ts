/**
 * [INPUT]: Depends on a Chat's cloud head, its local metadata and its Project.
 * [OUTPUT]: Provides appChatReadiness: whether an App Use or Edit Chat still matches its App and whether the server's ready must be requested.
 * [POS]: cloud/execution's pure rule for App Chats (U06-b 1b); service.ts runs it before asking the server for ready.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatRecord } from "../../../../shared/ipc/content/chats-ipc";

type Head = { chat: Pick<CloudChatHead["chat"], "id" | "incarnationId" | "classification">; executionPreparation: CloudChatHead["executionPreparation"] };
type Local = Pick<ChatRecord, "incarnationId" | "readOnlyReason" | "archivedAt" | "context" | "projectId">;
type Project = { archivedAt?: number | null; workspaceBinding: { kind: string; appId?: string } };
/**
 * An App Chat is always this computer's own native Chat (made here, never moved), so its local record is the truth and there is nothing to
 * fetch. It is ready once that record and its App's Project still name the head's App; "prepare" asks the server for its explicit ready,
 * which a native head starts without.
 */
export function appChatReadiness(head: Head, local: Local | null, project: Project | null, deviceId: string): "ready" | "prepare" {
  const classification = head.chat.classification;
  if (!local || local.incarnationId !== head.chat.incarnationId || local.readOnlyReason || local.archivedAt || local.context.kind !== classification.conversationKind ||
    local.context.kind === "ordinary" || local.context.appId !== classification.appId) throw new Error("EXECUTION_IDENTITY_CHANGED");
  if (local.projectId !== null && local.projectId !== undefined) {
    const binding = project?.workspaceBinding;
    if (!project || project.archivedAt || binding?.kind !== "app" || binding.appId !== classification.appId) throw new Error("PROJECT_WORKSPACE_PREPARATION_REQUIRED");
  }
  const preparation = head.executionPreparation;
  return preparation?.state === "ready" && preparation.deviceId === deviceId ? "ready" : "prepare";
}
