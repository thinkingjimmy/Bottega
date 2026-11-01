/**
 * [INPUT]: Original Chat options, live source/view authority, independent candidate directory and existing Provider registry/bridge/custody.
 * [OUTPUT]: runNativeCandidateJob admits one same-model ordinary native turn with the isolated candidate purpose.
 * [POS]: Main-only candidate execution adapter; it cannot publish source, supply MCP credentials or fall back to another Provider.
 */
import type { ChatTurnOptions } from "../../../../shared/chat-agent/options";
import { backendRuntimeRegistry, requireProvider } from "../../backends";
import { runOneShotTurn } from "../../backends/jobs/one-shot-turn";
export async function runNativeCandidateJob(input: { chatId: string; incarnationId: string; requestId: string; root: string;
  prompt: string; options: ChatTurnOptions; guard(): void; signal: AbortSignal }) {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(180_000)]);
  const selection = structuredClone(input.options);
  if (selection.backend !== "codex") throw new Error("This Provider does not support isolated candidate editing yet");
  const descriptor = requireProvider(selection.backend), registry = backendRuntimeRegistry;
  input.guard(); signal.throwIfAborted();
  const snapshot = await registry.refreshIfNeeded(descriptor.id);
  const plan = { cwd: input.root, model: selection.model };
  if (snapshot.runtimeStatus !== "installed" || (await registry.operationEligibility(descriptor.id, "artifact-candidate", plan, snapshot)).decision !== "allow")
    throw new Error("Candidate editing needs a qualified signed-in Provider on the original computer");
  const current = () => {
    signal.throwIfAborted(); input.guard();
    if (registry.current(descriptor.id)?.generation !== snapshot.generation) throw new Error("Candidate Provider identity changed");
  };
  const validate = async () => {
    current();
    if (!await registry.confirmForSpawn(descriptor.id, snapshot, signal) ||
      (await registry.operationEligibility(descriptor.id, "artifact-candidate", plan, snapshot)).decision !== "allow") throw new Error("Candidate Provider admission expired");
    current();
  };
  const evidence = registry.evidence.beginTurn("artifact-candidate:" + input.requestId, input.requestId, await registry.executionTarget(descriptor.id, snapshot, plan));
  try {
    const answer = await runOneShotTurn({ descriptor, runtime: snapshot.runtime, workspace: input.root,
      requestId: input.requestId, prompt: input.prompt, model: selection.model, timeoutMs: 180_000, signal,
      candidate: { chatId: input.chatId, incarnationId: input.incarnationId, authority: { validate, current }, options: selection } });
    await validate(); registry.evidence.finish(evidence, "success"); return { answer, provider: descriptor.id, model: selection.model };
  } catch (cause) {
    const kind = descriptor.classifyFailure(cause).kind;
    registry.evidence.finish(evidence, kind === "auth-required" ? "auth-required" : kind === "usage-limit" ? "usage-limit" : "service"); throw cause;
  }
}
