/**
 * [INPUT]: Depends on zod, DurableJson and the BaseRef contract
 * [OUTPUT]: Provides BaseGrantStore: durable per-package, per-generation read/write grants on one exact Base instance
 * [POS]: The authorization table behind the public Base ports for host packages (BAS-12); a package names a BaseRef, the host decides, and a new package generation or a new Base instance needs a new grant (B2, B5)
 */
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";
import type { BaseRef } from "@ai-chat/cloud-protocol/contracts/resources";

const grantSchema = z.object({ installIdentity: z.string().min(1).max(128), generationId: z.string().min(1).max(128),
  ownerKey: z.string().min(1).max(256), ownerInstanceId: z.string().min(1).max(128), access: z.enum(["read", "write"]),
  grantedAt: z.number().int().min(0) }).strict();
const ledgerSchema = z.object({ version: z.literal(1), grants: z.array(grantSchema).max(4_096) }).strict();
export type BaseGrant = z.infer<typeof grantSchema>;

export class BaseGrantStore {
  private readonly ledger: DurableJson<z.infer<typeof ledgerSchema>>;

  constructor(userData: string, private readonly now: () => number = Date.now) {
    this.ledger = new DurableJson(join(userData, "bases", "public-grants.json"), ledgerSchema, () => ({ version: 1 as const, grants: [] }));
  }

  initialize() { return this.ledger.initialize(); }

  grant(input: Omit<BaseGrant, "grantedAt">) {
    return this.ledger.mutate(state => {
      state.grants = state.grants.filter(item => !sameTarget(item, input));
      state.grants.push({ ...input, grantedAt: this.now() });
    });
  }

  /** Uninstall and explicit revocation: nothing of the package's access survives (B5). */
  revokePackage(installIdentity: string) {
    return this.ledger.mutate(state => { state.grants = state.grants.filter(item => item.installIdentity !== installIdentity); });
  }

  allows(caller: { installIdentity: string; generationId: string }, base: BaseRef, access: "read" | "write") {
    return this.ledger.snapshot().grants.some(item => item.installIdentity === caller.installIdentity && item.generationId === caller.generationId &&
      item.ownerKey === base.ownerKey && item.ownerInstanceId === base.ownerInstanceId && (item.access === "write" || access === "read"));
  }

  close() { return this.ledger.closeAndFlush(); }
}

const sameTarget = (left: Omit<BaseGrant, "grantedAt">, right: Omit<BaseGrant, "grantedAt">) =>
  left.installIdentity === right.installIdentity && left.generationId === right.generationId && left.ownerKey === right.ownerKey &&
  left.ownerInstanceId === right.ownerInstanceId;
