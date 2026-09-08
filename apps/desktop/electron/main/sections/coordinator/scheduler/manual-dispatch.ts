/**
 * [INPUT]: Depends on Coordinator lifecycle, staging, prepared input, model options, and manual-turn dispatch ports.
 * [OUTPUT]: Provides the admitted manual task handler with attempt-scoped cleanup and deferred scheduling.
 * [POS]: Coordinator execution adapter extracted from the facade to keep ownership explicit.
 */
import { StartDeferredError } from "../../../presence/lifecycle/start-fence";
import { isChatMutationOutcomeUnknown } from "../../../chats/chat-store";
import { runManualTurn } from "../manual-turns";
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
        await cleanupManualCreation(ports.dependencies, current).catch(
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
