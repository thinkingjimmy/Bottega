/**
 * [INPUT]: Depends on DurableJson and exact Host-resolved destination/partial paths
 * [OUTPUT]: Provides durable open export intents, a typed busy rejection, terminal removal, and exact-path crash recovery enumeration
 * [POS]: file-export crash custody ledger; it never performs directory scans or wildcard cleanup
 */

import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";

const intentSchema = z.object({
  exportId: z.string().uuid(),
  appId: z.string().min(1),
  generationId: z.string().min(1),
  surfaceId: z.string().min(1),
  destinationPath: z.string().min(1),
  partialPath: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
}).strict();
const fileSchema = z.object({ schemaVersion: z.literal(1), intents: z.array(intentSchema).max(4) }).strict();
type File = z.infer<typeof fileSchema>;
type FileExportIntent = z.infer<typeof intentSchema>;

export class FileExportIntentStore {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "apps", "file-export-intents.json"),
      fileSchema,
      () => ({ schemaVersion: 1, intents: [] })
    );
  }

  initialize() {
    return this.file.initialize();
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  list() {
    return this.file.snapshot().intents;
  }

  add(intent: FileExportIntent) {
    return this.file.mutate((state) => {
      if (state.intents.some((item) => item.exportId === intent.exportId)) return intent;
      /* 账本满是「现在没有空位」，不是「主进程坏了」：抛带 code 的忙错误，
         由 manager 翻译成 declined/busy，绝不能以裸 Error 落成 500。 */
      if (state.intents.length >= 4) throw fileExportBusy();
      state.intents.push(intentSchema.parse(intent));
      return intent;
    });
  }

  remove(exportId: string) {
    return this.file.mutate((state) => {
      state.intents = state.intents.filter((item) => item.exportId !== exportId);
    });
  }
}

const FILE_EXPORT_BUSY = "FILE_EXPORT_BUSY";

function fileExportBusy() {
  return Object.assign(new Error(FILE_EXPORT_BUSY), { code: FILE_EXPORT_BUSY, status: 429 });
}

export function isFileExportBusy(cause: unknown) {
  return (cause as { code?: unknown } | null)?.code === FILE_EXPORT_BUSY;
}
