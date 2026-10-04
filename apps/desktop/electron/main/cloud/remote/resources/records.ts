/**
 * [INPUT]: Verified account/device scope, published Base state, owner facts and the record package authority.
 * [OUTPUT]: recordResourcePort, bounded record reads/reports/results through encrypted resource commands.
 * [POS]: Owner-computer adapter; local-only, transferred, deleted and foreign-account Bases never leave the computer.
 */
import { createHash } from "node:crypto";
import { ownerKeyOf, type BaseOwner } from "@ai-chat/base-core/model/owner-key";
import { pluginRecordReadSchema, pluginRecordReportSchema, pluginRecordResultsSchema, pluginRecordPageSchema,
  RECORD_REPLY_MAX_BYTES, RECORD_REPLY_PAGE_BYTES, type PluginRecordPage } from "@ai-chat/cloud-protocol/resources/plugin-records";
import type { RecordTarget } from "@bottega/contracts/plugins/records/contract";
import type { BaseStore } from "../../../bases/base-store";
import type { RecordPluginService } from "../../../plugins/records/service";

export type RecordResourcePort = { execute(action: string, resourceId: string, input: unknown, userId: string): Promise<PluginRecordPage> };
export function recordResourcePort(ports: { bases: BaseStore; records(): RecordPluginService | null; environment: string;
  owns(owner: BaseOwner, userId: string): Promise<boolean>; current(userId: string): boolean }): RecordResourcePort {
  const assert = async (target: RecordTarget, userId: string) => {
    if (!ports.current(userId)) throw new Error("plugin-record-unavailable");
    const state = ports.bases.sync.read(target.base.ownerKey, target.base.ownerInstanceId), confirmed = state.confirmed;
    if (state.scope?.environment !== ports.environment || state.scope.userId !== userId || !confirmed || state.cloudState === "local-only" || state.promotionExport ||
      state.tombstones.includes("base") || state.tombstones.includes(`row:${target.rowId}`) || confirmed.meta.ownerInstanceId !== target.base.ownerInstanceId ||
      ownerKeyOf(confirmed.meta.owner) !== target.base.ownerKey || !confirmed.rows.some(row => row.id === target.rowId) || !await ports.owns(confirmed.meta.owner, userId))
      throw new Error("plugin-record-unavailable");
    if (!ports.current(userId)) throw new Error("plugin-record-unavailable");
  };
  return { execute: async (action, resourceId, raw, userId) => {
    const records = ports.records();
    if (!records) throw new Error("plugin-record-unavailable");
    const input = action === "plugin-record-results" ? pluginRecordResultsSchema.parse(raw)
      : action === "plugin-record-report" ? pluginRecordReportSchema.parse(raw) : pluginRecordReadSchema.parse(raw);
    if (resourceId !== ("call" in input ? input.target.pluginId : input.target.base.ownerInstanceId)) throw new Error("plugin-record-unavailable");
    await assert(input.target, userId);
    const value = "call" in input ? await records.call(input.target, input.call) : await records.results(input.target, input.read);
    await assert(input.target, userId);
    const bytes = Buffer.from(JSON.stringify(value)), digest = createHash("sha256").update(bytes).digest("hex"), offset = "offset" in input ? input.offset : 0;
    if (bytes.length > RECORD_REPLY_MAX_BYTES) throw new Error("plugin-record-budget");
    if (offset >= bytes.length || offset > 0 && (!("digest" in input) || input.digest !== digest) || "digest" in input && input.digest && input.digest !== digest)
      throw new Error("plugin-record-changed");
    return pluginRecordPageSchema.parse({ offset, digest, total: bytes.length, chunk: bytes.subarray(offset, offset + RECORD_REPLY_PAGE_BYTES).toString("base64"),
      done: offset + RECORD_REPLY_PAGE_BYTES >= bytes.length });
  } };
}
