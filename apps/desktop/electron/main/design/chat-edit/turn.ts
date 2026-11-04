/**
 * [INPUT]: Original Chat/request abort signal, one owned restricted job and original-turn output/terminal callbacks.
 * [OUTPUT]: A single-start AgentTurn whose Stop and settled barrier cover the same job through cleanup.
 * [POS]: Original Chat lifecycle adapter; it invokes no ordinary Provider turn or view-owned candidate service.
 */
import type { AgentTurn, AgentTurnCallbacks } from "../../backends/contracts/types";
import type { PromptHandoff } from "../../../../shared/ipc/agent/agent-ipc";
export function createArtifactChatTurn(input: { requestId: string; signal: AbortSignal;
  run(signal: AbortSignal, handoff: (value: Promise<PromptHandoff>) => void): Promise<string | { text: string; confirmed: true }>;
  answer(text: string): void; terminal: AgentTurnCallbacks["onTerminal"] }): AgentTurn & { settled: Promise<void> } {
  const controller = new AbortController(), signal = AbortSignal.any([input.signal, controller.signal]);
  let started = false, done!: () => void, handoffSet = false, handoffDone!: (value: PromptHandoff) => void;
  const settled = new Promise<void>(resolve => { done = resolve; });
  const handoff = new Promise<PromptHandoff>(resolve => { handoffDone = resolve; });
  const turn: AgentTurn & { settled: Promise<void> } = {
    pid: undefined, steeringSupported: false, settled,
    promptHandoff: () => handoff,
    async start(startupSignal) {
      if (started) return "started"; started = true;
      if (startupSignal?.aborted) controller.abort(startupSignal.reason);
      void (async () => {
        try {
          signal.throwIfAborted();
          const result = await input.run(signal, value => { if (handoffSet) return; handoffSet = true; void value.then(handoffDone, () => handoffDone({ kind: "pending" })); });
          if (signal.aborted && typeof result === "string") signal.throwIfAborted();
          input.answer(typeof result === "string" ? result : result.text); input.terminal({ type: signal.aborted ? "cancelled" : "done" });
        } catch (cause) { input.terminal(signal.aborted ? { type: "cancelled" } : { type: "error", message: cause instanceof Error ? cause.message : "Artifact edit failed" }); }
        finally { if (!handoffSet) handoffDone({ kind: "not-created" }); done(); }
      })();
      return "started";
    },
    async respondApproval() { throw new Error("Restricted Artifact edits cannot grant approvals"); },
    interrupt() { controller.abort(new Error("Original Chat stopped this edit")); },
    markStopped() { controller.abort(new Error("Original Chat settled")); },
  };
  return turn;
}
