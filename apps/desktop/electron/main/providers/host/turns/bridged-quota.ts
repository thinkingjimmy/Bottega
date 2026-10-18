/**
 * [INPUT]: Depends on Node crypto, the process supervisor's admission check and cleanup report, the quota reader ports (workspace, finite errors, abort race), the bridge protocol (BridgedWork, BridgeQuotaAnswer) and the installed ProviderBridgeRuntime
 * [OUTPUT]: Provides bridgedQuotaChannel(launch): a QuotaChannelOpener (told its Provider per open) whose process is main's sealed launch in host custody and whose protocol runs on the Provider's bridge; a read answers the normalized result or throws the reader's finite reason, and close ends the process through its owner before the channel's registration is surrendered
 * Cancellation drains an in-flight open and settles an owner that binds after cancellation before releasing registration/workspace.
 * [POS]: The quota readers' branch for a bridged Provider (TASK-11 D9). Admission, the quota lease, warm-channel parking and the identity stay with the pool and service unchanged; this only replaces who starts the process (the guardian, not a detached spawn) and who speaks to it (the bridge)
 */
import { randomUUID } from "node:crypto";
import { assertAgentProcessAdmission, reportAgentCleanupFailure } from "../../../agent-process-supervisor";
import type { ResolvedRuntime, TurnProcessOwner } from "../../../backends/contracts/types";
import { openQuotaWorkspace, QuotaReadError, whenAborted, type QuotaChannelOpener, type QuotaReadResult } from "../../../usage-limits/readers/common";
import type { BridgeQuotaAnswer, BridgedWork } from "../protocol";
import { requireProviderBridge } from "../runtime";

type Launch = { relayOutput?: "base64"; command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv };
const answered = (answer: BridgeQuotaAnswer) => {
  if (!answer.ok) throw new QuotaReadError(answer.reason, answer.retryAfterMs);
  return answer.result;
};

export function bridgedQuotaChannel(launch: (runtime: ResolvedRuntime, cwd: string) => Launch): QuotaChannelOpener {
  return async (backend, runtime, signal) => {
    signal.throwIfAborted();
    assertAgentProcessAdmission(backend);
    const providers = requireProviderBridge();
    const workspace = await openQuotaWorkspace();
    const turnKey = randomUUID();
    let owner: TurnProcessOwner | null = null, lost: string | null = null, live = true;
    const work: BridgedWork = { providerId: backend, turnKey, apply() {},
      request: async (request) => { throw new Error(`a quota channel answers no ${request.k} request`); },
      bridgeLost: (reason) => { lost = reason; } };
    let closing: Promise<void> | undefined;
    let opening: Promise<BridgeQuotaAnswer> | undefined;
    let host: Awaited<ReturnType<typeof providers.ensure>> | undefined;
    /* As in-process: the registration is surrendered only once the process group is gone (the pool releases it after close). */
    const close = () => closing ??= (async () => {
      live = false;
      await host?.invoke("quota.close", { turnKey }, []).catch(() => undefined);
      if (opening) {
        await opening.catch(() => undefined);
        await host?.invoke("quota.close", { turnKey }, []).catch(() => undefined);
      }
      const settled = owner ? await owner.settle().catch(() => "unconfirmed" as const) : "released";
      if (settled !== "released") {
        const error = new Error("Quota process cleanup failed");
        reportAgentCleanupFailure(backend, error);
        throw error;
      }
      providers.forget(work);
      await workspace.release().catch(() => undefined);
    })();
    try {
      const principal = providers.turnPrincipal({ chatId: `quota:${backend}`, incarnationId: "quota" }, `quota-${turnKey}`, turnKey, () => live);
      host = await Promise.race([providers.ensure(backend, principal, runtime, { prove: false }), whenAborted(signal)]);
      const { command, args, cwd, env, relayOutput } = launch(runtime, workspace.cwd);
      const ref = providers.issue(principal, { launch: { command, args: [...args], cwd, env, relayOutput }, bind: (process) => {
        owner = process;
        if (!live) void process.settle().catch(() => undefined);
      } }, work);
      opening = host.invoke("quota.open", { turnKey, backend }, [ref]) as Promise<BridgeQuotaAnswer>;
      answered(await Promise.race([opening, whenAborted(signal)]));
      opening = undefined;
    } catch (cause) { await close().catch(() => undefined); throw cause; }
    const bridge = host;
    return {
      async read(readSignal: AbortSignal): Promise<QuotaReadResult> {
        if (lost) throw new QuotaReadError("unavailable");
        const result = answered(await Promise.race([bridge.invoke("quota.read", { turnKey }, []) as Promise<BridgeQuotaAnswer>, whenAborted(readSignal)]));
        if (!result) throw new QuotaReadError("invalid-response");
        return result;
      },
      close,
    };
  };
}
