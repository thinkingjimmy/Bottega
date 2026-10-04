/**
 * [INPUT]: Closed App creation intent, original Base revision and encrypted Project creation.
 * [OUTPUT]: Strict Base-preserving App promotion bundles and exact aggregate validation.
 * [POS]: Server-safe App promotion contract; it cannot reseed the existing Base.
 */
import { z } from "zod";
import { id, version, digest } from "../../encryption/domains/scalars";
import { assertCrypto, createAppContext, type CryptoScope } from "../../encryption";
import { projectPacketSchema, encryptedProjectOperationSchema, verifyProjectOperation, verifyRecordPacket, recordCipherHash } from "../../projects/encrypted";
import { appIdSchema } from "../model";
import { appCipherIntentSchema } from "./model";
import { appRecordContext } from "./wire";
export const encryptedAppPromotionSchema = z.object({ appId: appIdSchema, operationId: id, baseRevision: version,
  intent: appCipherIntentSchema, facts: projectPacketSchema, project: encryptedProjectOperationSchema,
  operation: projectPacketSchema, ciphertextHash: digest }).strict().refine(value => value.intent.kind === "create");
export type EncryptedAppPromotion = z.infer<typeof encryptedAppPromotionSchema>;
function hashAppPromotionMetadata(value: Pick<EncryptedAppPromotion, "appId" | "operationId" | "baseRevision" | "intent" | "facts" | "project">) {
  return recordCipherHash({ schema: "bottega.app-promotion-commit/v1", appId: value.appId, operationId: value.operationId,
    baseRevision: value.baseRevision, intent: appCipherIntentSchema.parse(value.intent),
    facts: { ciphertextHash: value.facts.ciphertextHash, ciphertextBytes: value.facts.ciphertextBytes }, project: value.project.ciphertextHash });
}
export function appPromotionContext(scope: CryptoScope, value: Pick<EncryptedAppPromotion, "appId" | "operationId" | "baseRevision" | "intent" | "facts" | "project">) {
  return createAppContext(scope, value.appId, value.operationId, { role: "operation", projectId: value.intent.projectId,
    baseId: value.intent.baseId, expectedRevision: 0, packageRevision: 0, metadataCommitment: hashAppPromotionMetadata(value) });
}
export function verifyAppPromotion(raw: EncryptedAppPromotion, scope: CryptoScope) {
  const value = encryptedAppPromotionSchema.parse(raw), { ciphertextHash: _hash, ...transport } = value;
  assertCrypto(recordCipherHash(transport) === value.ciphertextHash);
  assertCrypto(value.intent.sourceDeviceId === value.intent.actorDeviceId);
  const project = verifyProjectOperation(value.project, scope);
  assertCrypto(project.projectId === value.intent.projectId && project.operationId === value.operationId && project.intent.kind === "create" &&
    project.intent.appId === value.appId && project.intent.role === "workspace" && project.intent.actorDeviceId === value.intent.actorDeviceId &&
    project.intent.sourceDeviceId === value.intent.sourceDeviceId && project.intent.createdAt === value.intent.createdAt);
  verifyRecordPacket(value.facts, appRecordContext(scope, value.appId, value.operationId, value.intent, "facts"));
  verifyRecordPacket(value.operation, appPromotionContext(scope, value)); return value;
}
