/**
 * [INPUT]: Pure encrypted scopes/context/hash types and safe failure codes.
 * [OUTPUT]: Closed worker request/result and minimal transport interfaces.
 * [POS]: Private client worker protocol; never used as renderer IPC or server RPC.
 */
import type { CiphertextHash, CryptoContext, CryptoErrorCode, CryptoScope, KeyPackageFingerprint } from "@ai-chat/cloud-protocol/encryption";
import type { BackendEvidence } from "./engine/backend";

export type CryptoCommand =
  | { kind: "create"; password: string; source: Pick<CryptoScope, "sourceEnvironment" | "sourceAccountId"> }
  | { kind: "unlock"; password: string; keyPackage: Uint8Array; expectedScope: CryptoScope; expectedFingerprint: KeyPackageFingerprint | null }
  | { kind: "encrypt"; context: CryptoContext; plaintext: Uint8Array }
  | { kind: "decrypt"; expectedContext: CryptoContext; envelope: Uint8Array }
  | { kind: "export-local-key"; expectedScope: CryptoScope; expectedFingerprint: KeyPackageFingerprint }
  | { kind: "import-local-key"; expectedScope: CryptoScope; expectedFingerprint: KeyPackageFingerprint; keyPackage: Uint8Array; rootKey: Uint8Array }
  | { kind: "skill-slug-key"; expectedScope: CryptoScope; normalizedSlug: string }
  | { kind: "status" }
  | { kind: "lock" };

export type CryptoResult =
  | { kind: "created"; scope: CryptoScope; keyPackage: Uint8Array; fingerprint: KeyPackageFingerprint; evidence: BackendEvidence }
  | { kind: "unlocked"; scope: CryptoScope; fingerprint: KeyPackageFingerprint; evidence: BackendEvidence }
  | { kind: "encrypted"; envelope: Uint8Array; ciphertextHash: CiphertextHash }
  | { kind: "decrypted"; plaintext: Uint8Array }
  | { kind: "exported-local-key"; scope: CryptoScope; fingerprint: KeyPackageFingerprint; rootKey: Uint8Array }
  | { kind: "status"; unlocked: boolean; scope: CryptoScope | null; evidence: BackendEvidence | null }
  | { kind: "skill-slug-key"; slugKey: string }
  | { kind: "locked" };

export interface CryptoWorkerRequest { id: number; generation: number; command: CryptoCommand }
export type CryptoWorkerResponse = { id: number; generation: number } & ({ ok: true; result: CryptoResult } | { ok: false; error: CryptoErrorCode });

export interface CryptoWorkerPort {
  postMessage(request: CryptoWorkerRequest, transfer?: ArrayBuffer[]): void;
  onMessage(listener: (response: CryptoWorkerResponse) => void): () => void;
  onError(listener: () => void): () => void;
  terminate(): void | Promise<void>;
}

export interface CryptoWorkerEndpoint {
  postMessage(response: CryptoWorkerResponse, transfer?: ArrayBuffer[]): void;
  onMessage(listener: (request: CryptoWorkerRequest) => void): void;
}
