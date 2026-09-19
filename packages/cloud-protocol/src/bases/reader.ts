/**
 * [INPUT]: Depends on bounded Base page RPCs, immutable receipts and complete snapshot schemas.
 * [OUTPUT]: Provides account-scoped snapshot/delta assembly with revision fences and explicit capacity failures.
 * [POS]: SDK-free read adapter shared by desktop and Web; a failed or changing scan never replaces confirmed data.
 */
import { z } from "zod";
import { baseRowSchema } from "@ai-chat/base-ui/model/bases-schema";
import { baseSnapshotSchema, decodeBasePage, type CloudBaseSnapshot } from "./snapshot";
import { decodeBaseReceipt, type businessHeaderSchema } from "./functions";
import { fieldVersionMapSchema, versionSchema } from "./operations";

type ReadName = "bases/pages:head" | "bases/pages:rows" | "bases/pages:tombstones" | "bases/api:getReceipt";
type LocalHeader = z.infer<typeof businessHeaderSchema>;
type BaseReadArgs<N extends ReadName> = LocalHeader & { baseId: string } & (N extends "bases/api:getReceipt" ? { operationId: string } :
  N extends "bases/pages:rows" | "bases/pages:tombstones" ? { revision: number; afterRevision: number | null; cursor: string | null } : object);
export type BaseReadTransport = {
  query<N extends ReadName>(name: N, args: BaseReadArgs<N>): Promise<N extends "bases/api:getReceipt" ? string | null : string>;
};
const baseHeadSchema = baseSnapshotSchema.omit({ rows: true, rowVersions: true, tombstones: true, receipts: true });
const changed = z.object({ status: z.literal("changed"), revision: versionSchema }).strict();
const page = { status: z.literal("ready"), revision: versionSchema, cursor: z.string().nullable(), complete: z.boolean() };
const baseRowsPageSchema = z.union([changed, z.object({ ...page, items: z.array(z.object({ row: baseRowSchema,
  fieldVersions: fieldVersionMapSchema, lifeVersion: versionSchema.optional(), revision: versionSchema }).strict()).max(100) }).strict()]);
const baseTombstonesPageSchema = z.union([changed, z.object({ ...page, items: z.array(z.string().min(1).max(384)).max(100) }).strict()]);
const decodeBaseHead = (input: string) => decodeBasePage(input, baseHeadSchema);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
class RevisionChanged extends Error {}
export class BaseSnapshotReader {
  private cached: CloudBaseSnapshot | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  constructor(private readonly transport: BaseReadTransport, private readonly header: z.infer<typeof businessHeaderSchema>, private readonly baseId: string) {}
  clear() { this.generation++; this.cached = null; }
  read(operationIds: string[] = []): Promise<CloudBaseSnapshot> {
    const generation = this.generation;
    const current = () => { if (generation !== this.generation) throw new Error("cloud-request-superseded"); };
    const result = this.tail.catch(() => {}).then(async () => {
      current();
      if (operationIds.length > 64 || new Set(operationIds).size !== operationIds.length) throw new Error("receipt-query-limit");
      for (let attempt = 0; attempt < 3; attempt++) {
        try { const snapshot = await this.collect(operationIds, current); current(); this.cached = snapshot; return snapshot; }
        catch (error) { if (!(error instanceof RevisionChanged)) throw error; }
      }
      throw new Error("base-updating");
    });
    this.tail = result; return result;
  }
  private async collect(operationIds: string[], current: () => void) {
    const args = { ...this.header, baseId: this.baseId };
    const head = decodeBaseHead(await this.transport.query("bases/pages:head", args)); current();
    if (head.baseId !== this.baseId) throw new Error("base-identity-mismatch");
    const previous = this.cached && this.cached.cloudRevision <= head.cloudRevision ? this.cached : null;
    const rows = new Map(previous?.rows.map(row => [row.id, row]) ?? []);
    const rowVersions = { ...previous?.rowVersions }, fieldVersions = { ...previous?.fieldVersions, ...head.fieldVersions };
    const tombstones = new Set(previous?.tombstones ?? []);
    let contentBytes = previous ? bytes(previous) : bytes(head), pageCount = 0;
    const budget = () => {
      if (++pageCount > 512 || contentBytes > 16_777_216 || rows.size > 10_000 || tombstones.size > 20_000) throw new Error("base-read-limit");
    };
    if (!previous || previous.cloudRevision !== head.cloudRevision) {
      const pageArgs = { ...args, revision: head.cloudRevision, afterRevision: previous?.cloudRevision ?? null };
      let cursor: string | null = null;
      do {
        const result: z.infer<typeof baseRowsPageSchema> = decodeBasePage(await this.transport.query("bases/pages:rows", { ...pageArgs, cursor }), baseRowsPageSchema); current();
        if (result.status === "changed" || result.revision !== head.cloudRevision) throw new RevisionChanged();
        for (const item of result.items) {
          contentBytes -= rows.has(item.row.id) ? bytes(rows.get(item.row.id)) : 0;
          rows.set(item.row.id, item.row); rowVersions[item.row.id] = item.revision; fieldVersions[`row:${item.row.id}`] = item.lifeVersion ?? item.revision;
          for (const [id, version] of Object.entries(item.fieldVersions)) fieldVersions[`cell:${item.row.id}:${id}`] = version;
          contentBytes += bytes(item);
        }
        budget();
        if (!result.complete && (!result.cursor || cursor === result.cursor)) throw new Error("invalid-page-cursor");
        cursor = result.complete ? null : result.cursor;
      } while (cursor !== null);
      do {
        const result: z.infer<typeof baseTombstonesPageSchema> = decodeBasePage(await this.transport.query("bases/pages:tombstones", { ...pageArgs, cursor }), baseTombstonesPageSchema); current();
        if (result.status === "changed" || result.revision !== head.cloudRevision) throw new RevisionChanged();
        for (const target of result.items) { tombstones.add(target); contentBytes += bytes(target); }
        budget();
        if (!result.complete && (!result.cursor || cursor === result.cursor)) throw new Error("invalid-page-cursor");
        cursor = result.complete ? null : result.cursor;
      } while (cursor !== null);
    }
    for (const target of tombstones) if (target.startsWith("row:")) {
      const id = target.slice(4); rows.delete(id); delete rowVersions[id];
      for (const key of Object.keys(fieldVersions)) if (key === target || key.startsWith(`cell:${id}:`)) delete fieldVersions[key];
    }
    const receipts = [];
    for (const operationId of operationIds) {
      const raw = await this.transport.query("bases/api:getReceipt", { ...args, operationId }); current();
      if (raw) receipts.push(decodeBaseReceipt(raw));
    }
    const final = decodeBaseHead(await this.transport.query("bases/pages:head", args)); current();
    if (final.cloudRevision !== head.cloudRevision || receipts.some(receipt => receipt.cloudRevision > head.cloudRevision)) throw new RevisionChanged();
    const snapshot = baseSnapshotSchema.parse({ ...head, rows: [...rows.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      fieldVersions, rowVersions, tombstones: [...tombstones].sort(), receipts });
    if (bytes(snapshot) > 16_777_216) throw new Error("base-read-limit");
    return snapshot;
  }
}
