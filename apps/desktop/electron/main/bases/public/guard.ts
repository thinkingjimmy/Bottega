/**
 * [INPUT]: Depends on Node crypto/fs/path and the locale-independent canonical digest
 * [OUTPUT]: Provides FieldGuardSigner (issue/verify host-signed field guards), fieldValueDigest and columnSchemaDigest
 * [POS]: The BAS-09 guard token: a durable host key signs principal + Base instance + row + each field's prior-value and schema digests, so a caller can hold a guard across restarts and a 24 h confirmation but can never write one
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalSha256Hex } from "../../persistence/canonical-digest";

export type GuardedField = Readonly<{ value: string; schema: string }>;
export type FieldGuard = Readonly<{ v: 1; principal: string; ownerKey: string; ownerInstanceId: string; rowId: string;
  fields: Readonly<Record<string, GuardedField>>; issuedAt: number }>;

/** Absent and present-but-null are different prior values. */
export const fieldValueDigest = (value: unknown) => value === undefined ? "absent" : canonicalSha256Hex(value);
/** Type, options and relation target: a change here is a schema change even when the column id stays. */
export const columnSchemaDigest = (column: { type: string; options?: readonly { id: string }[]; relation?: unknown } | undefined) =>
  column ? canonicalSha256Hex({ type: column.type, options: column.options?.map(option => option.id) ?? null, relation: column.relation ?? null }) : "absent";

export class FieldGuardSigner {
  private key: Buffer | null = null;

  constructor(private readonly keyPath: string, private readonly now: () => number = Date.now) {}

  async initialize() {
    try { this.key = Buffer.from(await readFile(this.keyPath, "utf8"), "base64url"); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      await mkdir(dirname(this.keyPath), { recursive: true, mode: 0o700 });
      const key = randomBytes(32);
      /* `wx`: two starts racing never overwrite each other's key and orphan every guard already issued. */
      await writeFile(this.keyPath, key.toString("base64url"), { mode: 0o600, flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      this.key = Buffer.from(await readFile(this.keyPath, "utf8"), "base64url");
    }
    if (this.key.length !== 32) throw new Error("field guard key is corrupt");
  }

  issue(guard: Omit<FieldGuard, "v" | "issuedAt">): string {
    const body = Buffer.from(JSON.stringify({ v: 1, ...guard, issuedAt: this.now() })).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  /** The guard must be ours, untouched, and issued to this principal for this Base instance and row (B15). */
  verify(token: string, expected: { principal: string; ownerKey: string; ownerInstanceId: string; rowId: string }): FieldGuard {
    const [body, mac] = token.split(".");
    const valid = body && mac && mac.length === 43 && timingSafeEqual(Buffer.from(mac), Buffer.from(this.mac(body)));
    if (!valid) throw Object.assign(new Error("field guard is not a host-issued guard"), { status: 403, code: "guard-invalid" });
    const guard = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as FieldGuard;
    for (const [name, value] of Object.entries(expected)) {
      if (guard[name as keyof typeof expected] !== value) throw Object.assign(new Error(`field guard was issued for another ${name}`), { status: 403, code: "guard-mismatch" });
    }
    return guard;
  }

  private mac(body: string) {
    if (!this.key) throw new Error("field guard signer is not initialized");
    return createHmac("sha256", this.key).update(body).digest("base64url");
  }
}
