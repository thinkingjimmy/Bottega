/**
 * [INPUT]: Depends on original TurnRegistry identities and the sole coordinator ledger transaction owner.
 * [OUTPUT]: Serializes local/remote decisions, preserves proven unsent retries, reports poisoned interactions and checks the original deadline immediately before dispatch.
 * [POS]: Shared control adapter behind existing bridge handlers; no backend control logic is duplicated.
 */
import { randomUUID } from "node:crypto";
import type { AgentTurn } from "../../backends/types";
import type { TurnEntry } from "../../turn-registry";
import type { RelayLedger } from "../../sections/coordinator/relay-ledger";
import type { RemoteContext } from "../../sections/coordinator/remote/model";
import { canonicalHash } from "../../sections/coordinator/coordinator-values";
export type TrustedControl = { remote: RemoteContext; generation?: number; authority?: import("../../backends/types").TrustedTurnAuthority; current(): void | Promise<void> };
import type { InteractionSource } from "@ai-chat/cloud-protocol/turns/live";
import type { ControlResult } from "../../../../shared/agent-ipc";
export type { ControlResult } from "../../../../shared/agent-ipc";
type Invocation = { generation?: number; entry: TurnEntry<AgentTurn>; key: string; payload: unknown; trusted?: TrustedControl;
  verify(): void; apply(): void | Promise<unknown> };
export class DurableAgentControls {
  private readonly flights = new Map<string, { hash: string; interaction: string; promise: Promise<ControlResult> }>();
  constructor(private readonly ledger: RelayLedger, private readonly localSource?: () => InteractionSource) {}
  generation(entry: TurnEntry<AgentTurn>, key: string) {
    return this.ledger.read(state => Object.values(state.controlReceipts).find(value => value.conversationId === entry.conversationId &&
      value.incarnationId === entry.incarnationId && value.requestId === entry.requestId && value.key === key && value.state !== "not-dispatched")?.generation) ?? entry.generation;
  }
  /** True when a settled non-applied receipt owns this interaction: replaying the key can only yield `outcome-unknown`. */
  unresolved(entry: TurnEntry<AgentTurn>, key: string, generation: number) {
    return this.ledger.read(state => Object.values(state.controlReceipts).some(value => value.conversationId === entry.conversationId &&
      value.incarnationId === entry.incarnationId && value.requestId === entry.requestId && value.key === key && value.generation === generation &&
      value.state !== "not-dispatched" && value.state !== "applied"));
  }
  assertOrigin(id: string, trusted?: TrustedControl) {
    const remote = this.ledger.remote.control(id)?.remote;
    if (remote && (!trusted || canonicalHash(remote) !== canonicalHash(trusted.remote))) throw new Error("REMOTE_CONTROL_REQUIRES_TRUSTED_REPLAY");
  }
  run(input: Invocation): Promise<ControlResult> {
    const id = input.trusted?.remote.origin.commandId ?? randomUUID(), previous = this.flights.get(id), generation = input.generation ?? input.entry.generation;
    const hash = canonicalHash({ conversationId: input.entry.conversationId, requestId: input.entry.requestId,
      incarnationId: input.entry.incarnationId, generation, key: input.key, payload: input.payload, remote: input.trusted?.remote });
    if (previous) return previous.hash === hash ? previous.promise : Promise.reject(new Error("REMOTE_CONTROL_IDENTITY_CONFLICT"));
    const interaction = canonicalHash([input.entry.conversationId, input.entry.incarnationId, input.entry.requestId, generation, input.key]);
    const predecessor = [...this.flights.values()].filter(value => value.interaction === interaction).at(-1)?.promise;
    const flight = Promise.resolve(predecessor).catch(() => {}).then(() => this.apply(id, input, generation)).finally(() => this.flights.delete(id));
    this.flights.set(id, { hash, interaction, promise: flight }); return flight;
  }
  private async apply(id: string, input: Invocation, generation: number): Promise<ControlResult> {
    const { entry, trusted, payload, key } = input;
    await trusted?.current();
    if (!entry.incarnationId) throw new Error("request-not-active");
    const previous = this.ledger.remote.control(id);
    const resolved = this.ledger.read(state => Object.values(state.controlReceipts).some(value => value.conversationId === entry.conversationId &&
      value.incarnationId === entry.incarnationId && value.requestId === entry.requestId && value.generation === generation && value.key === key && value.state !== "not-dispatched"));
    if (!previous && !resolved) {
      if (entry.generation !== generation) throw new Error("request-not-active");
      input.verify();
    }
    if ((!previous || previous.state === "not-dispatched") && trusted) await trusted.current();
    const receipt = await this.ledger.remote.reserveControl({ id, conversationId: entry.conversationId, incarnationId: entry.incarnationId,
      requestId: entry.requestId, generation, key, payload, resolvedBy: trusted ? { sourceDeviceId: trusted.remote.origin.sourceDeviceId, sourceDeviceName: trusted.remote.origin.sourceDeviceName } : this.localSource?.(), payloadHash: canonicalHash(payload), ...(trusted ? { remote: trusted.remote } : {}) });
    if (receipt.state === "applied") return receipt.result!;
    if (previous && previous.state !== "not-dispatched" || receipt.state === "unknown") {
      if (receipt.state === "prepared") await this.ledger.remote.settleControl(id, "unknown");
      throw new Error("outcome-unknown");
    }
    let dispatched = false;
    try {
      await trusted?.current();
      if (entry.generation !== generation) throw new Error("request-not-active");
      input.verify();
      await trusted?.current();
      if (receipt.resolvedBy) (entry.interactionSources ??= new Map()).set(key, receipt.resolvedBy);
      dispatched = true; await input.apply();
      await this.ledger.remote.settleControl(id, "applied"); return "applied";
    } catch (error) { if (!dispatched) entry.interactionSources?.delete(key); await this.ledger.remote.settleControl(id, dispatched ? "unknown" : "not-dispatched"); throw error; }
  }
}
let owner: DurableAgentControls | null = null;
export function configureAgentControlLedger(ledger: RelayLedger, localSource?: () => InteractionSource) { owner = new DurableAgentControls(ledger, localSource); }
export function agentControlGeneration(entry: TurnEntry<AgentTurn>, key: string) { return owner?.generation(entry, key) ?? entry.generation; }
export function agentControlUnresolved(entry: TurnEntry<AgentTurn>, key: string, generation: number) { return owner?.unresolved(entry, key, generation) ?? false; }
export function assertAgentControlOrigin(id: string, trusted?: TrustedControl) { owner?.assertOrigin(id, trusted); }
export async function runAgentControl(input: Invocation): Promise<ControlResult> {
  if (owner) return owner.run(input);
  if (input.trusted) throw new Error("execution-not-ready");
  input.verify(); await input.apply(); return "applied";
}
