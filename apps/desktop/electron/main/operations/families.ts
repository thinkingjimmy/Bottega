/**
 * [INPUT]: Depends on the lifecycle intent store, ChatStore durable operation receipts, the relay ledger's submission outcome, BaseStore tool-batch receipts, owner-side remote command evidence and a cloud receipt port
 * [OUTPUT]: Provides the six OperationFamilyAdapter factories: lifecycleIntentFamily, chatOperationFamily, turnSubmissionFamily, baseToolBatchFamily, remoteCommandFamily and cloudReceiptFamily
 * [POS]: Translation only: each adapter reads its native ledger's own query and maps its states onto operation-receipt/v1 without adding a second truth; absent records return null and the broker reports them as unknown
 */
import { z } from "zod";
import { OPERATION_RECEIPT_SCHEMA, projectRemoteReceipt, sha256Ref, type OperationFamily, type OperationReceipt, type OperationState } from "@ai-chat/cloud-protocol/contracts/operations";
import type { RemoteCommandReceipt } from "@ai-chat/cloud-protocol/remote/model";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import { INTENT_PHASES, type LifecycleKind } from "../lifecycle/intent-types";
import type { ChatStore } from "../chats/chat-store";
import type { RelayLedger } from "../sections/coordinator/relay-ledger";
import type { BaseStore } from "../bases/base-store";
import type { TurnRegistry } from "../agent/turns/turn/turn-registry";
import { commandEvidence } from "../cloud/remote/commands/dispatch/evidence";
import type { FamilyRead, OperationFamilyAdapter } from "./broker";

const opaque = z.string().min(1).max(128);
type Fields = Pick<OperationReceipt, "state" | "nativeState" | "admission" | "receiptRevision"> & Partial<Pick<OperationReceipt, "resultRef" | "error" | "requestDigest">>;
function receipt(family: OperationFamily, operationId: string, nativeReceiptRef: string, fields: Fields): OperationReceipt {
  return { schema: OPERATION_RECEIPT_SCHEMA, family, operationId, nativeReceiptRef, requestDigest: null, resultRef: null, error: null,
    stop: fields.state === "cancelled" ? "unconfirmed" : "not-applicable", innerEffect: "not-applicable", resolvedBy: null, ...fields };
}
const admitted = (intentId: string, requestId: string, hash: string) =>
  ({ state: "admitted" as const, intentId, requestId, submissionHash: sha256Ref(hash) });

/* ── Lifecycle intents: (kind, requestId) is the stable user request; tombstones keep the settled result. ── */
export function lifecycleIntentFamily(store: Pick<LifecycleIntentStore, "readByRequest">): OperationFamilyAdapter<{ kind: LifecycleKind; requestId: string }> {
  return {
    family: "lifecycle-intent",
    locator: z.object({ kind: z.enum(Object.keys(INTENT_PHASES) as [LifecycleKind, ...LifecycleKind[]]), requestId: opaque }).strict(),
    operationId: locator => locator.requestId,
    async read({ kind, requestId }): Promise<FamilyRead> {
      const found = await store.readByRequest(kind, requestId);
      if (!found || found.result.state === "absent") return null;
      const lookup = found.result, ref = `lifecycle/intents:${kind}:${requestId}`;
      const intentId = lookup.state === "pending" ? lookup.intent.intentId : lookup.intentId;
      const admission = admitted(intentId, requestId, found.inputHash);
      if (lookup.state === "pending") {
        return { subject: {}, receipt: receipt("lifecycle-intent", requestId, ref, { state: "running", nativeState: `pending:${lookup.intent.phase}`,
          admission, receiptRevision: Math.max(1, lookup.intent.updatedAt) }) };
      }
      return { subject: {}, receipt: receipt("lifecycle-intent", requestId, ref, { state: lookup.status === "done" ? "succeeded" : "failed",
        nativeState: lookup.status, admission, receiptRevision: 1, resultRef: lookup.receipt ? `${ref}:receipt` : null,
        error: lookup.status === "rolled-back" ? { code: lookup.error?.code ?? "rolled-back" } : null }) };
    },
    authorize: () => false,
  };
}

/* ── Chat writes: only committed transactions leave a row, so a row is success and no row proves nothing. ── */
export function chatOperationFamily(store: Pick<ChatStore, "sync">): OperationFamilyAdapter<{ operationId: string }> {
  return {
    family: "chat-operation",
    locator: z.object({ operationId: opaque }).strict(),
    operationId: locator => locator.operationId,
    async read({ operationId }): Promise<FamilyRead> {
      const row = await store.sync.operationReceipt(operationId) as { requestHash: string; kind: string; targetId: string | null; committedAt: number } | null;
      if (!row) return null;
      return { subject: row.targetId ? { chatId: row.targetId } : {}, receipt: receipt("chat-operation", operationId, `chat_operations:${operationId}`, {
        state: "succeeded", nativeState: `committed:${row.kind}`, admission: admitted(operationId, operationId, row.requestHash),
        receiptRevision: Math.max(1, row.committedAt), resultRef: `chat_operations:${operationId}:result` }) };
    },
    authorize: () => false,
  };
}

/* ── Turn admission (Coordinator FIFO): the relay ledger's submission outcome, unchanged in meaning. ── */
const PHASE: Readonly<Record<string, OperationState>> = { queued: "accepted", appended: "accepted", claimed: "accepted", dispatching: "accepted",
  dispatched: "running", unknown: "outcome-unknown", "result-prepared": "running", persisted: "succeeded", failed: "failed" };
export function turnSubmissionFamily(ledger: Pick<RelayLedger, "submissionOutcome" | "snapshot">): OperationFamilyAdapter<{ intentId: string }> {
  return {
    family: "turn-submission",
    locator: z.object({ intentId: opaque }).strict(),
    operationId: locator => locator.intentId,
    read({ intentId }): FamilyRead {
      const outcome = ledger.submissionOutcome(intentId);
      if (outcome.kind === "notFound") return null;
      const state = ledger.snapshot();
      const intent = state.manualIntents[intentId], tombstone = state.intentTombstones[intentId];
      const hash = intent?.submissionHash ?? tombstone?.hash;
      if (!hash) throw new Error("turn submission without a durable submission hash");
      const phase = outcome.kind === "live" ? outcome.phase : outcome.outcome;
      const mapped = PHASE[phase];
      if (!mapped) throw new Error(`unknown submission phase ${phase}`);
      return { subject: intent ? { chatId: intent.conversationId } : {}, receipt: receipt("turn-submission", intentId, `relay/intents:${intentId}`, {
        state: mapped, nativeState: `${outcome.kind}:${phase}`, admission: admitted(intentId, intent?.requestId ?? intentId, hash),
        receiptRevision: Math.max(1, outcome.revision), error: mapped === "failed" || mapped === "outcome-unknown" ? { code: phase } : null }) };
    },
    authorize: (principal, subject) => principal.kind === "agent-turn" && subject.chatId === principal.chat.chatId,
  };
}

/* ── Base Agent batches: receipts live inside the Base's own sync envelope (no second journal). ── */
export function baseToolBatchFamily(store: Pick<BaseStore, "toolBatchReceipt">): OperationFamilyAdapter<{ ownerKey: string; ownerInstanceId?: string; operationId: string }> {
  return {
    family: "base-tool-batch",
    locator: z.object({ ownerKey: z.string().regex(/^(?:chat|project):[A-Za-z0-9_-]{1,128}$/), ownerInstanceId: opaque.optional(), operationId: opaque }).strict(),
    operationId: locator => locator.operationId,
    read({ ownerKey, ownerInstanceId, operationId }): FamilyRead {
      const found = store.toolBatchReceipt(ownerKey, operationId, ownerInstanceId);
      if (!found) return null;
      const { receipt: batch, cloudConfirmed } = found;
      return { subject: { ownerKey }, receipt: receipt("base-tool-batch", operationId, `base:${ownerKey}:${found.ownerInstanceId}:${operationId}`, {
        state: batch.status === "saved" ? "succeeded" : "failed",
        nativeState: `${batch.status}${batch.cloudOperation ? cloudConfirmed ? ":cloud-confirmed" : ":cloud-pending" : ":local"}`,
        admission: admitted(operationId, batch.batchId, batch.requestHash), receiptRevision: Math.max(1, batch.revision),
        resultRef: `base:${ownerKey}:revision:${batch.revision}`, error: batch.status === "saved" ? null : { code: batch.status, ...(batch.reason ? { message: batch.reason } : {}) } }) };
    },
    subjectOf: locator => ({ ownerKey: locator.ownerKey }),
    authorize: (principal, subject) => principal.kind === "agent-turn" && subject.ownerKey === `chat:${principal.chat.chatId}`,
  };
}

/* ── Remote commands, owner side: the same evidence the owner reports to the cloud, projected once more. ── */
export function remoteCommandFamily(ports: { ledger: RelayLedger; store: ChatStore; turns: Pick<TurnRegistry, "byRequest"> }): OperationFamilyAdapter<{ commandId: string }> {
  return {
    family: "remote-command",
    locator: z.object({ commandId: opaque }).strict(),
    operationId: locator => locator.commandId,
    async read({ commandId }): Promise<FamilyRead> {
      const binding = ports.ledger.snapshot().remoteCiphertexts[commandId];
      if (!binding) return null;
      const report = await commandEvidence(binding.context, { ...ports, current: () => {} });
      const native = { command: { commandId }, state: report?.state ?? "claimed", admission: report && "admission" in report ? report.admission : null,
        reason: report && "reason" in report ? report.reason : null, result: report && "result" in report ? report.result : null,
        resolvedBy: report && "resolvedBy" in report ? report.resolvedBy : undefined, updatedAt: binding.updatedAt } as unknown as RemoteCommandReceipt;
      return { subject: { chatId: binding.context.chatId }, receipt: { ...projectRemoteReceipt(native), nativeReceiptRef: `relay/remote:${commandId}` } };
    },
    authorize: () => false,
  };
}

/* ── Cloud record writes: the server's own receipt; its body stays encrypted, so presence proves admission only. ── */
/* The receipt queries whose arguments are exactly the encrypted-business header plus operationId. */
export const CLOUD_RECEIPT_QUERIES = ["projects/sync:receipt", "chats/metadata:receipt", "chats/options:receipt", "lifecycle/api:receipt"] as const;
export type CloudReceiptQuery = (typeof CLOUD_RECEIPT_QUERIES)[number];
export type CloudReceiptPort = { receipt(name: CloudReceiptQuery, operationId: string): Promise<unknown | null> };
export function cloudReceiptFamily(current: () => CloudReceiptPort | null): OperationFamilyAdapter<{ query: CloudReceiptQuery; operationId: string }> {
  return {
    family: "cloud-receipt",
    locator: z.object({ query: z.enum(CLOUD_RECEIPT_QUERIES), operationId: opaque }).strict(),
    operationId: locator => locator.operationId,
    async read({ query, operationId }): Promise<FamilyRead> {
      const port = current();
      if (!port) throw new Error("cloud is not signed in");
      const value = await port.receipt(query, operationId) as { status?: unknown; payloadHash?: unknown; ciphertextHash?: unknown; createdAt?: unknown } | null;
      if (!value) return null;
      const hash = [value.payloadHash, value.ciphertextHash].find(item => typeof item === "string" && /^[a-f0-9]{64}$/.test(item)) as string | undefined;
      if (!hash) throw new Error(`${query} receipt carries no content hash`);
      const status = typeof value.status === "string" ? value.status : "recorded";
      /* applied/converged took effect; conflicted lost a CAS; deleted lost to an entity deletion. Anything else is only "recorded". */
      const state: OperationState = status === "applied" || status === "converged" ? "succeeded" : status === "conflicted" || status === "deleted" ? "failed" : "accepted";
      const revision = typeof value.createdAt === "number" && Number.isSafeInteger(value.createdAt) && value.createdAt > 0 ? value.createdAt : 1;
      return { subject: {}, receipt: receipt("cloud-receipt", operationId, `${query}:${operationId}`, { state, nativeState: status,
        admission: admitted(operationId, operationId, hash), receiptRevision: revision, resultRef: `${query}:${operationId}`,
        error: state === "failed" ? { code: status } : null }) };
    },
    authorize: () => false,
  };
}
