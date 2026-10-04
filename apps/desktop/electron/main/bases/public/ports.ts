/**
 * [INPUT]: BasesService, scoped grants, field guards, result storage and main-constructed caller identity.
 * [OUTPUT]: BasePublicPorts for guarded Base operations; record-slot callers can read/report only their selected row and listed results, with no structural, field or attachment authority.
 * [POS]: Public Base authority shared by Agent turns, package services and isolated record actions.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { BaseRef } from "@ai-chat/cloud-protocol/contracts/resources";
import { truncateSummary, type FieldOutcome, attachmentInputSchema, describeInputSchema, queryInputSchema, readInputSchema, reportInputSchema,
  resultReadInputSchema, resultsInputSchema, rowsDeleteInputSchema, rowsInsertInputSchema, rowsPatchInputSchema, writeFieldsInputSchema,
} from "@ai-chat/cloud-protocol/contracts/base/records";
import { ownerKeyOf as ownerKeyOfOwner } from "@ai-chat/base-core/model/owner-key";
import type { BaseSnapshot, BaseRow, BaseCellValue } from "../../../../shared/bases/model/bases-ipc";
import { canonicalSha256Hex } from "../../persistence/canonical-digest";
import { statusError } from "../../ipc/errors";
import type { BasesService } from "../bases-service";
import { BASE_QUERY_RESULT_BYTE_LIMIT, queryBase, selectRows, type ReadArgs } from "../base-read";
import type { ToolRowsRequest } from "../service/tool/rows";
import { columnSchemaDigest, fieldValueDigest, type FieldGuardSigner } from "./guard";
import type { BaseGrantStore } from "./grants";
import type { RunResultStore } from "./results";

/** Who is calling, as the host verified it: an Agent turn is authorized by its Chat, a package by its grants. */
export type PortCaller = Readonly<{ key: string } & ({ kind: "agent-turn"; chat: { chatId: string; incarnationId: string } } |
  { kind: "package"; installIdentity: string; generationId: string } |
  { kind: "record-slot"; base: BaseRef; rowId: string; write: boolean })>;

type Input<S extends z.ZodType> = z.output<S>;
const CODE: Readonly<Record<FieldOutcome, string>> = { applied: "A", "already-applied": "R", blocked: "B" };
const OUTCOME = Object.fromEntries(Object.entries(CODE).map(([name, code]) => [code, name])) as Record<string, FieldOutcome>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const schemaDigestOf = (base: BaseSnapshot) =>
  canonicalSha256Hex(base.meta.columns.map(column => ({ id: column.id, schema: columnSchemaDigest(column as never) })));

export class BasePublicPorts {
  constructor(private readonly deps: { service: BasesService; guards: FieldGuardSigner; grants: BaseGrantStore; results: RunResultStore }) {}

  async describe(caller: PortCaller, input: Input<typeof describeInputSchema>) {
    this.unboundOnly(caller);
    let base = this.current(input.base, true);
    if (!base && input.create) {
      /* Creating is an explicit request, and only the Chat that owns the Base can make it (B1). */
      if (caller.kind !== "agent-turn") throw statusError(403, "only the owning Chat can create its Base", { code: "create-denied" });
      base = await this.deps.service.snapshotForLease(caller.chat.chatId, caller.chat.incarnationId, true);
      if (base.meta.ownerInstanceId !== input.base.ownerInstanceId) throw statusError(409, "Base instance changed", { code: "instance-changed" });
    }
    if (!base) throw statusError(404, "Base does not exist", { code: "not-found" });
    await this.authorize(caller, base, "read");
    return { base: input.base, name: base.meta.name, revision: base.meta.revision, rowCount: base.rows.length, schemaDigest: schemaDigestOf(base),
      columns: base.meta.columns.map(column => ({ id: column.id, name: column.name, type: column.type,
        ...("options" in column && column.options ? { options: column.options.map(option => ({ id: option.id, label: option.label })) } : {}) })) };
  }

  /** One revision per page; a different revision is a typed gap, never a mixed result (B7–B10). */
  async query(caller: PortCaller, input: Input<typeof queryInputSchema>) {
    this.unboundOnly(caller);
    const base = await this.readable(caller, input.base);
    const snapshot = { revision: base.meta.revision };
    if (input.snapshot && input.snapshot.revision !== base.meta.revision) return { status: "gap" as const, snapshot, reason: "revision-changed" as const };
    const args: ReadArgs = { limit: input.limit, cursor: input.cursor, columns: input.columns, sort: input.sort, filter: input.filter as ReadArgs["filter"] };
    try {
      const page = queryBase(base, args, BASE_QUERY_RESULT_BYTE_LIMIT - 4 * 1024);
      return { status: "page" as const, snapshot, rows: page.rows, total: selectRows(base, args).rows.length, next: page.nextCursor ?? null };
    } catch (cause) {
      if ((cause as { status?: number }).status === 409) return { status: "gap" as const, snapshot, reason: "revision-changed" as const };
      throw cause;
    }
  }

  async read(caller: PortCaller, input: Input<typeof readInputSchema>) {
    if (caller.kind === "record-slot" && input.rowIds.some(id => id !== caller.rowId)) throw statusError(403, "record-scope-denied");
    const base = await this.readable(caller, input.base);
    const columns = new Map(base.meta.columns.map(column => [column.id, column]));
    const fields = input.fields ?? [...columns.keys()];
    for (const id of fields) if (!columns.has(id)) throw statusError(400, `unknown column ${id}`, { code: "unknown-column" });
    const rows = new Map(base.rows.map(row => [row.id, row]));
    return { revision: base.meta.revision, schemaDigest: schemaDigestOf(base), rows: input.rowIds.map(rowId => {
      const row = rows.get(rowId);
      if (!row) return { rowId, missing: true };
      return { rowId, fields: Object.fromEntries(fields.map(id => [id, row.values[id] ?? null])),
        guard: this.deps.guards.issue({ principal: caller.key, ownerKey: input.base.ownerKey, ownerInstanceId: input.base.ownerInstanceId, rowId,
          fields: Object.fromEntries(fields.map(id => [id, { value: fieldValueDigest(row.values[id]), schema: columnSchemaDigest(columns.get(id) as never) }])) }) };
    }) };
  }

  /** Plain CRUD through the Agent tool ledger: the same request id replays the first answer (B4). */
  async rows(caller: PortCaller, kind: "insert", input: Input<typeof rowsInsertInputSchema>): Promise<unknown>;
  async rows(caller: PortCaller, kind: "patch", input: Input<typeof rowsPatchInputSchema>): Promise<unknown>;
  async rows(caller: PortCaller, kind: "delete", input: Input<typeof rowsDeleteInputSchema>): Promise<unknown>;
  async rows(caller: PortCaller, kind: "insert" | "patch" | "delete", input: { base: BaseRef; requestId: string; atomic: boolean } & Record<string, unknown>) {
    this.unboundOnly(caller);
    const base = await this.writable(caller, input.base);
    const request: ToolRowsRequest = kind === "insert" ? { kind, rows: input.rows as BaseRow[] }
      : kind === "patch" ? { kind, rows: input.rows as { rowId: string; patch: Record<string, BaseCellValue | null> }[] } : { kind, rowIds: input.rowIds as string[] };
    return this.deps.service.toolRows({ ownerKey: input.base.ownerKey, batchId: this.batchId(caller, base, kind, input.requestId), atomic: input.atomic,
      request, authority: await this.authority(caller, base, kind === "insert" ? "row-insert" : kind === "patch" ? "row-patch" : "row-delete"),
      actor: caller.kind === "agent-turn" ? "agent" : "system" });
  }

  /**
   * The guarded field write (BAS-09). Every field is decided on the snapshot the commit applies to: current = guarded prior
   * value → applied; current = desired → already-applied; anything else (changed or vanished) fails the whole write.
   */
  async writeFields(caller: PortCaller, input: Input<typeof writeFieldsInputSchema>) {
    this.unboundOnly(caller);
    const base = await this.writable(caller, input.base);
    const guard = this.deps.guards.verify(input.guard, { principal: caller.key, ownerKey: input.base.ownerKey,
      ownerInstanceId: input.base.ownerInstanceId, rowId: input.rowId });
    for (const write of input.writes) if (!guard.fields[write.columnId]) throw statusError(400, `guard does not cover ${write.columnId}`, { code: "guard-scope" });
    const batchId = this.batchId(caller, base, "write-fields", input.requestId);
    const decide = (current: BaseSnapshot) => {
      const row = current.rows.find(item => item.id === input.rowId);
      const columns = new Map(current.meta.columns.map(column => [column.id, column]));
      return input.writes.map((write): FieldOutcome => {
        const prior = guard.fields[write.columnId]!, column = columns.get(write.columnId);
        const vanished = !row || !column || columnSchemaDigest(column as never) !== prior.schema;
        if (vanished) return "blocked";
        const now = fieldValueDigest(row.values[write.columnId]);
        if (now === fieldValueDigest(write.value ?? undefined)) return "already-applied";
        return now === prior.value ? "applied" : "blocked";
      });
    };
    const result = await this.deps.service.toolRows({ ownerKey: input.base.ownerKey, batchId, atomic: true,
      request: { kind: "patch", rows: [{ rowId: input.rowId, patch: Object.fromEntries(input.writes.map(write => [write.columnId, write.value as BaseCellValue | null])) }] },
      authority: await this.authority(caller, base, "row-patch"), actor: caller.kind === "agent-turn" ? "agent" : "system",
      refine: (current, request) => {
        const outcomes = decide(current), note = `fields:${outcomes.map(outcome => CODE[outcome]).join("")}`;
        /* A field that moved fails the whole atomic write; the ledger records it as conflicted with the codes. */
        if (outcomes.includes("blocked")) throw statusError(409, "a block field changed", { code: note });
        const keep = new Set(input.writes.filter((_, index) => outcomes[index] === "applied").map(write => write.columnId));
        const patch = request.kind === "patch" ? request.rows[0]!.patch : {};
        return { request: { kind: "patch", rows: [{ rowId: input.rowId, patch: Object.fromEntries(Object.entries(patch).filter(([id]) => keep.has(id))) }] }, note };
      } });
    const receipt = this.deps.service.store.sync.read(input.base.ownerKey, input.base.ownerInstanceId).toolBatches
      .find(item => item.batchId === batchId);
    const codes = receipt?.reason?.startsWith("fields:") ? receipt.reason.slice("fields:".length) : "";
    const outcomes = input.writes.map((write, index) => ({ columnId: write.columnId, outcome: OUTCOME[codes[index] ?? ""] ?? "blocked" }));
    const blocked = receipt?.status !== "saved";
    /* The next guard advances the fields this write set, so the caller's following write is judged from here (B17). */
    const fields = { ...guard.fields };
    if (!blocked) for (const [index, write] of input.writes.entries()) {
      if (outcomes[index]!.outcome === "applied" || outcomes[index]!.outcome === "already-applied") {
        fields[write.columnId] = { ...fields[write.columnId]!, value: fieldValueDigest(write.value ?? undefined) };
      }
    }
    return { status: blocked ? "blocked" as const : "committed" as const, revision: result.revision, results: outcomes,
      guard: blocked ? null : this.deps.guards.issue({ principal: caller.key, ownerKey: input.base.ownerKey, ownerInstanceId: input.base.ownerInstanceId,
        rowId: input.rowId, fields }), sync: result.items[0]?.fields.map(field => field.status) ?? [] };
  }

  async attachment(caller: PortCaller, input: Input<typeof attachmentInputSchema>) {
    this.unboundOnly(caller);
    const base = await this.readable(caller, input.base);
    const cell = base.rows.find(row => row.id === input.rowId)?.values[input.columnId];
    /* An attachment cell holds one value, `{ kind: "attachment", attachmentId, … }` (base-values.ts); only that id is reachable here. */
    const listed = typeof cell === "object" && cell !== null && !Array.isArray(cell)
      && (cell as { kind?: unknown }).kind === "attachment" && (cell as { attachmentId?: unknown }).attachmentId === input.attachmentId;
    if (!listed) throw statusError(404, "attachment not found in this cell", { code: "not-found" }); // B6
    const file = await this.deps.service.readAttachmentForAppGui(input.base.ownerKey, input.attachmentId);
    const bytes = Buffer.from(file.bytes);
    return { filename: file.filename, mediaType: file.mediaType, total: bytes.length, offset: input.offset,
      chunk: bytes.subarray(input.offset, input.offset + input.length).toString("base64"), done: input.offset + input.length >= bytes.length };
  }

  /** A long report goes to the run result; the row gets a ≤ 1 KiB summary through the same guarded write (BAS-14). */
  async report(caller: PortCaller, input: Input<typeof reportInputSchema>) {
    if (caller.kind === "record-slot" && (input.rowId !== caller.rowId || input.summaryColumnId)) throw statusError(403, "record-scope-denied");
    const base = await this.writable(caller, input.base);
    const summary = truncateSummary(input.report);
    const slot = await this.deps.results.attach({ ownerInstanceId: base.meta.ownerInstanceId, rowId: input.rowId, report: input.report,
      label: input.label, truncated: summary.truncated, summaryColumnId: input.summaryColumnId ?? null, principal: caller.key });
    const written = input.summaryColumnId ? await this.writeFields(caller, { base: input.base, rowId: input.rowId, requestId: input.requestId,
      guard: input.guard, writes: [{ columnId: input.summaryColumnId, value: summary.text }] }) : null;
    return { result: slot, summary: { truncated: summary.truncated, bytes: summary.bytes, written: written?.results[0]?.outcome ?? null },
      guard: written?.guard ?? input.guard };
  }

  async results(caller: PortCaller, input: Input<typeof resultsInputSchema>) {
    if (caller.kind === "record-slot" && input.rowId !== caller.rowId) throw statusError(403, "record-scope-denied");
    const base = await this.readable(caller, input.base);
    return { rowId: input.rowId, results: this.deps.results.list(base.meta.ownerInstanceId, input.rowId) };
  }

  async result(caller: PortCaller, input: Input<typeof resultReadInputSchema>) {
    const base = await this.readable(caller, input.base);
    if (caller.kind === "record-slot" && !this.deps.results.list(base.meta.ownerInstanceId, caller.rowId).some(slot => slot.resultRef === input.resultRef))
      throw statusError(404, "result-not-found");
    return this.deps.results.read(base.meta.ownerInstanceId, input.resultRef, input.offset, input.length);
  }

  /* ── authorization ─────────────────────────────────────────────────────────────────────────── */

  /** The exact instance, or nothing: an old ownerInstanceId never resolves to the new Base behind the same key (B12). */
  private current(ref: BaseRef, allowMissing = false): BaseSnapshot | null {
    const peeked = this.deps.service.store.peek(ref.ownerKey);
    if (peeked && peeked.meta.ownerInstanceId !== ref.ownerInstanceId) throw statusError(409, "Base instance changed", { code: "instance-changed" });
    const base = peeked ? this.deps.service.store.get(ref.ownerKey, ref.ownerInstanceId) : null;
    if (!base && !allowMissing) throw statusError(404, "Base does not exist", { code: "not-found" });
    return base;
  }
  private async readable(caller: PortCaller, ref: BaseRef) { const base = this.current(ref)!; await this.authorize(caller, base, "read"); return base; }
  private async writable(caller: PortCaller, ref: BaseRef) { const base = this.current(ref)!; await this.authorize(caller, base, "write"); return base; }

  private async authorize(caller: PortCaller, base: BaseSnapshot, access: "read" | "write") {
    const ref = { ownerKey: ownerKeyOf(base), ownerInstanceId: base.meta.ownerInstanceId };
    if (caller.kind === "record-slot") {
      if (caller.base.ownerKey !== ref.ownerKey || caller.base.ownerInstanceId !== ref.ownerInstanceId || !base.rows.some(row => row.id === caller.rowId)
        || access === "write" && !caller.write) throw statusError(403, "record-scope-denied");
      return;
    }
    if (caller.kind === "package") {
      if (!this.deps.grants.allows(caller, ref, access)) throw statusError(403, `package has no ${access} grant on this Base`, { code: "not-granted" }); // B2
      return;
    }
    const principal = await this.deps.service.ownerResolver.resolvePrincipal(base.meta, caller.chat);
    if (!principal) throw statusError(403, "this Chat cannot use that Base", { code: "not-owner" });
  }

  private unboundOnly(caller: PortCaller) {
    if (caller.kind === "record-slot") throw statusError(403, "record-operation-denied");
  }

  private authority(caller: PortCaller, base: BaseSnapshot, operation: "row-insert" | "row-patch" | "row-delete") {
    return caller.kind === "agent-turn"
      ? this.deps.service.issueToolMutationAuthority({ ownerKey: ownerKeyOf(base), lease: caller.chat, operation })
      : this.deps.service.issueSystemMutationAuthority(ownerKeyOf(base), operation);
  }

  /** Request ids are scoped by the host to the caller: another principal can never replay someone else's batch. */
  private batchId(caller: PortCaller, base: BaseSnapshot, tool: string, requestId: string) {
    return hash(["base-port", base.meta.ownerInstanceId, tool, caller.key, requestId]);
  }
}

const ownerKeyOf = (base: BaseSnapshot) => ownerKeyOfOwner(base.meta.owner);
