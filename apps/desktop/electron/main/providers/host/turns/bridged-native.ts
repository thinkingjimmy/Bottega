/**
 * [INPUT]: Uses an explicit main-owned Provider identity, ProviderBridgeRuntime, a main-sealed launch and guardian-backed process ownership.
 * [OUTPUT]: Exports readNativeModels, a bounded native model query whose cleanup failure takes precedence over its result or query error.
 * [POS]: Main-side model discovery owner; no protocol parsing or direct subprocess spawn.
 */
import { randomUUID } from "node:crypto";
import type { AgentProcessLaunch, ResolvedRuntime, TurnProcessOwner } from "../../../backends/contracts/types";
import type { Model } from "../../codex/native/schema";
import type { BridgedWork } from "../protocol";
import { requireProviderBridge } from "../runtime";
import { reportAgentCleanupFailure } from "../../../agent-process-supervisor";

export async function readNativeModels(providerId: string, runtime: ResolvedRuntime, launch: AgentProcessLaunch, signal: AbortSignal): Promise<Model[]> {
  const providers = requireProviderBridge(), turnKey = randomUUID();
  let live = true, owner: TurnProcessOwner | null = null;
  const work: BridgedWork = { providerId, turnKey, apply() {}, request: async () => { throw new Error("Model discovery has no turn requests"); }, bridgeLost() {} };
  const principal = providers.turnPrincipal({ chatId: `models:${providerId}`, incarnationId: "models" }, `models-${turnKey}`, turnKey, () => live);
  let host: Awaited<ReturnType<typeof providers.ensure>> | undefined;
  const abort = () => { void host?.invoke("native.models.cancel", { turnKey }, []).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  let outcome: { models: Model[] } | { error: unknown };
  try {
    signal.throwIfAborted();
    host = await providers.ensure(providerId, principal, runtime, { prove: false });
    signal.throwIfAborted();
    const ref = providers.issue(principal, { launch, bind: value => { owner = value; } }, work);
    const result = await host.invoke("native.models", { turnKey, backend: providerId }, [ref]);
    signal.throwIfAborted();
    outcome = { models: result as Model[] };
  } catch (error) {
    outcome = { error };
  } finally {
    signal.removeEventListener("abort", abort); live = false;
    await host?.invoke("native.models.cancel", { turnKey }, []).catch(() => undefined);
    const process = owner as TurnProcessOwner | null;
    const settlement = process ? await process.settle().catch(() => "unconfirmed" as const) : "released";
    providers.forget(work);
    if (settlement !== "released") {
      const error = new Error("Native model discovery cleanup unconfirmed");
      reportAgentCleanupFailure(providerId, error);
      outcome = { error };
    }
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.models;
}
