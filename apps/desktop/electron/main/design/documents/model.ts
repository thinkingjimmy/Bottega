/**
 * [INPUT]: Shared closed design/system schemas and Node content hashing; no App identity or renderer authority.
 * [OUTPUT]: Design/system manifest types, strict source limits/read sets and bounded domain errors.
 * [POS]: Artifact document contract shared by the checker, journal and snapshot renderer.
 */
import { createHash } from "node:crypto";
export { designId, sourcePath, manifestSchema, type DesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/model";

export const DESIGN_LIMITS = Object.freeze({ boards: 16, files: 64, manifest: 64 * 1024,
  html: 8 * 1024 * 1024, source: 32 * 1024 * 1024, archive: 50_000_000,
  issues: 32, stableMs: 1_000, intervalMs: 500, waitMs: 10_000 });
export type DesignAuthority = Readonly<{ chatId: string; incarnationId: string; workspace: string;
  ownerId: string; authorityIdentity: string }>;
export type DesignSourceFile = Readonly<{ path: string; data: Buffer; digest: string; stamp: string }>;
export type DesignReadSet = Readonly<{ path: string; files: readonly DesignSourceFile[];
  readSetDigest: string; bytes: number }>;
export type DesignIssue = Readonly<{ file: string; message: string }>;
export type DesignErrorCode = "NOT_READY" | "SOURCE_CHANGED" | "REVISION_CONFLICT" | "REQUEST_MISMATCH" |
  "UNREADABLE" | "STORAGE_FAILED" | "INVALID_DOCUMENT" | "PATH_DENIED" | "BUDGET_EXCEEDED" | "ARTIFACT_DISABLED";
export class DesignDocumentError extends Error {
  constructor(readonly code: DesignErrorCode, message: string, readonly issues: readonly DesignIssue[] = []) {
    super(message); this.name = "DesignDocumentError";
  }
}
export const designDigest = (data: Uint8Array | string) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
export const documentKey = (authority: Pick<DesignAuthority, "ownerId" | "chatId" | "incarnationId">, documentId: string) => JSON.stringify([authority.ownerId, authority.chatId, authority.incarnationId, documentId]);
export const requestKey = (authority: Pick<DesignAuthority, "chatId" | "incarnationId">, requestId: string) =>
  JSON.stringify([authority.chatId, authority.incarnationId, requestId]);
