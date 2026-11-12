/**
 * [INPUT]: Depends on Coordinator lifecycle, prepared input, retired tool settings, and manual-turn dispatch ports.
 * [OUTPUT]: Provides manual dispatch with deferred scheduling, attempt cleanup, and recovery for requests with retired tool settings.
 * [POS]: Coordinator execution adapter extracted from the facade to keep ownership explicit.
 */
import { StartDeferredError } from "../../../presence/lifecycle/start-fence";
import { isChatMutationOutcomeUnknown } from "../../../chats/chat-store";
import { manualUserMessage, runManualTurn, userMessagePersisted } from "../turns/manual-turns";
import type { PreparedManualTurn } from "../admission/prepared-manual-turn";
import { RetiredProjectToolSettingsError } from "../admission/prepared-project-tools";
import { cleanupManualCreation, type CoordinatorDependencies } from "../coordinator-runtime";
export async function dispatchManual(intent: Parameters<typeof runManualTurn>[0], projectLifecycleHeld: boolean,
  ports: { dependencies: CoordinatorDependencies; release(id: string): void; kick(id: string): void }) {
    try {
      await runManualTurn(intent, ports.dependencies, projectLifecycleHeld);
      return true;
    } catch (cause) {
      if (cause instanceof StartDeferredError) {
        ports.release(intent.conversationId);
        ports.kick(intent.conversationId);
        return false;
      }
      if (isChatMutationOutcomeUnknown(cause)) {
        ports.dependencies.chats.store.pushWarning(
          `Manual ${intent.id} 的 SQLite commit 结果未知；operationId=${cause.operationId}，已停止补偿与自动重试，等待 receipt 恢复。`
        );
        ports.release(intent.conversationId);
        return true;
      }
      const current = ports.dependencies.ledger.read(
        (state) => state.manualIntents[intent.id]
      );
      if (
        current?.payload !== undefined &&
        ["queued", "appended"].includes(current.phase)
      ) {
        const preserveChat = cause instanceof RetiredProjectToolSettingsError && (
          current.phase === "appended" ||
          (current.userSeq !== undefined && await userMessagePersisted(
            ports.dependencies.chats,
            current.conversationId,
            manualUserMessage((current.payload as PreparedManualTurn).persistence).id
          ))
        );
        if (preserveChat && current.phase === "queued") {
          await ports.dependencies.ledger.transitionManual(current.id, "queued", "appended");
        }
        await cleanupManualCreation(ports.dependencies, current, { preserveChat }).catch(
          (cleanupCause) => {
            ports.dependencies.chats.store.pushWarning(
              `Manual ${current.id} 创建补偿待重试：${String(cleanupCause)}`
            );
          }
        );
        await ports.dependencies.ledger.transitionManual(
          current.id,
          ["queued", "appended"],
          "failed"
        );
      }
      ports.release(intent.conversationId);
      ports.kick(intent.conversationId);
      console.error(
        `[section-coordinator] manual=${intent.id} 调度失败`,
        cause
      );
      return true;
    }
}
