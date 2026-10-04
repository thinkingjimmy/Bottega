/**
 * [INPUT]: Depends on the extension trust gate (extensions/trust/gate), its verdict types, and the host-package adapter id.
 * [OUTPUT]: Provides admissionVerdict (a host package's verdict over its adopted bytes; null for the other families, which carry no signature), reverifyReplay (a crash replay's re-verification, terminal on refusal), ExtensionTrustRefusedError (coded extension-trust-refused), isTrustRefusal and the TrustVerdict type.
 * [POS]: extensions/install's trust step (TASK-14 S7): preflight, confirm and every crash replay run it before authorization, so a snapshot that revoked the package in between is honoured; the installer makes a refusal terminal (abort, collect the bytes, release the Project claim).
 */
import type { PackageSignature } from "@bottega/contracts/trust/signing";
import type { ExtensionAdapterId } from "../admission";
import type { AuthorizedExtensionInstall, ExtensionLifecycleOperation } from "../lifecycle/lifecycle-ledger";
import { HOST_PACKAGE_ADAPTER_ID } from "../host/manifest";
import type { ExtensionTrustGate } from "../trust/gate";
import type { RefusalReason, TrustVerdict } from "../trust/verifier";

export type { TrustVerdict };

export class ExtensionTrustRefusedError extends Error {
  readonly name = "ExtensionTrustRefusedError";
  readonly code = "extension-trust-refused";
  readonly status = 403;
  constructor(readonly reason: RefusalReason) { super(`extension-trust-refused: ${reason}`); }
}
export const isTrustRefusal = (cause: unknown): cause is ExtensionTrustRefusedError => cause instanceof ExtensionTrustRefusedError;

/**
 * Trusted and local confirmation both continue into today's path, which already asks the person; only a refusal stops. A remote
 * caller cannot supply a verdict: it is computed here, from the adopted bytes and the signature staged beside them.
 */
export async function admissionVerdict(gate: ExtensionTrustGate, input: {
  adapterId: ExtensionAdapterId; packageRoot: string; contentDigest: string; signature: PackageSignature | null;
}): Promise<TrustVerdict | null> {
  if (input.adapterId !== HOST_PACKAGE_ADAPTER_ID) return null;
  const verdict = await gate.verify({ key: `admission:${input.contentDigest}`, signature: input.signature,
    contentDigest: input.contentDigest, packageRoot: input.packageRoot });
  if (verdict.status === "refused") throw new ExtensionTrustRefusedError(verdict.reason);
  return verdict;
}

/** A replayed install is re-verified against the latest snapshot; a refusal abandons it (terminal: nothing stays prepared to retry forever). */
export async function reverifyReplay(gate: ExtensionTrustGate, operation: ExtensionLifecycleOperation, replay: AuthorizedExtensionInstall,
  ports: { contentRoot(digest: string): string; abandon(): Promise<void> }) {
  const contentDigest = operation.contentDigest!;
  try {
    await admissionVerdict(gate, { adapterId: replay.adapterId, packageRoot: ports.contentRoot(contentDigest), contentDigest, signature: replay.signature });
  } catch (cause) {
    if (isTrustRefusal(cause)) await ports.abandon();
    throw cause;
  }
}
