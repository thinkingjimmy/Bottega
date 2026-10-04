/**
 * [INPUT]: Depends on Node crypto, the headless job/run types, the shared EventQueue, the bridge protocol (BridgedWork, headless start/outcome) and the installed ProviderBridgeRuntime
 * [OUTPUT]: Provides runBridgedHeadless: main's half of every headless job — it seals the launch the executor prepared on an execution ref (host custody, through the guardian), answers the bridge's stdin request once the process is recorded, applies its live items, and settles the process through its owner; a process recorded after the job stopped (an abort landing mid-spawn) is settled at once, and the exit is recorded only after its register hook settled
 * [POS]: The executor's only path (TASK-11 D8, flip). Admission, lease, credential reservation, `spec()`, the fence and the spec's release stay with the executor; this owns the job's lifecycle (deadline, abort, cancel, the process-group hooks, release after the owner's settle, the exit error with main-redacted stderr) and returns a HeadlessRun
 */
import { randomUUID } from "node:crypto";
import type { BackendDescriptor, HeadlessJob, HeadlessParserState, HeadlessRun, ResolvedRuntime, TurnProcessOwner } from "../../../backends/types";
import type { CleanupResult } from "../../../agent/process/process-group";
import { EventQueue } from "../../../backends/jobs/output";
import type { BridgeHeadlessOutcome, BridgeTurnEvent, BridgeTurnRequest, BridgedWork } from "../protocol";
import { requireProviderBridge } from "../runtime";

type Completion = { ok: true; value: CleanupResult } | { ok: false; error: Error };
const asError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

export function runBridgedHeadless(input: {
  descriptor: BackendDescriptor;
  job: HeadlessJob;
  runtime: ResolvedRuntime;
  /** The launch the executor prepared and fenced (`spec()` + Seatbelt, or the backend's own sandbox). */
  launch: { command: string; args: string[]; env: NodeJS.ProcessEnv };
  stdin: string;
  signal: AbortSignal;
  releaseSpec(): Promise<Error | undefined>;
  /** Main holds the environment, so main turns the raw stderr tail into evidence. */
  stderrEvidence(tail: string): string;
}): HeadlessRun {
  const { descriptor, job } = input;
  const providers = requireProviderBridge();
  const queue = new EventQueue<HeadlessParserState["events"][number]>();
  const turnKey = randomUUID();
  let owner: TurnProcessOwner | null = null, outcome: BridgeHeadlessOutcome | undefined;
  let terminalError: Error | undefined, lifecycleError: Error | undefined, stopping = false, live = true, ownerClosed = false;
  let bound!: (value: TurnProcessOwner) => void;
  const ownerBound = new Promise<TurnProcessOwner>(resolve => { bound = resolve; });
  const recordLifecycleError = (hook: string, cause: unknown) => {
    const error = new Error(`${job.purpose} ${hook} hook 失败：${asError(cause).message}`);
    lifecycleError ??= error; terminalError ??= error; return error;
  };
  /* As in-process: the process is recorded (onProcessGroup) before the prompt reaches it. */
  const groupReady = ownerBound.then(async (process) => {
    if (!job.onProcessGroup) return { ok: true as const };
    try { await job.onProcessGroup(process.identity.pid); return { ok: true as const }; }
    catch (cause) { return { ok: false as const, error: recordLifecycleError("onProcessGroup", cause) }; }
  });
  void groupReady.then(outcome => { if (!outcome.ok) void finalize(); });

  const work: BridgedWork = {
    providerId: descriptor.id,
    turnKey,
    apply(event: BridgeTurnEvent) { if (event.k === "headless-event" && !stopping) queue.push(event.event as HeadlessParserState["events"][number]); },
    async request(request: BridgeTurnRequest) {
      if (request.k !== "headless-stdin") throw new Error(`a headless run answers no ${request.k} request`);
      const ready = await groupReady;
      if (!ready.ok || stopping) throw new Error("headless run is stopping");
      return input.stdin;
    },
    bridgeLost(reason: string) { terminalError ??= new Error(`Provider bridge stopped: ${reason}`); void finalize(); },
  };

  let resolveCompletion!: (value: Completion) => void;
  const completion = new Promise<Completion>(resolve => { resolveCompletion = resolve; });
  let finalization: Promise<void> | undefined;
  const finalize = () => {
    stopping = true;
    finalization ??= (async () => {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", onAbort);
      /* The owner (host custody) ends the whole group; a job that never got a process has nothing to end, and forgetting it
         revokes its execution ref, so a spawn still on its way is refused. */
      ownerClosed = true;
      const settled = owner ? await owner.settle().catch(() => "unconfirmed" as const) : "released";
      const cleanup: CleanupResult = settled === "released" ? { ok: true } : { ok: false, error: new Error(`process ${owner?.identity.pid} was not confirmed ended`) };
      live = false;
      providers.forget(work as never);
      /* The exit pairs with a completed register: a pending onProcessGroup hook settles first, and a failed one records no exit. */
      const group = owner ? await groupReady : { ok: true as const };
      if (cleanup.ok && owner && group.ok && job.onProcessExit) {
        try { await job.onProcessExit(owner.identity.pid); } catch (cause) { recordLifecycleError("onProcessExit", cause); }
      }
      const releaseError = await input.releaseSpec();
      if (releaseError) recordLifecycleError("release", releaseError);
      queue.end();
      const errors = [...(lifecycleError ? [lifecycleError] : []), ...(!cleanup.ok ? [cleanup.error] : [])];
      resolveCompletion(errors.length > 1 ? { ok: false, error: new AggregateError(errors, `${descriptor.displayName} headless 生命周期与清理失败`) }
        : errors[0] ? { ok: false, error: errors[0] } : { ok: true, value: cleanup });
    })();
    return finalization;
  };
  const onAbort = () => { terminalError ??= asError(input.signal.reason ?? new DOMException("headless 已取消", "AbortError")); void finalize(); };
  const timeout = setTimeout(() => { terminalError ??= new Error(`${job.purpose} 超过 ${job.timeoutMs}ms`); void finalize(); }, job.timeoutMs);
  input.signal.addEventListener("abort", onAbort, { once: true });
  if (input.signal.aborted) onAbort();

  const principal = providers.turnPrincipal({ chatId: `headless:${job.purpose}`, incarnationId: "headless" }, `headless-${turnKey}`, turnKey, () => live);
  void (async () => {
    const host = await providers.ensure(descriptor.id, principal, input.runtime, { prove: false });
    if (stopping) return;
    const ref = providers.issue(principal, { launch: { command: input.launch.command, args: [...input.launch.args], cwd: job.cwd, env: input.launch.env },
      bind: (process) => {
        /* A process recorded after the job stopped (an abort landing mid-spawn) is settled at once; nothing else would end it. */
        if (ownerClosed) { void process.settle(); return; }
        owner = process; bound(process);
      } }, work as never);
    outcome = await host.invoke("headless.run", { turnKey, backend: descriptor.id, wantsJson: Boolean(job.outputSchema) }, [ref]) as BridgeHeadlessOutcome;
  })().then(() => finalize(), (cause) => { terminalError ??= asError(cause); void finalize(); });

  const settled = completion.then(value => { if (!value.ok) { queue.end(); throw value.error; } return value.value; });
  const result = settled.then(() => {
    if (terminalError) throw terminalError;
    if (!outcome) throw new Error(`${descriptor.displayName} headless produced no outcome`);
    if (outcome.spawnError) throw new Error(outcome.spawnError);
    if (outcome.limitError) throw new Error(outcome.limitError);
    if (outcome.code !== 0) {
      const evidence = input.stderrEvidence(outcome.stderrTail);
      throw new Error(`${descriptor.displayName} headless 退出（code=${String(outcome.code)}, signal=${outcome.signal ?? "null"}）${evidence ? `：${evidence}` : ""}`);
    }
    if (outcome.state.error) throw new Error(outcome.state.error);
    return { text: outcome.state.text, ...(outcome.state.json === undefined ? {} : { json: outcome.state.json }) };
  });
  void settled.catch(() => undefined);
  void result.catch(() => undefined);
  return {
    events: queue,
    result,
    settled,
    cancel: async () => {
      terminalError ??= new Error(`${job.purpose} 已取消`);
      await finalize();
      await settled.catch(() => undefined);
    },
  };
}
