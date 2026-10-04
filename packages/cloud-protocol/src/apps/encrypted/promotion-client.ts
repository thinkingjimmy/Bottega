/**
 * [INPUT]: Reviewed App promotion identity, existing Base revisions and admitted record crypto.
 * [OUTPUT]: A frozen App/Project creation bundle that preserves the original Base ciphertext.
 * [POS]: Client-only promotion encoder; the classification outbox owns its exact bytes.
 */
import { appIdSchema, appItemSchema } from "../model";
import { projectOperationSchema, hashProjectOperation } from "../../projects/model";
import { encryptRecordPacket, prepareProjectOperation } from "../../projects/encrypted/client";
import { recordCipherHash } from "../../projects/encrypted";
import type { AppCipherPort } from "./client";
import type { AppCipherIntent } from "./model";
import { appRecordContext } from "./wire";
import { appPromotionContext, verifyAppPromotion } from "./promotion";
export async function prepareAppPromotion(input: { appId: string; operationId: string; projectId: string; baseId: string;
  baseRevision: number; baseSchemaRevision: number; displayName: string; createdAt: number }, crypto: AppCipherPort, signal: AbortSignal) {
  appIdSchema.parse(input.appId); appItemSchema.shape.displayName.parse(input.displayName);
  const intent: AppCipherIntent = { kind: "create", projectId: input.projectId, baseId: input.baseId,
    sourceDeviceId: crypto.session.deviceId, actorDeviceId: crypto.session.deviceId, expectedRevision: 0, expectedProjectRevision: 0,
    expectedBaseRevision: 0, packageRevision: null, baseSchemaRevision: input.baseSchemaRevision, createdAt: input.createdAt, retainBase: null, migration: null };
  const original = projectOperationSchema.parse({ projectId: input.projectId, operationId: input.operationId,
    command: { kind: "create", metadata: { name: input.displayName.slice(0, 100), sortIndex: 0 }, createdAt: input.createdAt }, payloadHash: "0".repeat(64) });
  original.payloadHash = await hashProjectOperation(original);
  const project = (await prepareProjectOperation(original, null, crypto, signal, { role: "workspace", appId: input.appId })).transport;
  const facts = await encryptRecordPacket(crypto, appRecordContext(crypto.scope, input.appId, input.operationId, intent, "facts"),
    { schema: "bottega.encrypted-app-facts/v1", displayName: input.displayName, dataCoverage: "partial" }, signal);
  const aggregate = { appId: input.appId, operationId: input.operationId, baseRevision: input.baseRevision, intent, facts, project };
  const operation = await encryptRecordPacket(crypto, appPromotionContext(crypto.scope, aggregate),
    { schema: "bottega.encrypted-app-promotion/v1", appId: input.appId, operationId: input.operationId, baseRevision: input.baseRevision }, signal);
  const payload = { ...aggregate, operation };
  return verifyAppPromotion({ ...payload, ciphertextHash: recordCipherHash(payload) }, crypto.scope);
}
