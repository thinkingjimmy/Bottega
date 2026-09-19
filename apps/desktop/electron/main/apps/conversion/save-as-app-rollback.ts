/**
 * [INPUT]: Depends on the admitted lifecycle journal and original App/Project/Chat compensation ports.
 * [OUTPUT]: Resumes four durable compensation phases after rejection or a journaled account-cleanup preservation decision.
 * [POS]: Save as App compensation leaf; cloud callers must prove rejection before entering it.
 */
import type { SaveAsAppDependencies } from "./save-as-app";
import type { LifecycleIntent } from "../../lifecycle/intent-types";
import { reached } from "../../lifecycle/intent-types";
import type { SagaResult } from "../../lifecycle/admission-gate";
import { isRollbackPhase, recoveryStringOrNull, recoverySession, rollbackError, rejected, type SaveIdentity } from "./save-as-app-support";
import { canonicalJson } from "../../../../shared/local-storage/contracts";
export async function rollbackSaveAsApp(
    dependencies: SaveAsAppDependencies,
    initial: LifecycleIntent,
    input: { chatId: string },
    identity: SaveIdentity,
    error: { code: string; message: string },
    preserveUnchangedChat = false
  ): Promise<SagaResult> {
    let intent = initial;
    if (!isRollbackPhase(intent.phase)) {
      intent = await dependencies.intents.advance(
        intent.intentId,
        "rollback-started",
        { rollbackError: error }
      );
    }
    const terminalError = rollbackError(intent, error);
    // A missing source Chat does not prevent removal of this conversion's local shell.
    const chat = dependencies.chats.getMetadata(input.chatId);

    if (!reached("save-as-app", intent, "rollback-chat-restored")) {
      if (chat) {
        const originalProjectId = recoveryStringOrNull(
          intent,
          "originalProjectId",
          chat.projectId
        );
        const originalSession = recoverySession(intent);
        if (preserveUnchangedChat && (chat.projectId !== originalProjectId || originalSession.recorded &&
          canonicalJson(chat.session) !== canonicalJson(originalSession.value))) throw new Error("CONVERSION_CLEANUP_SOURCE_CHANGED");
        if (!preserveUnchangedChat && chat.projectId === identity.projectId) {
          await dependencies.projects.moveChatProjectHeld(
            chat.id,
            identity.projectId,
            originalProjectId,
            null
          );
        } else if (chat.projectId !== originalProjectId) {
          throw new Error("Chat ownership changed before rollback");
        }
        const restoredChat = dependencies.chats.getMetadata(chat.id);
        if (!restoredChat) throw new Error("Chat is unavailable after rollback");
        if (!preserveUnchangedChat && originalSession.recorded) {
          await dependencies.restoreSession(
            restoredChat,
            originalSession.value
          );
        }
      }
      intent = await dependencies.intents.advance(
        intent.intentId,
        "rollback-chat-restored"
      );
    }

    if (!reached("save-as-app", intent, "rollback-project-removed")) {
      await dependencies.projects.rollbackAppProjectHeld(
        identity.projectId,
        identity.appId
      );
      intent = await dependencies.intents.advance(
        intent.intentId,
        "rollback-project-removed"
      );
    }

    if (!reached("save-as-app", intent, "rollback-shell-removed")) {
      const record = dependencies.store.get(identity.appId);
      if (record) await dependencies.removeShell(record);
      await dependencies.intents.advance(
        intent.intentId,
        "rollback-shell-removed"
      );
    }
    return rejected(terminalError.code, terminalError.message);
  }
