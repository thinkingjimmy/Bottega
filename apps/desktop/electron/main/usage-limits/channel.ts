/**
 * [INPUT]: Depends on each Provider's quota hook (its channel opener and cold reader, from its descriptor), the supervisor's parked-channel registration and the shared quota timing.
 * [OUTPUT]: Keeps at most one warm reader process per Agent, reused across reads and closed on release (after the idle the demand set: interactive or the 30-second prefetch idle), preemption, identity change or a failure it could not carry; a warm process that died while parked is replaced once within the same read.
 * [POS]: The process-lifetime layer between the quota source and its readers; readers stay transports, the service keeps owning demand.
 */
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import { LIMITS_TIMING, type QuotaReason } from "../../../shared/usage-limits/types";
import { registerAgentQuotaChannel } from "../agent-process-supervisor";
import type { ResolvedRuntime } from "../backends/types";
import { quotaHookFor } from "../backends";
import { QuotaReadError, type QuotaChannel, type QuotaChannelOpener, type QuotaReadResult, type QuotaReader } from "./readers/common";

/** How long a reader started only by a prefetch may wait for a person to ask (C-09). */
export const PREFETCH_IDLE_MS = 30_000;
/** Quota demand for one Agent: warm while wanted, on the idle clock once released, gone when closed. */
export type QuotaDemandState = "wanted" | "released" | "closed";
export type QuotaChannelPool = {
  read(backend: AgentBackendId, runtime: ResolvedRuntime, identity: string, signal: AbortSignal): Promise<QuotaReadResult>;
  /** `idleMs` is how long a released lane's process may wait for the next read (default: the interactive idle). */
  demand(backend: AgentBackendId, state: QuotaDemandState, idleMs?: number): Promise<void>;
};
export type QuotaChannelPoolOptions = {
  /** Test seams; by default each Provider's own quota hook answers. */
  channels?: Partial<Record<string, QuotaChannelOpener>>;
  readers?: Partial<Record<string, QuotaReader>>;
  register?: typeof registerAgentQuotaChannel;
  schedule?: (action: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};
type Lane = {
  state: QuotaDemandState;
  idleMs: number;
  identity?: string;
  channel?: QuotaChannel;
  /** Present only while the channel is parked: a read owns it the rest of the time. */
  parked?: { release(): void };
  timer?: ReturnType<typeof setTimeout>;
  closing?: Promise<void>;
};
/* The channel survives only a failure it carried itself: a provider answer that happens to be
   a refusal costs nothing to keep, while a cancelled, timed-out or unreachable read leaves a
   process whose state nobody can vouch for -- and a terminal reason means nobody asks again. */
const CARRIED: ReadonlySet<QuotaReason> = new Set<QuotaReason>(["rate-limited", "invalid-response"]);

export function createQuotaChannelPool(options: QuotaChannelPoolOptions = {}): QuotaChannelPool {
  const openerFor = (backend: AgentBackendId) => options.channels ? options.channels[backend] : quotaHookFor(backend)?.channel;
  const readerFor = (backend: AgentBackendId) => options.readers ? options.readers[backend] : quotaHookFor(backend)?.read;
  const register = options.register ?? registerAgentQuotaChannel;
  const schedule = options.schedule ?? ((action: () => void, delay: number) => { const timer = setTimeout(action, delay); timer.unref?.(); return timer; });
  const cancelTimer = options.cancelTimer ?? clearTimeout;
  const lanes = new Map<AgentBackendId, Lane>();
  /* A lane that was never told about demand starts on the idle clock, never warm forever:
     a read that arrives without a demand report (a manual refresh racing the first reconcile)
     still leaves a process whose lifetime is bounded. */
  const laneOf = (backend: AgentBackendId) => {
    let lane = lanes.get(backend);
    if (!lane) lanes.set(backend, lane = { state: "released", idleMs: LIMITS_TIMING.channelIdleMs });
    return lane;
  };
  const disarm = (lane: Lane) => {
    if (lane.timer !== undefined) cancelTimer(lane.timer);
    lane.timer = undefined;
  };
  function close(lane: Lane) {
    disarm(lane);
    const channel = lane.channel, parked = lane.parked;
    if (!channel) return lane.closing ?? Promise.resolve();
    lane.channel = undefined; lane.identity = undefined; lane.parked = undefined;
    /* The registration is surrendered only once the process group is gone: it is what holds
       an interactive lease back, so releasing it earlier would hand the account over to a
       turn while this process still had it. */
    const closing = channel.close().catch(() => undefined).finally(() => {
      parked?.release();
      if (lane.closing === closing) lane.closing = undefined;
    });
    return lane.closing = closing;
  }
  /* Parking is what makes the next read cheap and what makes the process answerable while no
     lease covers it: from here a turn takes it away, the idle clock ends it, or a read claims it. */
  function park(backend: AgentBackendId, lane: Lane) {
    if (!lane.channel) return;
    if (lane.state === "closed") { void close(lane); return; }
    lane.parked = register(backend, () => close(lane));
    if (lane.state === "released") arm(lane);
  }
  function arm(lane: Lane) {
    lane.timer ??= schedule(() => { lane.timer = undefined; void close(lane); }, lane.idleMs);
  }
  const pool: QuotaChannelPool = {
    async read(backend, runtime, identity, signal) {
      const opener = openerFor(backend);
      if (!opener) {
        const reader = readerFor(backend);
        if (!reader) throw new QuotaReadError("unsupported");
        return reader(backend, runtime, signal);
      }
      const lane = laneOf(backend);
      disarm(lane);
      if (lane.channel && lane.identity !== identity) await close(lane);
      await lane.closing;
      /* Reads are singleflighted per Agent by the service and run under its quota lease, so
         claiming the parked channel is unconditional here -- and while the read runs, that
         lease is the barrier a turn waits on, exactly as it does for a cold read. */
      lane.parked?.release(); lane.parked = undefined;
      signal.throwIfAborted();
      const reused = Boolean(lane.channel);
      if (!lane.channel) { lane.channel = await opener(backend, runtime, signal); lane.identity = identity; }
      try {
        const result = await lane.channel.read(signal);
        park(backend, lane);
        return result;
      } catch (cause) {
        const carried = !signal.aborted && cause instanceof QuotaReadError && CARRIED.has(cause.reason);
        if (carried) park(backend, lane);
        else await close(lane);
        /* A warm process can die while parked (its CLI exited, its bridge went away): that costs one fresh process, not an error.
           Only a broken transport qualifies; a verdict the CLI gave (signed out, unsupported) is the answer, not a dead process. */
        const dead = !(cause instanceof QuotaReadError) || cause.reason === "unavailable";
        if (reused && dead && !signal.aborted) return pool.read(backend, runtime, identity, signal);
        throw cause;
      }
    },
    async demand(backend, state, idleMs = LIMITS_TIMING.channelIdleMs) {
      const lane = laneOf(backend);
      /* A shorter idle takes effect at once; a longer one waits for the next release instead of extending a clock. */
      if (idleMs < lane.idleMs && lane.timer !== undefined) { disarm(lane); lane.idleMs = idleMs; if (lane.state === "released" && lane.parked) arm(lane); }
      lane.idleMs = idleMs;
      if (lane.state === state) return;
      lane.state = state;
      if (state === "wanted") disarm(lane);
      else if (state === "released") { if (lane.parked) arm(lane); }
      else await close(lane);
    },
  };
  return pool;
}
