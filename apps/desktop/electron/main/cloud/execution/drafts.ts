/**
 * [INPUT]: Depends on main-owned account/Chat identities and atomic bounded local JSON persistence.
 * [OUTPUT]: Preserves continuation text across claims, failures and process restarts with revision fencing.
 * [POS]: Local user draft owner; namespaced drafts are retained independently of disposable cloud byte caches.
 */
import { join } from "node:path";
import { lstat } from "node:fs/promises";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { executionDraftSchema, type ExecutionDraft } from "../../../../shared/cloud/execution";
import { DurableJson, isErrnoCode } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";
export class ExecutionDraftStore {
  private readonly queue = new SerialQueue();
  constructor(private readonly userData: string, private readonly config: CloudBuildConfig) {}
  access(identity: { userId: string; chatId: string; incarnationId: string }, current: () => void, change?: { expectedRevision: number; text: string }): Promise<ExecutionDraft> {
    return this.queue.enqueue(async () => {
      current();
      const path = join(this.userData, "cloud-chat-drafts", hashChatContent([this.config.environmentId, this.config.deploymentId, identity]) + ".json");
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 256 * 1024) throw new Error("EXECUTION_DRAFT_UNAVAILABLE");
      } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
      const file = new DurableJson(path, executionDraftSchema, () => ({ revision: 0, text: "" })); await file.initialize(); current();
      if (!change) return file.snapshot();
      return file.mutate(draft => {
        current(); if (draft.text === change.text) return draft;
        if (draft.revision !== change.expectedRevision) throw new Error("EXECUTION_DRAFT_CHANGED");
        draft.text = change.text; draft.revision++; return draft;
      });
    });
  }
  async close() { this.queue.close(); await this.queue.flush(); }
}
