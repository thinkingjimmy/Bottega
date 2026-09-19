/**
 * [INPUT]: Depends on the reader channel openers and cold readers, the supervisor's parked-channel registration and the shared quota timing.
 * [OUTPUT]: Keeps at most one warm reader process per Agent, reused across reads and closed on release, preemption, identity change or a failure it could not carry.
 * [POS]: The process-lifetime layer between the quota source and its readers; readers stay transports, the service keeps owning demand.
 */
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { LIMITS_TIMING, type QuotaReason } from "../../../shared/usage-limits/types";
import { registerAgentQuotaChannel } from "../agent-process-supervisor";
import type { ResolvedRuntime } from "../backends/types";
import { quotaChannels, quotaReaders } from "./readers";
import { QuotaReadError, type QuotaChannel, type QuotaChannelOpener, type QuotaReadResult, type QuotaReader } from "./readers/common";

/** Quota demand for one Agent: warm while wanted, on the idle clock once released, gone when closed. */
export type QuotaDemandState = "wanted" | "released" | "closed";
export type QuotaChannelPool = {
  read(backend: AgentBackendId, runtime: ResolvedRuntime, identity: string, signal: AbortSignal): Promise<QuotaReadResult>;
  demand(backend: AgentBackendId, state: QuotaDemandState): Promise<void>;
};
export type QuotaChannelPoolOptions = {
  channels?: Partial<Record<AgentBackendId, QuotaChannelOpener>>;
  readers?: Partial<Record<AgentBackendId, QuotaReader>>;
  register?: typeof registerAgentQuotaChannel;
  schedule?: (action: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};
type Lane = {
  state: QuotaDemandState;
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
  const openers = options.channels ?? quotaChannels;
  const readers = options.readers ?? quotaReaders;
  const register = options.register ?? registerAgentQuotaChannel;
  const schedule = options.schedule ?? ((action: () => void, delay: number) => { const timer = setTimeout(action, delay); timer.unref?.(); return timer; });
  const cancelTimer = options.cancelTimer ?? clearTimeout;
  const lanes = new Map<AgentBackendId, Lane>();
  /* A lane that was never told about demand starts on the idle clock, never warm forever:
     a read that arrives without a demand report (a manual refresh racing the first reconcile)
     still leaves a process whose lifetime is bounded. */
  const laneOf = (backend: AgentBackendId) => {
    let lane = lanes.get(backend);
    if (!lane) lanes.set(backend, lane = { state: "released" });
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
    lane.timer ??= schedule(() => { lane.timer = undefined; void close(lane); }, LIMITS_TIMING.channelIdleMs);
  }
  return {
    async read(backend, runtime, identity, signal) {
      const opener = openers[backend];
      if (!opener) {
        const reader = readers[backend];
        if (!reader) throw new QuotaReadError("unsupported");
        return reader(runtime, signal);
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
      if (!lane.channel) { lane.channel = await opener(runtime, signal); lane.identity = identity; }
      try {
        const result = await lane.channel.read(signal);
        park(backend, lane);
        return result;
      } catch (cause) {
        if (!signal.aborted && cause instanceof QuotaReadError && CARRIED.has(cause.reason)) park(backend, lane);
        else await close(lane);
        throw cause;
      }
    },
    async demand(backend, state) {
      const lane = laneOf(backend);
      if (lane.state === state) return;
      lane.state = state;
      if (state === "wanted") disarm(lane);
      else if (state === "released") { if (lane.parked) arm(lane); }
      else await close(lane);
    },
  };
}
