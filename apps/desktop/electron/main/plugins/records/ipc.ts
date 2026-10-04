/**
 * [INPUT]: Trusted renderer admission, record service and strict record contracts.
 * [OUTPUT]: Main-window-only record catalog, isolated leases, bound dispatch and result reads.
 * [POS]: Native authority boundary; window custody is derived from IPC, never supplied by the frame.
 */
import { z } from "zod";
import { RECORD_PLUGINS_CHANNEL as C } from "@bottega/contracts/plugins/records/native";
import { recordCallSchema, recordOpenSchema, recordTargetSchema } from "@bottega/contracts/plugins/records/contract";
import { rendererIpc } from "../../registration/ipc-registrar";
import type { RecordPluginService } from "./service";
const result = z.object({ resultRef: z.string().regex(/^res_[a-f0-9]{64}$/), offset: z.number().int().min(0).max(4 * 1024 * 1024) }).strict();
export function registerRecordPlugins(service: RecordPluginService, rendererUrl: string) {
  rendererIpc(rendererUrl, "Record plugins require the main window").roles("main")
    .handle(C.list, async () => { await service.refresh(); return service.list(); })
    .handleWithContext(C.open, (context, raw) => service.open(recordOpenSchema.parse(raw), context.webContentsId))
    .handleWithContext(C.call, (context, leaseId, raw) => service.callLease(z.string().uuid().parse(leaseId), context.webContentsId, recordCallSchema.parse(raw)))
    .handle(C.results, (target, read) => service.results(recordTargetSchema.parse(target), read === undefined ? undefined : result.parse(read)));
}
