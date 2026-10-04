/**
 * [INPUT]: Depends on Zod, the public operation-receipt contract and VerifiedPrincipal
 * [OUTPUT]: Provides OperationBroker (one adapter per family; query returns a validated operation-receipt/v1), OperationFamilyAdapter, OperationBrokerError and absentReceipt
 * [POS]: Read-only facade over the existing ledgers; it stores nothing, so after any restart it answers exactly what the native owners answer, and a missing record is reported as unknown, never as not-admitted
 */
import type { z } from "zod";
import { OPERATION_RECEIPT_SCHEMA, operationReceiptSchema, type OperationFamily, type OperationReceipt } from "@ai-chat/cloud-protocol/contracts/operations";
import type { Principal } from "@ai-chat/cloud-protocol/contracts/principals";
import type { VerifiedPrincipal } from "./principals";

/** What an adapter learned about who owns the operation, for the authorization check after the read. */
export type OperationSubject = Readonly<{ chatId?: string; ownerKey?: string }>;
export type FamilyRead = Readonly<{ receipt: OperationReceipt; subject: OperationSubject }> | null;

export type OperationFamilyAdapter<L> = Readonly<{
  family: OperationFamily;
  locator: z.ZodType<L>;
  operationId(locator: L): string;
  read(locator: L): Promise<FamilyRead> | FamilyRead;
  /** When the locator itself names the owner, authorization can be decided even for an absent record. */
  subjectOf?(locator: L): OperationSubject;
  /** Default deny: return true only when this principal provably owns the operation. */
  authorize(principal: Principal, subject: OperationSubject): boolean;
}>;

export class OperationBrokerError extends Error {
  readonly name = "OperationBrokerError";
  constructor(readonly code: "unknown-family" | "locator-invalid" | "principal-denied" | "family-unavailable" | "family-mismatch", message: string) {
    super(message);
  }
}

/** No native record: the outcome is unknown, which is never evidence that the operation was not admitted. */
export function absentReceipt(family: OperationFamily, operationId: string): OperationReceipt {
  return operationReceiptSchema.parse({ schema: OPERATION_RECEIPT_SCHEMA, family, operationId, requestDigest: null,
    nativeReceiptRef: `${family}:${operationId}`, nativeState: "absent", state: "outcome-unknown", receiptRevision: 1,
    admission: { state: "unknown" }, resultRef: null, error: { code: "native-record-absent" }, stop: "not-applicable",
    innerEffect: "not-applicable", resolvedBy: null });
}

/** Local device principals own every local operation; everything else must be granted by the family. */
const deviceOwnsAll = (principal: Principal) => principal.kind === "user-device";

export class OperationBroker {
  private readonly adapters = new Map<OperationFamily, OperationFamilyAdapter<unknown>>();

  register<L>(adapter: OperationFamilyAdapter<L>) {
    if (this.adapters.has(adapter.family)) throw new Error(`operation family already registered: ${adapter.family}`);
    this.adapters.set(adapter.family, adapter as OperationFamilyAdapter<unknown>);
  }

  families() { return [...this.adapters.keys()].sort(); }

  async query(principal: VerifiedPrincipal, family: OperationFamily, input: unknown): Promise<OperationReceipt> {
    const adapter = this.adapters.get(family);
    if (!adapter) throw new OperationBrokerError("unknown-family", family);
    const locator = adapter.locator.safeParse(input);
    if (!locator.success) throw new OperationBrokerError("locator-invalid", locator.error.issues[0]?.message ?? "locator invalid");
    await principal.refresh?.();
    principal.assertCurrent();
    const operationId = adapter.operationId(locator.data);
    let read: FamilyRead;
    try { read = await adapter.read(locator.data); } catch (cause) {
      /* One owner failing (worker restarting, store closed) is that family's outage, never the broker's. */
      throw new OperationBrokerError("family-unavailable", `${family}: ${(cause as Error)?.message ?? String(cause)}`);
    }
    const subject = read?.subject ?? adapter.subjectOf?.(locator.data) ?? {};
    if (!deviceOwnsAll(principal.principal) && !adapter.authorize(principal.principal, subject)) {
      throw new OperationBrokerError("principal-denied", `${principal.principal.kind} may not read this ${family} operation`);
    }
    if (!read) return absentReceipt(family, operationId);
    const receipt = operationReceiptSchema.parse(read.receipt);
    if (receipt.family !== family || receipt.operationId !== operationId) throw new OperationBrokerError("family-mismatch", `${family} answered for another operation`);
    return receipt;
  }
}
