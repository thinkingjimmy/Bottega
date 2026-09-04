/**
 * [INPUT]: Depends on DurableJson, crypto and shared AppDataEpochOwnership/AppDataCutoverRecord/AppDataCutoverSource
 * [OUTPUT]: Provides AppDataCutoverLedger: an unreadable file is quarantined and rebuilt empty, epoch ownership is monotonic, the source/target union is closed, abort/release write generationBuildId-level tombstones, and non-terminal cutovers are listed for restart reconcile
 * [POS]: The sole author of the apps server mutable-data record (§3.4); a code generation never names a physical root itself, and app-server-cutover drives the switch order
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type {
  AppDataCutoverRecord,
  AppDataCutoverSource,
  AppDataEpochOwnership,
} from "../../../../shared/app-lifecycle";
import {
  DurableJson,
} from "../../persistence/durable-json";

const epochSchema = z.object({
  dataEpochId: z.string().uuid(),
  appId: z.string().regex(/^[a-z0-9]{10}$/),
  state: z.enum(["staged", "active", "retained", "archive-pending", "archived", "discard-pending", "discarded"]),
  archiveId: z.string().uuid().optional(),
}).strict();
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("existing"), generationId: z.string().min(1), dataEpochId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("legacy-import"), snapshotId: z.string().uuid() }).strict(),
]);
const cutoverSchema = z.object({
  cutoverId: z.string().uuid(),
  generationBuildId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  disposition: z.enum(["open", "prepared", "committed", "abort-pending", "aborted", "released"]),
  appId: z.string().regex(/^[a-z0-9]{10}$/),
  source: sourceSchema,
  target: z.object({ generationId: z.string().min(1), dataEpochId: z.string().uuid() }).strict(),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(2),
  epochs: z.array(epochSchema),
  cutovers: z.array(cutoverSchema),
  /** append-only：已终结的 build id 永远拒绝迟到的 prepare/finalize */
  retiredBuildIds: z.array(z.string().min(1)),
}).strict();
type File = z.infer<typeof fileSchema>;
type Disposition = File["cutovers"][number]["disposition"];
type EpochState = File["epochs"][number]["state"];

/* disposition 是单调决定轴：`open` 期间还能回头，`prepared` 之后只剩「完成」
   或「按 abort 收口」，`aborted|released` 不可逆并当场写 build 级 tombstone。 */
const dispositionRank: Record<Disposition, number> = {
  open: 0,
  prepared: 1,
  "abort-pending": 2,
  committed: 2,
  aborted: 3,
  released: 3,
};
const TERMINAL_DISPOSITIONS: readonly Disposition[] = ["aborted", "released"];

const epochRank: Record<EpochState, number> = {
  staged: 0,
  active: 1,
  retained: 2,
  "archive-pending": 3,
  "discard-pending": 3,
  archived: 4,
  discarded: 4,
};
/** delete 只有走到这两格才算数据面清干净。 */
const EPOCH_SETTLED: readonly EpochState[] = ["archived", "discarded"];

export class AppDataCutoverLedger {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "apps", "data-cutovers.json"),
      fileSchema,
      () => ({ schemaVersion: 2, epochs: [], cutovers: [], retiredBuildIds: [] })
    );
  }

  /* 读不动的账本按「不存在」处理：隔离留证、空态重建。让它炸掉 initialize
     只会把产品锁死在启动崩溃循环里，而这本账不是提交真相——AppStore 的
     active binding 才是；重建后启动对账照样能判出每条 epoch 的归属。 */
  initialize() {
    return this.file.initialize();
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  /**
   * 切换的第一笔 durable 事实：闭合 source 联合与 target epoch 同时落账，
   * 之后所有物理动作都能凭它判断「该继续还是该回到 source」。
   * 同一 generationBuildId 幂等——崩溃重放不会造出第二个 target epoch。
   */
  open(input: {
    appId: string;
    generationBuildId: string;
    source: AppDataCutoverSource;
    targetGenerationId: string;
  }) {
    return this.file.mutate((state) => {
      this.assertLive(state, input.generationBuildId);
      const existing = state.cutovers.find(
        (item) => item.generationBuildId === input.generationBuildId
      );
      if (existing) return existing as AppDataCutoverRecord;
      const dataEpochId = randomUUID();
      state.epochs.push(
        epochSchema.parse({
          dataEpochId,
          appId: input.appId,
          state: "staged",
        })
      );
      const cutover = cutoverSchema.parse({
        cutoverId: randomUUID(),
        generationBuildId: input.generationBuildId,
        revision: 0,
        disposition: "open",
        appId: input.appId,
        source: input.source,
        target: { generationId: input.targetGenerationId, dataEpochId },
      });
      state.cutovers.push(cutover);
      return cutover as AppDataCutoverRecord;
    });
  }

  /** target epoch 已构造并校验；此后只剩 CAS 这个短临界区。 */
  prepare(generationBuildId: string, expectedRevision: number) {
    return this.mutateCutover(generationBuildId, expectedRevision, (cutover) => {
      this.assertDisposition(cutover, "prepared");
      cutover.disposition = "prepared";
    });
  }

  /** CAS 成功后的同一笔 decision：target 转 active，source 转 retained。 */
  commit(generationBuildId: string, expectedRevision: number) {
    return this.mutateCutover(
      generationBuildId,
      expectedRevision,
      (cutover, state) => {
        this.assertDisposition(cutover, "committed");
        cutover.disposition = "committed";
        setEpoch(state, cutover.target.dataEpochId, "active");
        if (cutover.source.kind === "existing") {
          setEpoch(state, cutover.source.dataEpochId, "retained");
        }
      }
    );
  }

  beginAbort(generationBuildId: string, expectedRevision: number) {
    return this.mutateCutover(generationBuildId, expectedRevision, (cutover) => {
      this.assertDisposition(cutover, "abort-pending");
      cutover.disposition = "abort-pending";
    });
  }

  /** target epoch 从未 active，物理目录已清；source 原封不动地留在原处。 */
  abort(generationBuildId: string, expectedRevision: number) {
    return this.mutateCutover(
      generationBuildId,
      expectedRevision,
      (cutover, state) => {
        this.assertDisposition(cutover, "aborted");
        cutover.disposition = "aborted";
        setEpoch(state, cutover.target.dataEpochId, "discarded");
        state.retiredBuildIds.push(cutover.generationBuildId);
      }
    );
  }

  /** 成功 cutover 的收尾：target 已被下一代替换或 App 已删，fence 才可退役。 */
  release(generationBuildId: string, expectedRevision: number) {
    return this.mutateCutover(
      generationBuildId,
      expectedRevision,
      (cutover, state) => {
        this.assertDisposition(cutover, "released");
        cutover.disposition = "released";
        state.retiredBuildIds.push(cutover.generationBuildId);
      }
    );
  }

  isRetiredBuild(generationBuildId: string) {
    return this.file.snapshot().retiredBuildIds.includes(generationBuildId);
  }

  get(generationBuildId: string) {
    return this.file
      .snapshot()
      .cutovers.find((item) => item.generationBuildId === generationBuildId) as
      | AppDataCutoverRecord
      | undefined;
  }

  /** 启动对账入口：这些 cutover 还没给出最终决定，必须逐条判继续或回退。 */
  listUnsettled(appId?: string) {
    return this.file
      .snapshot()
      .cutovers.filter(
        (item) =>
          !TERMINAL_DISPOSITIONS.includes(item.disposition) &&
          (!appId || item.appId === appId)
      ) as AppDataCutoverRecord[];
  }

  epoch(dataEpochId: string) {
    return this.file
      .snapshot()
      .epochs.find((item) => item.dataEpochId === dataEpochId) as
      | AppDataEpochOwnership
      | undefined;
  }

  epochs(appId: string) {
    return this.file
      .snapshot()
      .epochs.filter((item) => item.appId === appId) as AppDataEpochOwnership[];
  }

  advanceEpoch(
    dataEpochId: string,
    state: EpochState,
    archiveId?: string
  ) {
    return this.file.mutate((file) => {
      return setEpoch(file, dataEpochId, state, archiveId) as AppDataEpochOwnership;
    });
  }

  /** delete 的数据面阻塞项：尚未 archived/discarded 的 epoch 全部算数。 */
  blockers(appId: string) {
    return this.epochs(appId).filter(
      (epoch) => !EPOCH_SETTLED.includes(epoch.state)
    );
  }

  private mutateCutover(
    generationBuildId: string,
    expectedRevision: number,
    apply: (cutover: File["cutovers"][number], state: File) => void
  ) {
    return this.file.mutate((state) => {
      this.assertLive(state, generationBuildId);
      const cutover = state.cutovers.find(
        (item) => item.generationBuildId === generationBuildId
      );
      if (!cutover) throw new Error("server data cutover 不存在");
      if (cutover.revision !== expectedRevision) {
        throw new Error("DATA_CUTOVER_REVISION_MISMATCH");
      }
      apply(cutover, state);
      cutover.revision += 1;
      return cutover as AppDataCutoverRecord;
    });
  }

  private assertLive(state: File, generationBuildId: string) {
    if (state.retiredBuildIds.includes(generationBuildId)) {
      throw new Error("server data build 已永久退役");
    }
  }

  private assertDisposition(
    cutover: File["cutovers"][number],
    next: Disposition
  ) {
    if (dispositionRank[next] < dispositionRank[cutover.disposition]) {
      throw new Error("server data cutover disposition 不可回退");
    }
    /* committed 与 abort-pending 同名次却互斥：一条 cutover 不能既已切换又在收口。 */
    if (
      dispositionRank[next] === dispositionRank[cutover.disposition] &&
      next !== cutover.disposition
    ) {
      throw new Error("server data cutover 已给出相反决定");
    }
    if (next === "released" && cutover.disposition !== "committed") {
      throw new Error("released 只能来自 committed");
    }
    if (next === "aborted" && cutover.disposition !== "abort-pending") {
      throw new Error("aborted 只能来自 abort-pending");
    }
    if (next === "committed" && cutover.disposition !== "prepared") {
      throw new Error("committed 只能来自 prepared");
    }
  }
}

function setEpoch(
  file: File,
  dataEpochId: string,
  next: EpochState,
  archiveId?: string
) {
  const epoch = file.epochs.find((item) => item.dataEpochId === dataEpochId);
  if (!epoch) throw new Error("server data epoch 不存在");
  if (epochRank[next] < epochRank[epoch.state]) {
    throw new Error("server data epoch 所有权不可回退");
  }
  if (next === "archived" && epoch.state !== "archive-pending") {
    throw new Error("archived 只能来自 archive-pending");
  }
  epoch.state = next;
  if (archiveId) epoch.archiveId = archiveId;
  if (
    (next === "archive-pending" || next === "archived") &&
    !epoch.archiveId
  ) {
    throw new Error("archive 状态必须引用已 fsync 的 archive aggregate");
  }
  return epoch;
}
