/**
 * [INPUT]: Immutable XLSX bytes, exact Chat lifecycle, Base owner resolution and durable receipts.
 * [OUTPUT]: Worksheet inspection and idempotent, validated Base creation or merge.
 * [POS]: Main-only artifact import transaction; parsing precedes every Base mutation.
 */
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";

import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import type { ArtifactRef } from "../../../../shared/artifact-ipc";
import type { BasesService } from "../bases-service";
import { DurableJson } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";
import { inspectArtifactWorkbook, parseBaseXlsx } from "./base-xlsx";
const hash = (values: unknown[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
const schema = z.object({ receipts: z.array(z.object({ ownerKey: z.string(), baseId: z.string(), sha: z.string(), sheet: z.string(), done: z.boolean() })) });
export class ArtifactBaseImporter {
  private readonly queue = new SerialQueue();
  private readonly journal: DurableJson<z.infer<typeof schema>>;
  private readonly ready: Promise<void>;
  constructor(root: string, private readonly bases: BasesService) {
    this.journal = new DurableJson(join(root, "imports.json"), schema, () => ({ receipts: [] }));
    this.ready = this.journal.initialize().then(() => undefined);
  }
  private async target(ref: ArtifactRef) {
    const chat = await this.bases.ownerResolver.chat(ref.chatId);
    if (chat.incarnationId !== ref.incarnationId || chat.context.kind !== "ordinary") throw new Error("artifact-base-unavailable");
    const ownerKey = chat.projectId ? `project:${chat.projectId}` : `chat:${chat.id}`;
    const identity = await this.bases.ownerResolver.identityForOwnerKey(ownerKey);
    const current = identity.ownerInstanceId ? this.bases.store.get(ownerKey, identity.ownerInstanceId) : undefined;
    return { identity, current, ownerKey };
  }
  async inspect(ref: ArtifactRef, sha: string, data: Buffer) {
    await this.ready;
    const target = await this.target(ref);
    const sheets = await inspectArtifactWorkbook(data);
    const receipts = this.journal.snapshot().receipts;
    return { exists: Boolean(target.current), sheets: sheets.map(sheet => ({ ...sheet,
      imported: receipts.some(row => row.done && row.baseId === target.current?.meta.ownerInstanceId && row.sha === sha && row.sheet === sheet.name) })) };
  }
  async close() { this.queue.close(); await this.queue.flush(); await this.ready; await this.journal.closeAndFlush(); }
  import(ref: ArtifactRef, sha: string, data: Buffer, sheet: string, confirmed: boolean, assertCurrent: () => void) {
    return this.queue.enqueue(async () => {
      await this.ready;
      const inspection = await this.inspect(ref, sha, data);
      const chosen = inspection.sheets.find(value => value.name === sheet);
      if (!chosen) throw new Error("artifact-sheet-unavailable");
      if ((inspection.exists || !chosen.hasId) && !confirmed) throw new Error("artifact-import-confirmation-required");
      const target = await this.target(ref);
      let receipt = this.journal.snapshot().receipts.find(row => row.ownerKey === target.ownerKey && row.sha === sha && row.sheet === sheet &&
        (!target.current || row.baseId === target.current.meta.ownerInstanceId));
      if (receipt?.done && target.current) return { baseId: receipt.baseId };
      const identity = { ...target.identity, ownerInstanceId: target.identity.ownerInstanceId || receipt?.baseId || randomUUID() };
      if (!receipt) {
        receipt = { ownerKey: ownerKeyOf(identity.owner), baseId: identity.ownerInstanceId, sha, sheet, done: false };
        const pending = receipt;
        await this.journal.mutate(state => { state.receipts.push(pending); });
      }
      const parsed = await parseBaseXlsx(data, target.current ?? { meta: { columns: [] }, rows: [] }, {
        sheet, rowId: index => hash([identity.ownerInstanceId, sha, sheet, index]),
      });
      if (parsed.issues.length) throw new Error("artifact-invalid-workbook-cells");
      assertCurrent();
      const latest = await this.target(ref);
      if (latest.ownerKey !== target.ownerKey) throw new Error("artifact-base-changed");
      await this.bases.commitArtifactImport(identity, parsed, target.current?.meta.revision ?? null);
      await this.journal.mutate(state => { const found = state.receipts.find(row => row.baseId === identity.ownerInstanceId && row.sha === sha && row.sheet === sheet); if (found) found.done = true; });
      return { baseId: identity.ownerInstanceId };
    });
  }
}
