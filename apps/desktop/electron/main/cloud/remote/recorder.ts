/**
 * [INPUT]: Depends on main-owned binding, bounded event/replacement capture, the ledger and Chat SQLite facade.
 * [OUTPUT]: Persists immutable live batches and ledger evidence, recovering incomplete frames independently of transport pause.
 * [POS]: Local capture lifetime is independent of transport; account identity and cleanup fences guard every write.
 */
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { LIVE_TURN_LIMITS } from "@ai-chat/cloud-protocol/turns/live";
import type { TurnRegistry } from "../../turn-registry";
import type { ChatStore } from "../../chats/chat-store";
import type { RelayLedger } from "../../sections/coordinator/relay-ledger";
import type { SyncBindingStore } from "../sync/account/binding";
import { localTurnAdmissionSchema } from "../../chats/sqlite/cloud/delivery/turns/model";
import { ChatDeliveryCheckpoints } from "../sync/chats/checkpoints";
import { readOutboxSource } from "../sync/chats/sources";
import { captureTurnAdmissions, readTurnOutbox, transferTurnEvidence, recoverLateTurnEvidence } from "./sources";
import { projectBoundedEvents, projectTurnSnapshot } from "./events";
import { LiveCaptureBuffer } from "./buffer";
export type TurnRuntimePorts = { ledger: RelayLedger; turns: Pick<TurnRegistry, "subscribeEvents" | "attachSnapshot" | "liveEntries"> };
export class LocalTurnRecorder {
  private readonly buffered = new Map<string, LiveCaptureBuffer>();
  private readonly unsubscribe: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private flight: Promise<void> | null = null;
  private accountId: string | null = null;
  private closed = false;
  constructor(private readonly input: TurnRuntimePorts & { store: ChatStore; binding: SyncBindingStore; config: CloudBuildConfig; deviceId: string }) {
    this.unsubscribe = input.turns.subscribeEvents(event => {
      const binding = input.binding.snapshot(); if (!binding || binding.phase === "closing") return;
      this.selectAccount(binding.userId);
      const buffer = this.buffer(event.requestId), first = !buffer.initialized;
      if (event.type === "turn-state-changed") buffer.replace(projectTurnSnapshot(event.turn));
      else for (const value of projectBoundedEvents(event)) buffer.append(value);
      if (first || event.type !== "item-delta" && event.type !== "subagent-item-delta") void this.flush().catch(() => {});
    });
    this.timer = setInterval(() => { void this.flush().catch(() => {}); }, LIVE_TURN_LIMITS.flushMs); this.timer.unref();
  }
  private selectAccount(id: string) { if (this.accountId !== id) { this.buffered.clear(); this.accountId = id; } }
  private buffer(turnId: string) {
    let value = this.buffered.get(turnId);
    if (!value) { value = new LiveCaptureBuffer(Date.now()); this.buffered.set(turnId, value); }
    return value;
  }
  flush() {
    if (this.closed) return Promise.resolve(); if (this.flight) return this.flight;
    const flight = this.capture(); this.flight = flight;
    void flight.finally(() => { if (this.flight === flight) this.flight = null; }).catch(() => {}); return flight;
  }
  private async capture() {
    const { store, ledger, binding, config, deviceId, turns } = this.input, current = binding.snapshot();
    if (!current || current.phase === "closing") return; this.selectAccount(current.userId);
    const scope = { environment: config.environmentId, userId: current.userId };
    const assertCurrent = () => { const latest = binding.snapshot();
      if (!latest || latest.userId !== scope.userId || latest.manifestId !== current.manifestId || latest.phase === "closing") throw new Error("cloud-request-superseded"); };
    const ports = { store, ledger, scope, deviceId, current: assertCurrent };
    await recoverLateTurnEvidence(ports); assertCurrent();
    const original = await readTurnOutbox(store.sync, scope); assertCurrent();
    await captureTurnAdmissions(ports, original); assertCurrent();
    const items = await readTurnOutbox(store.sync, scope);
    for (const item of items.filter(item => item.kind === "live-turn")) {
      assertCurrent(); const admission = localTurnAdmissionSchema.parse((await readOutboxSource(store.sync, scope, item)).payload);
      const existing = await store.sync.read(scope, { type: "turn-receipt", turnId: admission.turnId });
      if (existing.type === "turn-receipt" && existing.value?.settlementState === "settled") { this.buffered.delete(admission.turnId); continue; }
      const checkpoints = new ChatDeliveryCheckpoints(store.sync, scope, item), buffer = this.buffer(admission.turnId);
      const progress = await store.sync.read(scope, { type: "turn-delivery", id: item.id });
      if (progress.type !== "turn-delivery") throw new Error("TURN_DELIVERY_UNAVAILABLE");
      const snapshot = turns.attachSnapshot(admission.chat.id);
      if (!buffer.initialized) {
        let confirmedTerminal = false;
        if (progress.value.highSeq > 0) {
          const last = await checkpoints.get(`turn-chunk:${progress.value.highSeq}`);
          if (last?.kind === "turn-chunk") {
            if (last.chunk.events.some(event => event.type === "terminal")) { buffer.confirmedTerminal(); confirmedTerminal = true; }
            const ending = last.chunk.events.at(-1);
            if (ending?.type === "replacement-begin" || ending?.type === "replacement-part") buffer.resumeReplacement(ending.snapshotId, progress.value.highSeq);
          }
        }
        if (!confirmedTerminal && snapshot.turn?.requestId === admission.turnId) buffer.replace(projectTurnSnapshot(snapshot.turn), true);
        buffer.initialized = true;
      }
      const result = ledger.snapshot().manualResultOutbox[admission.ledgerIntentId];
      if (!buffer.terminal && result?.terminal) buffer.append({ type: "terminal", terminal: result.terminal });
      let highSeq = progress.value.highSeq;
      for (let chunk = buffer.next(highSeq); chunk; chunk = buffer.next(highSeq, false)) {
        assertCurrent(); await checkpoints.save({ kind: "turn-chunk", chunk }); buffer.acknowledge(chunk); highSeq = Math.max(highSeq, chunk.seq);
      }
      const live = turns.liveEntries().some(entry => entry.conversationId === admission.chat.id && entry.requestId === admission.turnId && !entry.effectiveTerminal);
      assertCurrent(); await transferTurnEvidence(ports, admission, live);
    }
  }
  async close() { clearInterval(this.timer); this.unsubscribe(); await this.flush().catch(() => {}); this.closed = true; this.buffered.clear(); }
}
