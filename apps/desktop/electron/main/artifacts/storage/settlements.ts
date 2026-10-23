/**
 * [INPUT]: Exact turn/Chat incarnations, canonical persistence outcome and independent settlement acknowledgements.
 * [OUTPUT]: Durable turn settlement intents and replayable receipts; I/O retries reopen canonical bytes without repeating applied callbacks.
 * [POS]: Post-persistence recovery ledger; a crash cannot discard an unfinished business callback.
 */
import { z } from "zod";
import { join } from "node:path";
import { SerialQueue } from "../../persistence/serial-queue";
import { DurableJson } from "../../persistence/durable-json";
const receipt = z.object({ conversationId: z.string(), incarnationId: z.string(), requestId: z.string(), assistantMessageId: z.string(),
  planRequested: z.boolean(), terminal: z.enum(["done", "cancelled", "error"]), cleanup: z.enum(["pending", "failed", "complete"]),
  outcome: z.enum(["stored", "empty", "missing", "fatal"]).optional(), business: z.boolean(), artifact: z.boolean() }).strict();
const schema = z.object({ receipts: z.array(receipt) }).strict();
export type SettlementReceipt = z.infer<typeof receipt>;
export class TurnSettlementJournal {
  private readonly queue = new SerialQueue();
  private receipts: SettlementReceipt[] = [];
  constructor(private readonly root: string) {}
  initialize() { return this.update(); }
  pending() { return structuredClone(this.receipts.filter(row => !row.business || !row.artifact)); }
  private update(change?: (value: z.infer<typeof schema>) => void) {
    return this.queue.enqueue(async () => {
      // A failed durable write can have reached rename. Reopen canonical bytes before the next retry.
      const file = new DurableJson(join(this.root, "turn-settlements.json"), schema, () => ({ receipts: [] }));
      try {
        await file.initialize();
        if (change) await file.mutate(change);
        this.receipts = file.read(value => value.receipts);
      } finally { await file.closeAndFlush(); }
    });
  }
  prepare(input: SettlementReceipt) { return this.update(value => { const existing = value.receipts.find(row => row.requestId === input.requestId); if (!existing) value.receipts.push(input); else if (existing.conversationId !== input.conversationId || existing.incarnationId !== input.incarnationId || existing.assistantMessageId !== input.assistantMessageId) throw new Error("Turn settlement identity changed"); }); }
  patch(requestId: string, update: Partial<Pick<SettlementReceipt, "outcome" | "cleanup" | "business" | "artifact">>) { return this.update(value => { const row = value.receipts.find(row => row.requestId === requestId); if (row) Object.assign(row, update); const complete = value.receipts.filter(row => row.business && row.artifact); if (complete.length > 256) { const remove = new Set(complete.slice(0, complete.length - 256).map(row => row.requestId)); value.receipts = value.receipts.filter(row => !remove.has(row.requestId)); } }); }
  async close() { this.queue.close(); await this.queue.flush(); }
}
