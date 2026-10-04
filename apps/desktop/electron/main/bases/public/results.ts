/**
 * [INPUT]: Depends on Node crypto/fs/path, zod, DurableJson and durable byte publication
 * [OUTPUT]: Provides RunResultStore: content-addressed immutable report bodies (`res_<sha256>`) and a bounded per-row result-slot index
 * [POS]: BAS-14's run product: a long report never enters a Base row; the row carries at most a 1 KiB summary and the slot keeps the logical reference, so a truncated summary can always be read back in full (B23, B24)
 */
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DurableJson, durableReplaceBytes } from "../../persistence/durable-json";

const SLOTS_PER_ROW = 64;
const slotSchema = z.object({ resultRef: z.string().regex(/^res_[a-f0-9]{64}$/), label: z.string().max(120), bytes: z.number().int().min(0),
  truncated: z.boolean(), summaryColumnId: z.string().max(128).nullable(), principal: z.string().max(512), createdAt: z.number().int().min(0) }).strict();
const indexSchema = z.object({ version: z.literal(1), rows: z.record(z.string(), z.array(slotSchema).max(SLOTS_PER_ROW)) }).strict();
export type ResultSlot = z.infer<typeof slotSchema>;

const rowKey = (ownerInstanceId: string, rowId: string) => `${ownerInstanceId}/${rowId}`;

export class RunResultStore {
  private readonly index: DurableJson<z.infer<typeof indexSchema>>;
  private readonly bodies: string;

  constructor(userData: string, private readonly now: () => number = Date.now) {
    const root = join(userData, "bases", "run-results");
    this.bodies = join(root, "bodies");
    this.index = new DurableJson(join(root, "index.json"), indexSchema, () => ({ version: 1 as const, rows: {} }));
  }

  async initialize() {
    await mkdir(this.bodies, { recursive: true, mode: 0o700 });
    return this.index.initialize();
  }

  /** The body is published before the slot, so a slot never points at a missing body. */
  async attach(input: { ownerInstanceId: string; rowId: string; report: string; label: string; truncated: boolean;
    summaryColumnId: string | null; principal: string }) {
    const bytes = Buffer.from(input.report, "utf8");
    const resultRef = `res_${createHash("sha256").update(bytes).digest("hex")}`;
    await durableReplaceBytes(join(this.bodies, resultRef), bytes);
    const slot: ResultSlot = { resultRef, label: input.label, bytes: bytes.length, truncated: input.truncated,
      summaryColumnId: input.summaryColumnId, principal: input.principal, createdAt: this.now() };
    await this.index.mutate(state => {
      const key = rowKey(input.ownerInstanceId, input.rowId);
      const slots = (state.rows[key] ?? []).filter(item => item.resultRef !== resultRef);
      /* Oldest reference first to go: the body file stays addressable to whoever still holds the ref. */
      state.rows[key] = [...slots, slot].slice(-SLOTS_PER_ROW);
    });
    return slot;
  }

  list(ownerInstanceId: string, rowId: string) {
    return structuredClone(this.index.snapshot().rows[rowKey(ownerInstanceId, rowId)] ?? []);
  }

  /** Only a reference listed under this Base instance is readable through it. */
  async read(ownerInstanceId: string, resultRef: string, offset: number, length: number) {
    const listed = Object.entries(this.index.snapshot().rows).some(([key, slots]) =>
      key.startsWith(`${ownerInstanceId}/`) && slots.some(slot => slot.resultRef === resultRef));
    if (!listed) throw Object.assign(new Error("result not found for this Base"), { status: 404, code: "result-not-found" });
    const bytes = await readFile(join(this.bodies, resultRef));
    return { total: bytes.length, offset, chunk: bytes.subarray(offset, offset + length).toString("base64"), done: offset + length >= bytes.length };
  }

  close() { return this.index.closeAndFlush(); }
}
