/**
 * [INPUT]: Main-frozen edit payload, original Chat registry/context/callbacks and qualified dedicated Provider factory.
 * [OUTPUT]: Binds one restricted edit to the original turn, child cleanup barrier, Stop and persisted reply pipeline.
 * [POS]: Main bridge composition; no ordinary createTurn, view lease or secondary Chat is created.
 */
import type { AgentSendPayload } from "../../../../shared/ipc/agent/agent-ipc";
import type { AgentTurn, AgentTurnCallbacks, ResolvedAgentInput, TrustedTurnAuthority, ProviderBackend } from "../../backends/contracts/types";
import type { AgentContext, AgentBridgeOptions, BridgeEntry } from "../../agent/bridge/bridge-types";
import type { TurnRegistry } from "../../agent/turns/turn/turn-registry";
import { requireNativeCandidateProvider } from "../native/candidate-job";
import { createArtifactChatTurn } from "./turn";
import { runArtifactChatEdit } from "./job";
export async function spawnArtifactChatEdit(input: { entry: BridgeEntry; payload: AgentSendPayload; context: AgentContext; options: AgentBridgeOptions;
  resolved?: ResolvedAgentInput; authority?: TrustedTurnAuthority; turns: TurnRegistry<AgentTurn>; publishState(entry: BridgeEntry): void;
  callbacks(backend: ProviderBackend, generation: number): AgentTurnCallbacks }) {
  const { entry, payload } = input, edit = payload.artifactEdit;
  if (!edit || !input.resolved || entry.origin?.kind !== "manual" || edit.chatId !== entry.conversationId || edit.incarnationId !== entry.incarnationId || edit.requestId !== entry.requestId) throw new Error("Artifact edit requires its original accepted Chat turn");
  await input.authority?.validate(); await input.options.assertTurnAdmission?.(payload, input.authority);
  const { descriptor, snapshot } = await requireNativeCandidateProvider(payload.turnOptions), generation = entry.generation;
  const callbacks = input.callbacks(descriptor, snapshot.generation);
  const current = () => { input.authority?.current(); if (entry.generation !== generation || entry.childController.signal.aborted) throw new Error("Original Chat edit is no longer active"); };
  const turn = createArtifactChatTurn({ requestId: entry.requestId, signal: entry.childController.signal,
    run: (signal, handoff) => runArtifactChatEdit({ edit, options: payload.turnOptions, instruction: entry.origin?.kind === "manual" ? entry.origin.userText : "",
      originalInput: input.resolved!.input, messageId: entry.messageId, signal, handoff, current }),
    answer: text => callbacks.onItem({ itemId: "artifact-edit-" + entry.requestId, kind: "agent-message", title: "Replied", status: "completed", text }),
    terminal: event => callbacks.onTerminal(event) });
  input.turns.bindTurn(entry, turn, input.resolved);
  input.turns.registerChild(entry, { abort: () => turn.interrupt(), settled: turn.settled });
  await turn.start(entry.childController.signal);
  if (input.turns.activate(entry)) input.publishState(entry);
}
