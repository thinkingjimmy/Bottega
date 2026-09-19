/**
 * [INPUT]: Typed ciphertext RPCs, original Base/operation requests, a fresh worker port and frozen transport pairs.
 * [OUTPUT]: Request-bound decrypted transport for the existing complete native snapshot reader.
 * [POS]: Client boundary adapter; raw encrypted DTOs never enter native reconciliation directly.
 */
import { assertCrypto } from "../../../encryption";
import { validateBaseModel } from "@ai-chat/base-ui/compute/base-mutation-validation";
import type { CloudFunctionArgs, CloudFunctionResult } from "../../../auth/functions";
import { canonicalJson } from "../../operations";
import { BaseSnapshotReader, type BaseReadTransport } from "../../reader";
import { baseSnapshotSchema } from "../../snapshot";
import { encryptedBaseFunctions, encryptedBaseSnapshotSchema } from "../functions";
import type { BaseCipherFiles, BaseCipherPort, FrozenBaseTransport } from "./model";
import { openEncryptedBaseHead, openEncryptedBaseReceipt, openEncryptedBaseRow } from "./open";
type ReadName = "bases/pages:head" | "bases/pages:rows" | "bases/pages:tombstones" | "bases/api:getReceipt";
export type BaseCipherReadTransport = { query<N extends ReadName>(name: N, args: CloudFunctionArgs<N>): Promise<CloudFunctionResult<N>> };
export function createEncryptedBaseReadTransport(input: { transport: BaseCipherReadTransport; crypto(): BaseCipherPort; files?: BaseCipherFiles;
  pair(operationId: string): FrozenBaseTransport | undefined }): BaseReadTransport {
  return { async query(name, args) {
    const port = input.crypto(); assertCrypto(port.session.userId === args.expectedUserId);
    const scoped = { ...args, encryptedSpace: { scope: port.scope, keyPackageFingerprint: port.keyPackageFingerprint } };
    let result: string | null;
    if (name === "bases/pages:head") {
      const value = await input.transport.query("bases/pages:head", encryptedBaseFunctions["bases/pages:head"].args.parse(scoped));
      result = canonicalJson(await openEncryptedBaseHead(port, args.baseId, value));
    } else if (name === "bases/pages:rows") {
      const page = await input.transport.query("bases/pages:rows", encryptedBaseFunctions["bases/pages:rows"].args.parse(scoped));
      if (page.status === "changed") result = canonicalJson(page);
      else {
        const items = [];
        for (const row of page.items) items.push(await openEncryptedBaseRow(port, args.baseId, row, input.files));
        result = canonicalJson({ ...page, items });
      }
    } else if (name === "bases/pages:tombstones") {
      result = canonicalJson(await input.transport.query("bases/pages:tombstones", encryptedBaseFunctions["bases/pages:tombstones"].args.parse(scoped)));
    } else {
      const request = encryptedBaseFunctions["bases/api:getReceipt"].args.parse(scoped);
      const value = await input.transport.query("bases/api:getReceipt", request);
      if (!value) result = null;
      else {
        assertCrypto(value.baseId === request.baseId && value.operationId === request.operationId);
        const pair = input.pair(request.operationId);
        if (!pair) throw new Error("BASE_CIPHERTEXT_PAIR_REQUIRED");
        result = canonicalJson(await openEncryptedBaseReceipt(port, request, value, pair, input.files));
      }
    }
    return result as typeof name extends "bases/api:getReceipt" ? string | null : string;
  } };
}
export function createEncryptedBaseReader(input: Parameters<typeof createEncryptedBaseReadTransport>[0], header: ConstructorParameters<typeof BaseSnapshotReader>[1], baseId: string) {
  const reader = new BaseSnapshotReader(createEncryptedBaseReadTransport(input), header, baseId), read = reader.read.bind(reader);
  reader.read = async (...args) => { const snapshot = await read(...args); validateBaseModel(snapshot.meta, snapshot.rows); return snapshot; };
  return reader;
}
export async function openEncryptedBaseSnapshot(port: BaseCipherPort, request: { baseId: string; operationIds: readonly string[] }, input: unknown,
  pairs: (id: string) => FrozenBaseTransport | undefined, files?: BaseCipherFiles) {
  const { baseId } = request, operationIds = new Set(request.operationIds);
  const raw = encryptedBaseSnapshotSchema.parse(input);
  assertCrypto(request.operationIds.length <= 64 && operationIds.size === request.operationIds.length &&
    new Set(raw.receipts.map(receipt => receipt.operationId)).size === raw.receipts.length &&
    raw.head.baseId === baseId && raw.head.initial.baseId === baseId && raw.receipts.every(receipt =>
      receipt.baseId === baseId && receipt.commit.baseId === baseId && operationIds.has(receipt.operationId) && receipt.commit.operationId === receipt.operationId));
  const head = await openEncryptedBaseHead(port, baseId, raw.head), rows = [], rowVersions: Record<string, number> = {},
    fieldVersions = { ...head.fieldVersions }, receipts = [];
  for (const source of raw.rows) {
    const item = await openEncryptedBaseRow(port, head.baseId, source, files); rows.push(item.row); rowVersions[item.row.id] = item.revision;
    fieldVersions[`row:${item.row.id}`] = item.lifeVersion;
    for (const [id, version] of Object.entries(item.fieldVersions)) fieldVersions[`cell:${item.row.id}:${id}`] = version;
  }
  for (const receipt of raw.receipts) {
    const pair = pairs(receipt.operationId); if (!pair) throw new Error("BASE_CIPHERTEXT_PAIR_REQUIRED");
    receipts.push(await openEncryptedBaseReceipt(port, { baseId, operationId: receipt.operationId }, receipt, pair, files));
  }
  const snapshot = baseSnapshotSchema.parse({ ...head, rows, rowVersions, fieldVersions, tombstones: raw.tombstones, receipts });
  validateBaseModel(snapshot.meta, snapshot.rows); return snapshot;
}
