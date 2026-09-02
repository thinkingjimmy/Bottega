/**
 * [INPUT]: Depends on DurableJson quarantine-safe initialization, shared AppGuiGenerationIntent schema, and immutable generation authority references
 * [OUTPUT]: Provides one-unfinished-per-App durable cutover intent with nullable first activation, frozen preference CAS, phase monotonicity, revision CAS, barrier deadline stamping, terminal pruning, recovery-time discard, and unfinished listing
 * [POS]: gui-cutover write-ahead intent and recovery ledger; the AppStore active CAS is the commit point, so this file records what is being attempted and never becomes a second active-generation authority
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  appGuiGenerationIntentSchema,
  type AppGuiGenerationAuthorityRef,
  type AppGuiGenerationIntent,
  type AppGuiPreferenceAdoptionSnapshot,
  type GuiCutoverParticipantEvidence,
  type GuiCutoverParticipantPlanEntry,
} from "../../../../shared/app-gui/cutover";
import {
  DurableJson,
  initializeDurableJsonOrQuarantine,
} from "../../persistence/durable-json";
import { participantPlanDigest, validateParticipantPlan } from "./participants";

/* 账本只装“未完成”：终态 intent 一律出账，文件大小因此收敛于并发 cutover 数
   （每 App 至多一条），而不是随每次编译单调增长。 */
const fileSchema = z.object({
  schemaVersion: z.literal(3),
  intents: z.array(appGuiGenerationIntentSchema).max(100),
}).strict();
type File = z.infer<typeof fileSchema>;

const phaseRank: Record<AppGuiGenerationIntent["phase"], number> = {
  prepared: 0,
  staging: 1,
  "cohort-frozen": 2,
  "participants-ready": 3,
  "admission-closing": 4,
  active: 5,
  draining: 6,
  retired: 7,
  aborted: 7,
};
const terminal = new Set<AppGuiGenerationIntent["phase"]>(["retired", "aborted"]);

export class AppGuiCutoverJournal {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "apps", "gui-cutovers.json"),
      fileSchema,
      () => ({ schemaVersion: 3, intents: [] })
    );
  }

  /* 无法信任的恢复账本按“不存在”处理：隔离留证、空态重建。让不可读的账本
     炸掉 initialize 只会把整个产品锁死在启动崩溃循环里，而账本本身不是提交
     真相——AppStore 的 active CAS 才是。 */
  initialize() {
    return initializeDurableJsonOrQuarantine(this.file);
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  begin(input: {
    appId: string;
    expectedActiveGenerationId: string | null;
    previous: AppGuiGenerationAuthorityRef | null;
    next: AppGuiGenerationAuthorityRef;
    participantPlan: readonly GuiCutoverParticipantPlanEntry[];
    preferenceAdoption?: AppGuiPreferenceAdoptionSnapshot | null;
    readyDeadlineAt: number;
    drainDeadlineAt: number;
  }) {
    return this.file.mutate((state) => {
      const unfinished = state.intents.find(
        (intent) => intent.appId === input.appId
      );
      if (unfinished) {
        if (
          unfinished.expectedActiveGenerationId === input.expectedActiveGenerationId &&
          unfinished.nextGenerationId === input.next.generationId
        ) return unfinished;
        throw new Error("GUI_CUTOVER_CONFLICT");
      }
      const intent = appGuiGenerationIntentSchema.parse({
        cutoverId: randomUUID(),
        appId: input.appId,
        expectedActiveGenerationId: input.expectedActiveGenerationId,
        nextGenerationId: input.next.generationId,
        previous: input.previous,
        next: input.next,
        participantPlan: validateParticipantPlan(input.participantPlan),
        participantPlanDigest: participantPlanDigest(input.participantPlan),
        appParticipantEvidence: [],
        preferenceAdoption: input.preferenceAdoption ?? null,
        phase: "prepared",
        revision: 0,
        readyDeadlineAt: input.readyDeadlineAt,
        drainDeadlineAt: input.drainDeadlineAt,
      });
      state.intents.push(intent);
      return intent;
    });
  }

  advance(
    cutoverId: string,
    expectedRevision: number,
    phase: AppGuiGenerationIntent["phase"]
  ) {
    return this.file.mutate((state) => {
      const { intent, index } = requireMutable(state, cutoverId, expectedRevision);
      if (phaseRank[phase] < phaseRank[intent.phase]) {
        throw new Error("GUI_CUTOVER_PHASE_REGRESSION");
      }
      if (phase === "aborted" && phaseRank[intent.phase] >= phaseRank.active) {
        throw new Error("GUI_CUTOVER_ACTIVE_CANNOT_ABORT");
      }
      const next = appGuiGenerationIntentSchema.parse({
        ...intent,
        phase,
        revision: intent.revision + 1,
      });
      /* 终态转移与出账是同一笔 durable mutate：掉电要么留下未完成态（recover()
         幂等重放），要么什么都不剩（终态本就无事可做），不存在“已终态但仍在账
         上”的中间态。 */
      if (terminal.has(phase)) state.intents.splice(index, 1);
      else state.intents[index] = next;
      return next;
    });
  }

  /* barrier 的 deadline 在这里盖章而不是 begin：staging 与 ready 已经花掉的
     时间不该记在 drain 头上。同一笔写既记录 admission 关闭意图，又固定这次
     drain 的绝对截止时刻。 */
  closeAdmission(
    cutoverId: string,
    expectedRevision: number,
    drainDeadlineAt: number
  ) {
    return this.file.mutate((state) => {
      const { intent, index } = requireMutable(state, cutoverId, expectedRevision);
      if (intent.phase !== "participants-ready") {
        throw new Error("GUI_CUTOVER_ADMISSION_CLOSE_PHASE_INVALID");
      }
      const next = appGuiGenerationIntentSchema.parse({
        ...intent,
        phase: "admission-closing",
        drainDeadlineAt,
        revision: intent.revision + 1,
      });
      state.intents[index] = next;
      return next;
    });
  }

  /* 恢复期垃圾清理：intent 指向的 App 已不存在，或它的状态无法用任何权威解释。
     这类 intent 没有收敛方向，留在账本里只会让每一轮恢复重复失败。 */
  discard(cutoverId: string) {
    return this.file.mutate((state) => {
      const index = state.intents.findIndex((item) => item.cutoverId === cutoverId);
      if (index >= 0) state.intents.splice(index, 1);
      return index >= 0;
    });
  }

  participantsReady(
    cutoverId: string,
    expectedRevision: number,
    evidence: readonly GuiCutoverParticipantEvidence[]
  ) {
    return this.file.mutate((state) => {
      const { intent, index } = requireMutable(state, cutoverId, expectedRevision);
      if (intent.phase !== "cohort-frozen") {
        throw new Error("GUI_CUTOVER_PARTICIPANTS_READY_PHASE_INVALID");
      }
      const expectedIds = intent.participantPlan
        .filter((entry) => entry.scope !== "surface")
        .map((entry) => entry.participantId);
      if (
        evidence.length !== expectedIds.length ||
        evidence.some((item, evidenceIndex) => item.participantId !== expectedIds[evidenceIndex])
      ) throw new Error("GUI_CUTOVER_APP_PARTICIPANT_EVIDENCE_INVALID");
      const next = appGuiGenerationIntentSchema.parse({
        ...intent,
        phase: "participants-ready",
        appParticipantEvidence: evidence,
        revision: intent.revision + 1,
      });
      state.intents[index] = next;
      return next;
    });
  }

  freezeCohort(
    cutoverId: string,
    expectedRevision: number,
    readyDeadlineAt: number
  ) {
    return this.file.mutate((state) => {
      const { intent, index } = requireMutable(state, cutoverId, expectedRevision);
      if (intent.phase !== "staging") throw new Error("GUI_CUTOVER_FREEZE_PHASE_INVALID");
      const next = appGuiGenerationIntentSchema.parse({
        ...intent,
        phase: "cohort-frozen",
        readyDeadlineAt,
        revision: intent.revision + 1,
      });
      state.intents[index] = next;
      return next;
    });
  }

  get(cutoverId: string) {
    return this.file.snapshot().intents.find((intent) => intent.cutoverId === cutoverId);
  }

  /** 账本里只剩未完成的 intent，所以列举未完成 = 列举全部。 */
  unfinished(appId?: string) {
    return this.file.snapshot().intents.filter(
      (intent) => !appId || intent.appId === appId
    );
  }
}

function requireMutable(state: File, cutoverId: string, expectedRevision: number) {
  const index = state.intents.findIndex((item) => item.cutoverId === cutoverId);
  const intent = state.intents[index];
  if (!intent) throw new Error("GUI_CUTOVER_NOT_FOUND");
  if (intent.revision !== expectedRevision) throw new Error("GUI_CUTOVER_REVISION_MISMATCH");
  return { intent, index };
}
