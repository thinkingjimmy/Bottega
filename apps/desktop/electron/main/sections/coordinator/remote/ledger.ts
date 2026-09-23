/**
 * [INPUT]: Depends on the existing RelayLedger transaction ports and canonical submission reservation mutations.
 * [OUTPUT]: Preserves exact remote submissions, trusted file custody, inherited Steer authority, the local authority of a transferred Steer's next turn (inheriting only the steered turn's Full Access) and immutable control decisions.
 * [POS]: Ledger collaborator; all records commit through the original single writer.
 */
import type { TrustedTurnAuthority } from "../../../backends/types";
import { queuedProjection, editQueued, withdrawUnpersisted } from "./queue";
import type { TrustedManualTurnSubmission } from "../../../../../shared/sections-ipc";
import { SUBMISSION_CAPSULE_BYTE_LIMIT } from "../../../../../shared/submission";
import { canonicalHash } from "../coordinator-values";
import { reserveSubmission } from "../submission-outcome";
import type { LedgerState } from "../state/ledger-schema";
import type { DeepReadonly } from "../state/readonly-ledger";
import { assertPreparedContentHash, type PreparedManualTurn } from "../admission/prepared-manual-turn";
import { steerDerivedIntentId } from "../admission/steer-projection";
import { controlReceiptSchema, remoteContextSchema, remoteSubmissionSchema, type ControlReceipt, type RemoteContext, remoteCiphertextSchema, type RemoteCiphertext } from "./model";
type Ports = { read<T>(select: (state: DeepReadonly<LedgerState>) => T): T;
  mutate<T>(action: (state: LedgerState, now: number) => T): Promise<T> };
export class RemoteLedger {
  private executionAuthority: ((context: RemoteContext) => TrustedTurnAuthority) | null = null;
  constructor(private readonly ports: Ports) {}
  queue(chatId: string) { return this.ports.read(state => queuedProjection(state, chatId)); }
  editQueue(command: import("@ai-chat/cloud-protocol/remote/model").RemoteCommand, context: RemoteContext, current: () => void) {
    return this.ports.mutate((state, now) => { current();
      const binding = state.remoteCiphertexts[command.commandId];
      if (!binding || canonicalHash(binding.context) !== canonicalHash(context)) throw new Error("REMOTE_COMMAND_CUSTODY_MISSING");
      return editQueued(state, now, command, context);
    });
  }
  withdrawUnpersisted(context: RemoteContext, current: () => void) {
    return this.ports.mutate((state, now) => { current();
      const saved = state.remoteCiphertexts[context.origin.commandId];
      if (!saved || canonicalHash(saved.context) !== canonicalHash(context)) throw new Error("REMOTE_COMMAND_CUSTODY_MISSING");
      return withdrawUnpersisted(state, now, context);
    });
  }
  configureExecutionAuthority(provider: (context: RemoteContext) => TrustedTurnAuthority) {
    this.executionAuthority = provider;
    return () => { if (this.executionAuthority === provider) this.executionAuthority = null; };
  }
  authority(input: RemoteContext): TrustedTurnAuthority {
    const context = remoteContextSchema.parse(input), saved = this.ciphertext(context.origin.commandId);
    if (!saved || canonicalHash(saved.context) !== canonicalHash(context)) throw new Error("REMOTE_COMMAND_CUSTODY_MISSING");
    if (!this.executionAuthority) throw new Error("sync-clock-unavailable");
    return this.executionAuthority(context);
  }
  /**
   * A Steer this computer durably moved to the next turn was authorized when it was transferred. Its derived turn runs as local
   * custody: by then the Steer command is finished and its turn closed, so the service can never authorize that command again.
   */
  transferredSteer(context: RemoteContext, intentId: string) {
    const id = remoteContextSchema.parse(context).origin.commandId;
    if (intentId !== steerDerivedIntentId(id)) return false;
    return this.ports.read(state => {
      const steer = state.steerIntents[id];
      if (steer) return steer.phase === "transferred" && canonicalHash((steer.stagedSnapshot as PreparedManualTurn).remoteContext) === canonicalHash(context);
      return state.intentTombstones[id]?.outcome === "transferred" && state.manualIntents[intentId] !== undefined;
    });
  }
  /**
   * The local authority of a transferred Steer's next turn: nothing to re-authorize, and Full Access only when the turn it
   * was steering already ran with it (inheritsFullAccess) — never the computer's global acknowledgement.
   */
  transferredAuthority(context: RemoteContext, intentId: string): TrustedTurnAuthority | null {
    if (!this.transferredSteer(context, intentId)) return null;
    return { validate: async () => {}, current: () => {},
      fullAccessFor: (chatId, incarnationId) => chatId === context.chatId && incarnationId === context.incarnationId && this.inheritsFullAccess(context) };
  }
  ciphertext(id: string) { return this.ports.read(state => state.remoteCiphertexts[id] ? structuredClone(state.remoteCiphertexts[id]) as RemoteCiphertext : null); }
  inheritsFullAccess(context: RemoteContext) {
    return this.ports.read(state => {
      const frozen = state.remoteCiphertexts[context.origin.commandId], steer = state.steerIntents[context.origin.commandId];
      if (frozen?.command.kind !== "steer" || !steer || steer.conversationId !== context.chatId ||
        canonicalHash(frozen.context) !== canonicalHash(context)) return false;
      // Only the outbox can freeze options copied from the actual running turn.
      const prepared = steer.stagedSnapshot as PreparedManualTurn;
      assertPreparedContentHash(prepared);
      return canonicalHash(prepared.remoteContext) === canonicalHash(context) && prepared.turn.turnOptions.permissionMode === "full-access";
    });
  }
  freezeCommand(input: Omit<RemoteCiphertext, "report" | "createdAt" | "updatedAt">) {
    return this.ports.mutate((state, now) => {
      const id = input.context.origin.commandId, old = state.remoteCiphertexts[id];
      if (old) {
        if (canonicalHash([old.context, old.command, old.encryptedSpace]) !== canonicalHash([input.context, input.command, input.encryptedSpace])) throw new Error("REMOTE_COMMAND_PAYLOAD_CONFLICT");
        return old;
      }
      if (Object.keys(state.remoteCiphertexts).length >= 4096) throw new Error("REMOTE_COMMAND_CUSTODY_LIMIT");
      if (input.command.commandId !== id || input.command.ciphertextHash !== input.context.origin.ciphertextHash) throw new Error("REMOTE_COMMAND_PAYLOAD_CONFLICT");
      return state.remoteCiphertexts[id] = remoteCiphertextSchema.parse({ ...input, report: null, createdAt: now, updatedAt: now });
    });
  }
  freezeReport(id: string, input: NonNullable<RemoteCiphertext["report"]>) {
    return this.ports.mutate((state, now) => {
      const value = state.remoteCiphertexts[id]; if (!value) throw new Error("REMOTE_COMMAND_CUSTODY_MISSING");
      if (value.report?.plaintextHash === input.plaintextHash) return value.report;
      if (input.transport.revision !== (value.report?.transport.revision ?? 0) + 1) throw new Error("REMOTE_REPORT_REVISION_CONFLICT");
      value.report = input; value.updatedAt = now; return value.report;
    });
  }
  lookup(input: RemoteContext) {
    const context = remoteContextSchema.parse(input), id = context.origin.commandId;
    return this.ports.read(state => {
      const intent = state.manualIntents[id], tombstone = state.intentTombstones[id], reservation = state.submissionReservations[id];
      const record = intent?.remoteSubmission ?? tombstone?.remoteSubmission ?? reservation?.remoteSubmission;
      if (!record) {
        if (intent || tombstone || reservation) throw new Error("REMOTE_COMMAND_ID_CONFLICT");
        return null;
      }
      if (canonicalHash(record.context) !== canonicalHash(context)) throw new Error("REMOTE_COMMAND_PAYLOAD_CONFLICT");
      if (canonicalHash(record.envelope) !== record.submissionHash) throw new Error("REMOTE_SUBMISSION_HASH_CHANGED");
      return { submission: structuredClone(record.envelope) as TrustedManualTurnSubmission,
        submissionHash: record.submissionHash, accepted: Boolean(intent || tombstone), compacted: Boolean(tombstone) };
    });
  }
  reserve(submission: TrustedManualTurnSubmission, context: RemoteContext) {
    const remote = remoteSubmissionSchema.parse({ context, envelope: submission, submissionHash: canonicalHash(submission) });
    if (submission.intentId !== context.origin.commandId || submission.persistence.kind !== "append" ||
      submission.persistence.input.chatId !== context.chatId || submission.precondition.kind !== "existing" ||
      submission.precondition.incarnationId !== context.incarnationId) throw new Error("REMOTE_SUBMISSION_IDENTITY_CHANGED");
    if (Buffer.byteLength(JSON.stringify(remote), "utf8") > SUBMISSION_CAPSULE_BYTE_LIMIT) throw new Error("REMOTE_SUBMISSION_LIMIT");
    return this.ports.mutate((state, now) => {
      const binding = state.remoteCiphertexts[submission.intentId];
      if (!binding || canonicalHash(binding.context) !== canonicalHash(context)) throw new Error("REMOTE_COMMAND_CUSTODY_MISSING");
      const prior = state.submissionReservations[submission.intentId]?.remoteSubmission;
      if (prior && canonicalHash(prior) !== canonicalHash(remote)) throw new Error("REMOTE_COMMAND_PAYLOAD_CONFLICT");
      const reservation = reserveSubmission(state, { intentId: submission.intentId, conversationId: context.chatId,
        submissionHash: remote.submissionHash, payload: { kind: "submission", value: submission } }, now);
      reservation.remoteSubmission = remote;
      return reservation;
    });
  }
  control(id: string) { return this.ports.read(state => state.controlReceipts[id] ? structuredClone(state.controlReceipts[id]) as ControlReceipt : null); }
  reserveControl(input: Omit<ControlReceipt, "state" | "result" | "createdAt" | "updatedAt">) {
    return this.ports.mutate((state, now) => {
      if (input.remote) { const binding = state.remoteCiphertexts[input.id];
        if (!binding || canonicalHash(binding.context) !== canonicalHash(input.remote)) throw new Error("REMOTE_COMMAND_CUSTODY_MISSING"); }
      const original = state.controlReceipts[input.id];
      if (original) {
        if (original.payloadHash !== input.payloadHash || original.key !== input.key || original.conversationId !== input.conversationId ||
          original.incarnationId !== input.incarnationId || original.requestId !== input.requestId || original.generation !== input.generation ||
          canonicalHash(original.remote ?? null) !== canonicalHash(input.remote ?? null)) throw new Error("REMOTE_CONTROL_ID_CONFLICT");
        if (original.state !== "not-dispatched") return original;
      }
      const winner = Object.values(state.controlReceipts).find(receipt => receipt.state !== "not-dispatched" && receipt.key === input.key && receipt.conversationId === input.conversationId &&
        receipt.incarnationId === input.incarnationId && receipt.requestId === input.requestId && receipt.generation === input.generation);
      if (winner && winner.state !== "applied") throw new Error("outcome-unknown");
      const receipt = controlReceiptSchema.parse({ ...input, state: winner ? "applied" : "prepared", result: winner ? "already-resolved" : null,
        resolvedBy: winner?.resolvedBy ?? input.resolvedBy, createdAt: original?.createdAt ?? now, updatedAt: now });
      state.controlReceipts[input.id] = receipt; return receipt;
    });
  }
  settleControl(id: string, result: "applied" | "unknown" | "not-dispatched", output?: ControlReceipt["output"]) {
    return this.ports.mutate((state, now) => {
      const receipt = state.controlReceipts[id]; if (!receipt) throw new Error("REMOTE_CONTROL_UNAVAILABLE");
      if (receipt.state === "prepared") { receipt.state = result; receipt.result = result === "applied" ? "applied" : null; receipt.updatedAt = now; if (output) receipt.output = output; }
      return receipt;
    });
  }
}
