/**
 * [INPUT]: Authenticated original candidate operations and a newly reviewed native resolution capture.
 * [OUTPUT]: Exact original-value resolution validation before ciphertext preparation.
 * [POS]: Client semantic authority; ciphertext-blind servers validate only the matching structural commitment.
 */
import { assertCrypto } from "../../../encryption";
import { canonicalJson, type BaseOperation } from "../../operations";
import type { BaseMergeState } from "../../merge";
import type { BaseCipherFiles, BaseCipherPort } from "./model";
import { prepareEncryptedBaseCommit } from "./prepare";
export function assertBaseResolution(original: BaseOperation, indexes: readonly number[], resolution: BaseOperation) {
  const selected = [...indexes].sort((a, b) => a - b);
  assertCrypto(selected.length > 0 && new Set(selected).size === selected.length && resolution.baseId === original.baseId &&
    resolution.operationId !== original.operationId && Boolean(resolution.atomicGroup) === Boolean(original.atomicGroup) &&
    selected.length === resolution.patches.length && selected.every((index, offset) =>
      original.patches[index] && canonicalJson(original.patches[index]) === canonicalJson(resolution.patches[offset])));
}
export async function prepareEncryptedBaseResolution(port: BaseCipherPort, original: BaseOperation, indexes: readonly number[],
  resolution: BaseOperation, capture: BaseMergeState, files?: BaseCipherFiles) {
  assertBaseResolution(original, indexes, resolution); return prepareEncryptedBaseCommit(port, resolution, capture, files);
}
