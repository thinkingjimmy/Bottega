/**
 * [INPUT]: Depends on DurableJson, crypto and shared AgentTurnCustodyEntry/owner/dependency(App reference/Extension plan) /process identity and abort/quarantine reasons for sharing the two accounts
 * [OUTPUT]: Provides AgentTurnCustodyJournal; intent-before-spawn, owned→activation-authorized→activated→release-pending→released
 * [POS]: The truth source of the backends is the neutral turn process custody; App/Extension contributes only dependency, not ownership of processes
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type {
  ProcessCustodyAbortReason,
  AgentTurnCustodyDependency,
  AgentTurnCustodyEntry,
  AgentTurnCustodyOwner,
  ProcessCustodyQuarantineReason,
  ProcessIdentity,
} from "../../../shared/app-lifecycle";
import { DurableJson } from "../persistence/durable-json";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ownerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["chat-turn", "relay-attempt"]), ownerId: z.string().min(1), ownerRevision: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("app-internal-turn"), ownerId: z.string().min(1), ownerRevision: z.number().int().nonnegative(), activationId: z.string().min(1) }).strict(),
]);
const dependencySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app-reference"), journalEntryId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("extension-plan"), planInstanceId: z.string().min(1), planDigest: digest, componentPlanLeaseIds: z.array(z.string().min(1)) }).strict(),
]);
const processSchema = z.object({
  pid: z.number().int().positive(),
  processGroupId: z.number().int().positive(),
  birthIdentity: z.string().min(1),
  executableIdentity: z.string().min(1),
}).strict();
const entrySchema = z.object({
  custodyId: z.string().uuid(),
  turnRequestId: z.string().min(1),
  owner: ownerSchema,
  backendRuntimeIdentity: z.string().min(1),
  controlNonce: z.string().uuid(),
  dependencies: z.array(dependencySchema),
  phase: z.enum(["intent", "aborted", "owned", "activation-authorized", "activated", "release-pending", "released", "quarantined"]),
  revision: z.number().int().nonnegative(),
  processIdentity: processSchema.optional(),
  abortReason: z.enum(["cancelled-before-owned", "guardian-spawn-failed", "owner-no-longer-live"]).optional(),
  quarantineReason: z.enum(["process-identity-unconfirmed", "process-survived-kill"]).optional(),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(2),
  entries: z.array(entrySchema),
  retiredCustodyIds: z.array(z.string().uuid()),
}).strict();
type File = z.infer<typeof fileSchema>;
type Phase = File["entries"][number]["phase"];

/* 单调序：排名只回答「能不能往前走」。`quarantined` 与 `release-pending` 同名次，
   因为它不是终态而是**未收敛**——下次启动 PID 彻底消失时，同一条 entry 仍要能
   走到 released。真正不可逆的只有 `released` 与 pre-owned 的 `aborted`。 */
const rank: Record<Phase, number> = {
  intent: 0,
  owned: 1,
  "activation-authorized": 2,
  activated: 3,
  "release-pending": 4,
  quarantined: 4,
  released: 5,
  aborted: 5,
};

const TERMINAL: readonly Phase[] = ["released", "aborted"];

export class AgentTurnCustodyJournal {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "agent-custody", "turns.json"),
      fileSchema,
      () => ({ schemaVersion: 2, entries: [], retiredCustodyIds: [] })
    );
  }

  initialize() {
    return this.file.initialize();
  }

  /** 关停时把在飞写入排空；账本落后于进程状态就是下次启动的假证据。 */
  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  /**
   * intent 必须先于任何 spawn 落盘。同一 turnRequestId 只复用**非终态** entry：
   * 崩溃重放需要幂等，而 resume-failed 重试是同一 requestId 的新进程，
   * 复用已 released 的 entry 会让第二条命的死亡证据盖在第一条上。
   */
  createIntent(input: {
    turnRequestId: string;
    owner: AgentTurnCustodyOwner;
    backendRuntimeIdentity: string;
    dependencies: readonly AgentTurnCustodyDependency[];
  }) {
    return this.file.mutate((state) => {
      const existing = state.entries.find(
        (entry) =>
          entry.turnRequestId === input.turnRequestId &&
          !TERMINAL.includes(entry.phase)
      );
      if (existing) return existing as AgentTurnCustodyEntry;
      const entry = entrySchema.parse({
        ...input,
        custodyId: randomUUID(),
        controlNonce: randomUUID(),
        phase: "intent",
        revision: 0,
      });
      state.entries.push(entry);
      return entry as AgentTurnCustodyEntry;
    });
  }

  markOwned(custodyId: string, revision: number, identity: ProcessIdentity) {
    return this.advance(custodyId, revision, "owned", {
      processIdentity: identity,
    });
  }

  authorizeActivation(custodyId: string, revision: number) {
    return this.advance(custodyId, revision, "activation-authorized");
  }

  markActivated(custodyId: string, revision: number) {
    return this.advance(custodyId, revision, "activated");
  }

  /** 「打算释放」先于任何信号落盘；否则 kill 途中崩溃就分不清是否已发信号。 */
  beginRelease(custodyId: string, revision: number) {
    return this.advance(custodyId, revision, "release-pending");
  }

  /** 只有观察到精确进程组退出才允许调用——「发过 kill」不等于已释放。 */
  release(custodyId: string, revision: number) {
    return this.advance(custodyId, revision, "released");
  }

  abortBeforeOwned(
    custodyId: string,
    revision: number,
    reason: ProcessCustodyAbortReason
  ) {
    return this.advance(custodyId, revision, "aborted", { abortReason: reason });
  }

  quarantine(
    custodyId: string,
    revision: number,
    reason: ProcessCustodyQuarantineReason
  ) {
    return this.advance(custodyId, revision, "quarantined", {
      quarantineReason: reason,
    });
  }

  get(custodyId: string) {
    return this.file
      .snapshot()
      .entries.find((entry) => entry.custodyId === custodyId) as
      | AgentTurnCustodyEntry
      | undefined;
  }

  listRecoverable() {
    return this.file
      .snapshot()
      .entries.filter(
        (entry) => !TERMINAL.includes(entry.phase)
      ) as AgentTurnCustodyEntry[];
  }

  /** 仍可能持有能力的 custody 计数；内存 registry 为空不构成 release 证据。 */
  listQuarantined() {
    return this.file
      .snapshot()
      .entries.filter(
        (entry) => entry.phase === "quarantined"
      ) as AgentTurnCustodyEntry[];
  }

  private advance(
    custodyId: string,
    expectedRevision: number,
    phase: Phase,
    patch: Partial<File["entries"][number]> = {}
  ) {
    return this.file.mutate((state) => {
      const entry = state.entries.find((item) => item.custodyId === custodyId);
      if (!entry) throw new Error("turn custody 不存在");
      if (entry.revision !== expectedRevision) {
        throw new Error("CUSTODY_REVISION_MISMATCH");
      }
      if (state.retiredCustodyIds.includes(custodyId)) {
        throw new Error("turn custody 已退役");
      }
      if (phase === "aborted" && entry.phase !== "intent") {
        throw new Error("只有 pre-owned custody 可 abort");
      }
      /* quarantine 是「说不清这个进程死没死」，前提是先有过身份。
         intent 没有 identity，它的唯一收口是 aborted——不许伪造 PID。 */
      if (phase === "quarantined" && !entry.processIdentity) {
        throw new Error("无 process identity 的 custody 只能 abort");
      }
      /* released 要求先经过 release-pending，别让「杀完没确认」直接收口。 */
      if (phase === "released" && entry.phase !== "release-pending") {
        throw new Error("released 只能来自 release-pending");
      }
      if (rank[phase] < rank[entry.phase]) {
        throw new Error("custody phase 不可回退");
      }
      Object.assign(entry, patch, { phase, revision: entry.revision + 1 });
      if (TERMINAL.includes(phase)) state.retiredCustodyIds.push(custodyId);
      return entry as AgentTurnCustodyEntry;
    });
  }
}
