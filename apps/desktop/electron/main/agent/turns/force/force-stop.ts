/**
 * [INPUT]: Depends on the bridge's live turn registry and cancel, the host-custody launch identity (pid + birth) of a turn, and process-group's birth-checked signalOwnedGroup / cleanOwnedProcessGroup.
 * [OUTPUT]: Provides launchIdentityOf (a live turn's one launch identity; a bridged turn's is its host-custody owner's, B2-01), agentTurnProcess (what still holds a request's process: the live turn, else the outer custody's recoverable entry with an identity, else host custody's entry for the request (a bridged turn), else the outer intent, else none),
 *           verifyForceStoppedGroup (the check on a group left unconfirmed) and forceKillAgentTurn: SIGKILL the whole process group of one live turn only by its launch identity — adapter, CLI and MCP children — then confirm within a short deadline that the group is gone.
 * [POS]: apps/desktop/electron/main/agent/turns/force; Workflow Force stop (06 §8): the one path that ends a turn whose Agent ignores cancel. The normal cancel still runs, so
 *        custody and the Chat record settle the usual way; this only makes sure nothing of the turn keeps running.
 */
import { cancelAgentTurn, turns } from "../../bridge/agent-bridge";
import type { LaunchIdentity } from "../../../backends/jobs/custody/agent-turn-custody-runtime";
import { observeProcessBirth } from "../../../custody/identity";
import { cleanOwnedProcessGroup, groupExists, signalOwnedGroup, wait } from "../../process/process-group";
import { blocksNewTurn } from "../turn/turn-registry-model";
import type { BridgeEntry } from "../../bridge/bridge-types";

/** `group`: the process group Force stop could not confirm gone, by pid + birth, so a later check can prove what became of it. */
export type RecordedGroup = LaunchIdentity;
export type ForceKillOutcome = { outcome: "gone" | "absent" } | { outcome: "survived"; group: RecordedGroup | null };

/* A refused signal comes back as `refused`: neither stopped nor an error; the next identity check judges the group again. */
const SIGNAL = { probe: observeProcessBirth, exists: groupExists, signal: (pid: number) => { process.kill(-pid, "SIGKILL"); } };

/**
 * The one launch identity of a live turn: its host-custody owner's (every turn is bridged, B2-01). Null before it is owned.
 */
export function launchIdentityOf(entry: BridgeEntry): LaunchIdentity | null {
  return entry.turn?.processOwner?.()?.identity ?? null;
}

/**
 * What still holds a request's process: a live turn by its launch identity, else custody's recoverable entry (after a restart,
 * whatever startup reconcile left). `none` only when neither holds anything: custody records intent before any spawn.
 */
type HeldBy = { heldBy(requestId: string): { identity: LaunchIdentity | null } | null } | null;
export function agentTurnProcess(requestId: string, custody: HeldBy, hostCustody: HeldBy = null):
  { state: "none" } | { state: "held"; group: RecordedGroup | null } {
  const entry = turns.byRequest(requestId) as BridgeEntry | undefined;
  if (entry && blocksNewTurn(entry)) return { state: "held", group: launchIdentityOf(entry) };
  /* A bridged turn's outer Agent custody is an intent with no identity (and none after a restart); its process is host custody's,
     found by the same request (the bridge-enable gate). */
  const outer = custody?.heldBy(requestId) ?? null;
  if (outer?.identity) return { state: "held", group: outer.identity };
  const hosted = hostCustody?.heldBy(requestId) ?? null;
  if (hosted) return { state: "held", group: hosted.identity };
  return outer ? { state: "held", group: null } : { state: "none" };
}

/**
 * Force stop: SIGKILL the turn's whole process group, only by its launch identity (B-01) — a PID reused since, or a turn not yet
 * owned, is never signalled — then confirm within a short deadline that the group is gone.
 */
export async function forceKillAgentTurn(requestId: string, deadlineMs = 5_000): Promise<ForceKillOutcome> {
  const entry = turns.byRequest(requestId) as BridgeEntry | undefined;
  if (!entry || !blocksNewTurn(entry)) return { outcome: "absent" };
  signalOwnedGroup(launchIdentityOf(entry), SIGNAL);
  cancelAgentTurn(requestId);
  for (const deadline = Date.now() + deadlineMs; ;) {
    /* A turn still starting may become owned meanwhile; one never owned is gone once the cancel has settled it. */
    const identity = launchIdentityOf(entry);
    if (identity ? ["gone", "reused"].includes(signalOwnedGroup(identity, SIGNAL)) : !blocksNewTurn(entry)) return { outcome: "gone" };
    if (Date.now() >= deadline) return { outcome: "survived", group: identity };
    await wait(100);
  }
}

/**
 * The one check both a retried Force stop and startup make on a group left unconfirmed (06 §8): gone, or its pid now another
 * process, is ended; still ours, it is killed and must then be gone; with no identity recorded nothing can be proven.
 */
export async function verifyForceStoppedGroup(group: RecordedGroup | null): Promise<"gone" | "survived" | "unknown"> {
  if (!group) return "unknown";
  const result = await cleanOwnedProcessGroup(group);
  return result.verdict === "unverified" || !result.ok ? "survived" : "gone";
}
