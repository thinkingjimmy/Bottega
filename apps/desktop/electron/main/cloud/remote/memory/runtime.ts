/**
 * [INPUT]: Original-session encrypted Memory intents, account-scope admission and the single local Memory settings writer.
 * [OUTPUT]: MemoryControlBarrier drains the latest intent before remote work, with connection fences and durable receipt replay.
 * [POS]: Shared reconnect gate for Chat intake, accepted turns, transferred Steer and resource execution; local offline turns stay independent.
 */
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { openMemoryControl, prepareMemoryControlResult } from "@ai-chat/cloud-protocol/remote/memory-control/client";
import type { MemoryControlRequest, MemoryControlResult } from "@ai-chat/cloud-protocol/remote/memory-control/model";
import type { AccountTransport } from "../../runtime/transport/transport";
import type { CloudAccountService } from "../../runtime/service";
import { accountScopeAdmission, type AdmissionPorts, type Admitted } from "../../sync/account-config/admission";
export type MemoryControlPort = {
  facadeEnabled(): boolean;
  applyPaused(input: { operationId: string; paused: boolean; current(): void }): Promise<{ paused: boolean; appliedAt: number }>;
};
export type MemoryControlPorts = AdmissionPorts & {
  account: AdmissionPorts["account"] & Pick<CloudAccountService, "subscribeIdentity" | "subscribeConnection">;
  transport: Pick<AccountTransport, "query" | "mutate" | "watchMemoryControl">;
  memory: MemoryControlPort;
  report?(error: unknown): void;
};
const same = (left: MemoryControlRequest, right: MemoryControlRequest) => left.requestId === right.requestId && left.revision === right.revision && left.packet.ciphertextHash === right.packet.ciphertextHash;
export class MemoryControlBarrier {
  private closed = false;
  private flight: { key: string; promise: Promise<void>; dirty: boolean; accepting: boolean } | null = null;
  private readonly flights = new Set<Promise<void>>();
  private watching: { key: string; stop(): void } | null = null;
  private readonly releases: (() => void)[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly ports: MemoryControlPorts) {
    const wake = () => this.wake();
    this.releases.push(ports.account.subscribeIdentity(wake), ports.account.subscribeConnection(wake));
    this.timer = setInterval(wake, 60_000); this.timer.unref?.();
    wake();
  }
  /** Every caller gets a fresh reconciliation or joins the same current-connection reconciliation. Failures keep callers closed. */
  beforeRemote(): Promise<void> {
    const admitted = accountScopeAdmission(this.ports);
    if (this.closed || admitted.kind !== "admitted") return Promise.reject(new Error("memory-barrier-unavailable"));
    if (this.flight?.key === admitted.key && this.flight.accepting) {
      this.flight.dirty = true;
      return this.join(this.flight);
    }
    const flight = { key: admitted.key, promise: Promise.resolve(), dirty: false, accepting: true };
    this.flight = flight;
    const promise = this.drain(admitted, flight).finally(() => {
      this.flights.delete(promise);
      if (this.flight === flight) this.flight = null;
    });
    flight.promise = promise; this.flights.add(promise);
    return this.join(flight);
  }
  private join(flight: NonNullable<MemoryControlBarrier["flight"]>): Promise<void> {
    return flight.promise.then(() => {
      // A watch wake between the final read and promise resolution starts another drain; waiting callers join it too.
      if (this.flight && this.flight !== flight) return this.beforeRemote();
    });
  }
  /** Transferred Steer already belongs to this computer; only a live reconnect must first drain remote privacy intent. */
  async beforeTransferred() {
    const admitted = accountScopeAdmission(this.ports);
    if (admitted.kind === "offline" || admitted.kind === "local-only") return;
    await this.beforeRemote();
  }
  wake() {
    if (this.closed) return;
    const admitted = accountScopeAdmission(this.ports);
    if (admitted.kind !== "admitted") { this.stopWatch(); return; }
    if (this.watching?.key !== admitted.key) {
      this.stopWatch();
      try {
        const stop = this.ports.transport.watchMemoryControl?.({ ...admitted.header, targetDeviceId: this.ports.deviceId }, () => {
          if (this.watching?.key === admitted.key) void this.beforeRemote().catch(error => this.ports.report?.(error));
        }, error => this.ports.report?.(error));
        if (stop) this.watching = { key: admitted.key, stop };
      } catch (error) { this.ports.report?.(error); }
    }
    void this.beforeRemote().catch(error => this.ports.report?.(error));
  }
  private stopWatch() { this.watching?.stop(); this.watching = null; }
  private async drain(admitted: Admitted, flight: NonNullable<MemoryControlBarrier["flight"]>) {
    const current = () => {
      const value = accountScopeAdmission(this.ports);
      if (this.closed || value.kind !== "admitted" || value.key !== admitted.key) throw new Error("connection-changed");
    };
    const connectionEpoch = this.ports.account.remoteConnection()!;
    // A stream of competing controllers cannot monopolize the event loop or accidentally open the gate.
    for (let attempt = 0; attempt < 32; attempt++) {
      current(); flight.dirty = false;
      const receipt = await this.ports.transport.query("remote/memory/control:get", { ...admitted.header, targetDeviceId: this.ports.deviceId }); current();
      if (!receipt || receipt.state !== "pending") {
        if (flight.dirty) continue;
        // Close joining synchronously: a later wake must create another flight, never join a finished read.
        flight.accepting = false;
        return;
      }
      const request = receipt.request, identity = { ...admitted.header, requestId: request.requestId, revision: request.revision,
        ciphertextHash: request.packet.ciphertextHash, connectionEpoch };
      const authorized = await this.ports.transport.mutate("remote/memory/control:authorize", identity); current();
      // A stale authorization returns the new CAS row, which has not itself been authorized by that call.
      if (!authorized || !same(authorized.request, request)) continue;
      if (authorized.state !== "pending") continue;
      let result: MemoryControlResult;
      let paused: boolean;
      try { ({ paused } = await openMemoryControl(authorized, admitted.crypto)); }
      catch { current(); result = { kind: "refused", code: "invalid-command" }; await this.settle(admitted, identity, request, result, current); continue; }
      current();
      const operationId = `remote-memory:${hashCanonical({ session: admitted.crypto.session, scope: admitted.crypto.scope,
        requestId: request.requestId, revision: request.revision, ciphertextHash: request.packet.ciphertextHash })}`;
      try {
        // The writer checks the facade after receipt lookup: historical replay stays read-only even after visibility is withdrawn.
        const applied = await this.ports.memory.applyPaused({ operationId, paused, current }); current();
        result = { kind: "applied", ...applied };
      } catch (error) {
        current();
        const code = error instanceof Error ? error.message : "";
        if (code !== "facade-disabled" && code !== "memory-not-enabled" && code !== "backend-unavailable") throw error;
        result = { kind: "refused", code };
      }
      await this.settle(admitted, identity, request, result, current);
      // Always re-read after settlement, including a lost CAS: a newer pause must precede queued remote work.
    }
    throw new Error("memory-control-contention");
  }
  private async settle(admitted: Admitted, identity: { requestId: string; revision: number; ciphertextHash: string; connectionEpoch: string }, request: MemoryControlRequest, body: MemoryControlResult, current: () => void) {
    const result = await prepareMemoryControlResult(request, body, admitted.crypto); current();
    await this.ports.transport.mutate("remote/memory/control:settle", { ...admitted.header, ...identity, state: body.kind, result }); current();
  }
  async close() {
    this.closed = true; clearInterval(this.timer); this.stopWatch();
    for (const release of this.releases.splice(0)) release();
    await Promise.allSettled([...this.flights]);
  }
}
