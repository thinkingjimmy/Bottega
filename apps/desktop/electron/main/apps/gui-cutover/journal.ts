/**
 * [INPUT]: Depends on DurableJson quarantine-safe initialization, the shared AppGuiGenerationIntent schema, and immutable generation authority references
 * [OUTPUT]: Provides one-unfinished-per-App durable cutover intent with nullable first activation, frozen preference CAS, a single pre-active → active write, and terminal discard
 * [POS]: gui-cutover write-ahead intent and recovery ledger; the AppStore active CAS is the commit point, so this file records only which side of that commit an interrupted cutover fell on
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  appGuiGenerationIntentSchema,
  type AppGuiGenerationAuthorityRef,
  type AppGuiPreferenceAdoptionSnapshot,
  type GuiCutoverParticipantIdV1,
} from "../../../../shared/app-gui/cutover";
import {
  DurableJson,
} from "../../persistence/durable-json";
import { validateParticipantPlan } from "./participants";

/* 账本只装“未完成”：终态 intent 一律出账，文件大小因此收敛于并发 cutover 数
   （每 App 至多一条），而不是随每次编译单调增长。 */
const fileSchema = z.object({
  schemaVersion: z.literal(4),
  intents: z.array(appGuiGenerationIntentSchema).max(100),
}).strict();
type File = z.infer<typeof fileSchema>;

export class AppGuiCutoverJournal {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "apps", "gui-cutovers.json"),
      fileSchema,
      () => ({ schemaVersion: 4, intents: [] })
    );
  }

  /* 无法信任的恢复账本按“不存在”处理：隔离留证、空态重建。让不可读的账本
     炸掉 initialize 只会把整个产品锁死在启动崩溃循环里，而账本本身不是提交
     真相——AppStore 的 active CAS 才是。 */
  initialize() {
    return this.file.initialize();
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  begin(input: {
    appId: string;
    expectedActiveGenerationId: string | null;
    previous: AppGuiGenerationAuthorityRef | null;
    next: AppGuiGenerationAuthorityRef;
    participantPlan: readonly GuiCutoverParticipantIdV1[];
    preferenceAdoption?: AppGuiPreferenceAdoptionSnapshot | null;
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
        preferenceAdoption: input.preferenceAdoption ?? null,
        phase: "pending",
      });
      state.intents.push(intent);
      return intent;
    });
  }

  /* 唯一的相变写，且幂等：AppStore CAS 已提交的事实一旦落盘，恢复就只剩
     前滚一条路。重复调用不是错误——崩溃重放本就该撞上它。 */
  markActive(cutoverId: string) {
    return this.file.mutate((state) => {
      const index = state.intents.findIndex((item) => item.cutoverId === cutoverId);
      const intent = state.intents[index];
      if (!intent) throw new Error("GUI_CUTOVER_NOT_FOUND");
      const next = appGuiGenerationIntentSchema.parse({ ...intent, phase: "active" });
      state.intents[index] = next;
      return next;
    });
  }

  /** 终态即出账：中止、前滚完成、以及恢复无法解释的 intent 共用这一笔写。 */
  discard(cutoverId: string) {
    return this.file.mutate((state) => {
      const index = state.intents.findIndex((item) => item.cutoverId === cutoverId);
      if (index >= 0) state.intents.splice(index, 1);
      return index >= 0;
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
