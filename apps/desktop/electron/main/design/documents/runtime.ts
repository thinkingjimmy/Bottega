/**
 * [INPUT]: Main Chat identities, effective workspace authority, canonical message publication and Artifact v1 custody.
 * [OUTPUT]: Initialized document owner, canonical Artifact delivery and exact Chat retention/Fork wiring under main workspace authority.
 * [POS]: Startup document composition; no renderer-supplied owner or automatic old ledger loading.
 */
import { join, relative, resolve as resolvePath, sep } from "node:path";
import { encodeArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { ChatAgentId } from "../../../../shared/chat-agent/options";
import type { ChatStore } from "../../chats/chat-store";
import type { ChatsService } from "../../chats/service/chats-service";
import type { EffectiveWorkspaceResolver } from "../../workspace/files/workspace-resolver";
import { artifactRuntime } from "../../artifacts/core/runtime";
import { assertArtifactAdmission } from "../../artifacts/admission/state";
import { DesignDocumentError } from "./model";
import { DesignDocuments } from "./service";

let current: DesignDocuments | undefined;
export const designDocuments = () => {
  if (!current) throw new Error("Design documents are not initialized");
  return current;
};
export async function initializeDesignDocuments(userData: string, chats: ChatStore, service: ChatsService, resolveWorkspace: EffectiveWorkspaceResolver) {
  const resolve: import("./service").DesignDocumentPorts["resolve"] = (chatId, incarnationId) => {
    if (chats.getIncarnationId(chatId) !== incarnationId) throw new DesignDocumentError("PATH_DENIED", "Design lease belongs to an expired Chat");
    const workspace = resolveWorkspace({ kind: "conversation", conversationId: chatId });
    if (workspace.kind !== "ready") throw new DesignDocumentError("PATH_DENIED", "Chat workspace is unavailable");
    if (chats.getIncarnationId(chatId) !== incarnationId) throw new DesignDocumentError("PATH_DENIED", "Chat changed during authorization");
    return { chatId, incarnationId, workspace: workspace.workspace, ownerId: workspace.stableWorkspaceOwnerId,
      authorityIdentity: workspace.authorityIdentity };
  };
  current = new DesignDocuments(join(userData, "artifact-design"), {
    assertAdmission: assertArtifactAdmission, resolve,
    async deliver(revision, data) {
      const artifacts = artifactRuntime();
      if (!artifacts) throw new Error("Artifact custody is unavailable");
      const ref = { chatId: revision.authority.chatId, incarnationId: revision.authority.incarnationId, artifactId: revision.artifactId };
      await artifacts.retainDocument(ref, revision.fence, revision.messageId, data);
      if (JSON.stringify(resolve(ref.chatId, ref.incarnationId)) !== JSON.stringify(revision.authority))
        throw new DesignDocumentError("PATH_DENIED", "Chat workspace authority changed before document delivery");
      await service.appendCanonical(ref.chatId, { id: revision.messageId, role: "assistant", content: encodeArtifactFence(revision.fence),
        createdAt: revision.createdAt, backend: revision.backend as ChatAgentId, completion: "complete" });
    },
  });
  await current.initialize();
  const documents = current;
  artifactRuntime()?.configureDesignRetention((chatId, incarnationId) => documents.releaseChat(chatId, incarnationId));
  artifactRuntime()?.configureDesignFork((sourceChatId, sourceIncarnationId, child, artifactIds) => documents.fork(sourceChatId, sourceIncarnationId, child.id, child.incarnationId, artifactIds));
  artifactRuntime()?.configureDesignDelivery((chatId, incarnationId, path) => {
    documents.authority(chatId, incarnationId);
    const source = resolvePath(path);
    return documents.store.operations().filter(operation => operation.state === "complete" && operation.revision.authority.chatId === chatId && operation.revision.authority.incarnationId === incarnationId)
      .map(operation => operation.revision).sort((a, b) => b.revision - a.revision)
      .find(version => { const name = relative(resolvePath(version.authority.workspace, version.path), source); return name !== "" && !name.startsWith(".." + sep) && name !== ".." && !name.startsWith(sep); })?.fence;
  });
  return current;
}
export async function closeDesignDocuments() { const owner = current; current = undefined; await owner?.close(); }
