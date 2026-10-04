/**
 * [INPUT]: Depends on the pure envelope parser/hash, the purpose-12/13 context constructors, canonical JSON, a content cipher port and the workflow projection model.
 * [OUTPUT]: Provides server-safe validation (plaintext size measured from the ciphertext) and client sealing and request-bound opening for the three projections: run (validate/seal/openWorkflowRun), a computer's attention page (…WorkflowAttention) and binding (…WorkflowBinding); re-exports projectWorkflowRun.
 * [POS]: Workflow projection codec (§10.2 / §10.2a). Opening checks the plaintext header against the sealed body, so a server that rewrites a run's state, Base, row or start time (C2-05), or a binding's Base or suspension reason, is caught by the reader.
 */
import { canonicalJson } from "../encryption/encoding";
import { assertCrypto, assertExpectedContext, assertExpectedScope, AUTH_TAG_BYTES, createWorkflowAttentionContext, createWorkflowBindingContext, createWorkflowRunContext,
  decodeBase64url, encodeBase64url, hashEnvelope, parseEnvelope, type CryptoScope, type DomainContext } from "../encryption";
import type { FileCipherPort } from "../blobs/encrypted/model";
import { WORKFLOW_PROJECTION_LIMITS, encryptedWorkflowAttentionSchema, encryptedWorkflowBindingSchema, encryptedWorkflowRunSchema, workflowAttentionPageSchema, workflowBindingIdentitySchema, workflowBindingProjectionSchema,
  workflowRunProjectionSchema, type EncryptedWorkflowAttention, type EncryptedWorkflowBinding, type EncryptedWorkflowRun, type ProjectedNeedsYouItem,
  type WorkflowBindingProjection, type WorkflowRunProjection } from "./model";
export { projectWorkflowRun } from "./projection";

type Packet = { envelope: string; ciphertextHash: string; ciphertextBytes: number };
type _Space = Pick<FileCipherPort, "scope" | "keyPackageFingerprint">;
const runContext = (scope: CryptoScope, r: Pick<EncryptedWorkflowRun, "runId" | "ownerDeviceId" | "projectId" | "revision" | "operationId">) =>
  createWorkflowRunContext(scope, r.runId, r.operationId, { runId: r.runId, ownerDeviceId: r.ownerDeviceId, parentRef: r.projectId, expectedRevision: r.revision - 1, projectionKind: "run" });
const attentionContext = (scope: CryptoScope, r: Pick<EncryptedWorkflowAttention, "ownerDeviceId" | "revision" | "pendingCount" | "operationId">) =>
  createWorkflowAttentionContext(scope, r.ownerDeviceId, r.operationId, { ownerDeviceId: r.ownerDeviceId, expectedRevision: r.revision - 1, pendingCount: r.pendingCount });
const bindingContext = (scope: CryptoScope, r: Pick<EncryptedWorkflowBinding, "bindingId" | "projectId" | "ownerDeviceId" | "revision" | "state" | "operationId">) =>
  createWorkflowBindingContext(scope, r.bindingId, r.operationId, { projectId: r.projectId, ownerDeviceId: r.ownerDeviceId, schemaVersion: 1,
    expectedRevision: r.revision - 1, stateClass: r.state });

function measure(packet: Packet, envelopeLimit: number, expected: DomainContext) {
  const bytes = decodeBase64url(packet.envelope, 1, envelopeLimit);
  assertCrypto(bytes.length === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  const envelope = parseEnvelope(bytes);
  assertExpectedContext(envelope.context, expected);
  return envelope.ciphertext.byteLength - AUTH_TAG_BYTES;
}
async function seal(context: DomainContext, value: unknown, crypto: FileCipherPort, limit: number, signal?: AbortSignal) {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try {
    if (plaintext.byteLength > limit) throw new Error("workflow-projection-budget");
    const sealed = await crypto.run({ kind: "encrypt", context, plaintext }, signal, { priority: "background" });
    assertCrypto(sealed.kind === "encrypted");
    return { encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
      packet: { envelope: encodeBase64url(sealed.envelope), ciphertextHash: sealed.ciphertextHash, ciphertextBytes: sealed.envelope.byteLength } };
  } finally { plaintext.fill(0); }
}
async function open(record: { encryptedSpace: { scope: CryptoScope; keyPackageFingerprint: string }; packet: Packet }, expectedContext: DomainContext,
  envelopeLimit: number, crypto: FileCipherPort, signal?: AbortSignal): Promise<unknown> {
  assertExpectedScope(record.encryptedSpace.scope, crypto.scope);
  assertCrypto(record.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const opened = await crypto.run({ kind: "decrypt", expectedContext, envelope: decodeBase64url(record.packet.envelope, 1, envelopeLimit) }, signal);
  assertCrypto(opened.kind === "decrypted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext)) as unknown; }
  catch { assertCrypto(false); }
  finally { opened.plaintext.fill(0); }
}
const parsed = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T => {
  const result = schema.safeParse(value);
  assertCrypto(result.success);
  return (result as { data: T }).data;
};

/* ---- Run ---- */
type RunIdentity = Pick<EncryptedWorkflowRun, "runId" | "ownerDeviceId" | "projectId" | "baseId" | "rowId" | "revision" | "operationId">;
export function validateWorkflowRun(input: EncryptedWorkflowRun) {
  const record = encryptedWorkflowRunSchema.parse(input);
  return { record, plaintextBytes: measure(record.packet, WORKFLOW_PROJECTION_LIMITS.runEnvelopeBytes, runContext(record.encryptedSpace.scope, record)) };
}
export async function sealWorkflowRun(input: RunIdentity & { run: WorkflowRunProjection }, crypto: FileCipherPort, signal?: AbortSignal): Promise<EncryptedWorkflowRun> {
  const run = workflowRunProjectionSchema.parse(input.run);
  const identity = { runId: input.runId, ownerDeviceId: input.ownerDeviceId, projectId: input.projectId, baseId: input.baseId, rowId: input.rowId, revision: input.revision,
    state: run.state, startedAt: run.createdAt, operationId: input.operationId };
  if (run.runId !== identity.runId || run.record.base.ownerInstanceId !== identity.baseId || run.record.rowId !== identity.rowId) throw new Error("workflow-run-header-mismatch");
  const sealed = await seal(runContext(crypto.scope, identity), run, crypto, WORKFLOW_PROJECTION_LIMITS.runPlaintextBytes, signal);
  return validateWorkflowRun({ ...identity, ...sealed }).record;
}
/** The caller names the run it asked for; the header the server returned must describe the sealed body. */
export async function openWorkflowRun(raw: EncryptedWorkflowRun, expected: { runId: string }, crypto: FileCipherPort, signal?: AbortSignal): Promise<WorkflowRunProjection> {
  const { record } = validateWorkflowRun(raw);
  assertCrypto(record.runId === expected.runId);
  const run = parsed(workflowRunProjectionSchema, await open(record, runContext(crypto.scope, { ...record, runId: expected.runId }), WORKFLOW_PROJECTION_LIMITS.runEnvelopeBytes, crypto, signal));
  assertCrypto(run.runId === record.runId && run.state === record.state && run.record.base.ownerInstanceId === record.baseId && run.record.rowId === record.rowId
    && run.createdAt === record.startedAt);
  return run;
}

/* ---- Attention: one page per desktop ---- */
type AttentionIdentity = Pick<EncryptedWorkflowAttention, "ownerDeviceId" | "revision" | "operationId">;
export function validateWorkflowAttention(input: EncryptedWorkflowAttention) {
  const record = encryptedWorkflowAttentionSchema.parse(input);
  return { record, plaintextBytes: measure(record.packet, WORKFLOW_PROJECTION_LIMITS.runEnvelopeBytes, attentionContext(record.encryptedSpace.scope, record)) };
}
/** `pendingCount` is everything waiting; the page keeps the newest 50. */
export async function sealWorkflowAttention(input: AttentionIdentity & { items: readonly ProjectedNeedsYouItem[]; pendingCount?: number }, crypto: FileCipherPort,
  signal?: AbortSignal): Promise<EncryptedWorkflowAttention> {
  const page = workflowAttentionPageSchema.parse({ items: input.items });
  const identity = { ownerDeviceId: input.ownerDeviceId, revision: input.revision, operationId: input.operationId, pendingCount: input.pendingCount ?? page.items.length };
  if (identity.pendingCount < page.items.length) throw new Error("workflow-attention-count");
  const sealed = await seal(attentionContext(crypto.scope, identity), page, crypto, WORKFLOW_PROJECTION_LIMITS.runPlaintextBytes, signal);
  return validateWorkflowAttention({ ...identity, ...sealed }).record;
}
export async function openWorkflowAttention(raw: EncryptedWorkflowAttention, crypto: FileCipherPort, signal?: AbortSignal) {
  const { record } = validateWorkflowAttention(raw);
  const page = parsed(workflowAttentionPageSchema, await open(record, attentionContext(crypto.scope, record), WORKFLOW_PROJECTION_LIMITS.runEnvelopeBytes, crypto, signal));
  assertCrypto(page.items.length <= record.pendingCount);
  return { ownerDeviceId: record.ownerDeviceId, pendingCount: record.pendingCount, items: page.items };
}

/* ---- Binding (read-only projection) ---- */
type BindingInput = Pick<EncryptedWorkflowBinding, "bindingId" | "projectId" | "state"> & WorkflowBindingProjection;
export function validateWorkflowBinding(input: EncryptedWorkflowBinding) {
  const record = encryptedWorkflowBindingSchema.parse(input);
  return { record, plaintextBytes: measure(record.packet, WORKFLOW_PROJECTION_LIMITS.bindingEnvelopeBytes, bindingContext(record.encryptedSpace.scope, record)) };
}
export async function sealWorkflowBinding(input: { ownerDeviceId: string; revision: number; operationId: string; binding: BindingInput }, crypto: FileCipherPort,
  signal?: AbortSignal): Promise<EncryptedWorkflowBinding> {
  const { bindingId, projectId, state, ...body } = input.binding, { baseId, suspendedReason } = body;
  const identity = workflowBindingIdentitySchema.parse({ bindingId, projectId, baseId, state, suspendedReason, ownerDeviceId: input.ownerDeviceId, revision: input.revision, operationId: input.operationId });
  const sealed = await seal(bindingContext(crypto.scope, identity), workflowBindingProjectionSchema.parse(body), crypto, WORKFLOW_PROJECTION_LIMITS.bindingPlaintextBytes, signal);
  return validateWorkflowBinding({ ...identity, ...sealed }).record;
}
export async function openWorkflowBinding(raw: EncryptedWorkflowBinding, expected: { bindingId: string }, crypto: FileCipherPort, signal?: AbortSignal) {
  const { record } = validateWorkflowBinding(raw);
  assertCrypto(record.bindingId === expected.bindingId);
  const body = parsed(workflowBindingProjectionSchema, await open(record, bindingContext(crypto.scope, { ...record, bindingId: expected.bindingId }), WORKFLOW_PROJECTION_LIMITS.bindingEnvelopeBytes, crypto, signal));
  assertCrypto(body.baseId === record.baseId && body.suspendedReason === record.suspendedReason);
  return body;
}
