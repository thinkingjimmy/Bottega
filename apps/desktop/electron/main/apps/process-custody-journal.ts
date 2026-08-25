/**
 * [INPUT]: Depends on DurableJson, Crypto and shared AppProcessCustodyEntry/ProcessIdentity/Sha256Digest
 * [OUTPUT]: Provides AppProcessCustodyJournal; Not v2 file fail closed ((not moved) ✓ server guardian intent→owned→activation-authorized→activated→released ✓ single-mode CAS, pre-owned abort tombstone, quarantine and generation drain counts
 * [POS]: The server process custody of apps is durable; The truth is, the process is one thing, and the Gateway is only consuming activated identity
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type {
  AppProcessCustodyEntry,
  ProcessCustodyAbortReason,
  ProcessCustodyQuarantineReason,
  ProcessIdentity,
} from "../../../shared/app-lifecycle";
import type { Sha256Digest } from "../../../shared/extensions-ipc";
import { DurableJson } from "../persistence/durable-json";

const processSchema = z.object({
  pid: z.number().int().positive(),
  processGroupId: z.number().int().positive(),
  birthIdentity: z.string().min(1),
  executableIdentity: z.string().min(1),
}).strict();
const entrySchema = z.object({
  custodyId: z.string().uuid(),
  appId: z.string().regex(/^[a-z0-9]{10}$/),
  activationId: z.string().uuid(),
  generationId: z.string().min(1),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  lifecycleRevision: z.number().int().nonnegative(),
  dataEpochId: z.string().min(1),
  controlNonce: z.string().uuid(),
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

export class AppProcessCustodyJournal {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "apps", "process-custody.json"),
      fileSchema,
      () => ({ schemaVersion: 2, entries: [], retiredCustodyIds: [] })
    );
  }

  /** 断代升级：v1 档不迁移，strict schema 直接 fail closed 且原文件不动。 */
  initialize() {
    return this.file.initialize();
  }

  /** 关停时把在飞写入排空；账本落后于进程状态就是下次启动的假证据。 */
  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  /** intent 必须先于任何 spawn 落盘，且已绑定这一代的 code digest 与 data epoch。 */
  createIntent(input: {
    appId: string;
    generationId: string;
    contentDigest: Sha256Digest;
    lifecycleRevision: number;
    dataEpochId: string;
  }) {
    return this.file.mutate((state) => {
      const entry = entrySchema.parse({
        ...input,
        custodyId: randomUUID(),
        activationId: randomUUID(),
        controlNonce: randomUUID(),
        phase: "intent",
        revision: 0,
      });
      state.entries.push(entry);
      return entry as AppProcessCustodyEntry;
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
      | AppProcessCustodyEntry
      | undefined;
  }

  /** Gateway route publish 的唯一可读集合：只有 activated 才谈得上发布。 */
  isActivated(custodyId: string) {
    return this.get(custodyId)?.phase === "activated";
  }

  listRecoverable() {
    return this.file
      .snapshot()
      .entries.filter((entry) => !TERMINAL.includes(entry.phase)) as
      AppProcessCustodyEntry[];
  }

  listQuarantined() {
    return this.file
      .snapshot()
      .entries.filter((entry) => entry.phase === "quarantined") as
      AppProcessCustodyEntry[];
  }

  /** 该 App 是否仍有未收敛的进程托管；cutover 要等它归零才敢造新代 binary。 */
  listUnsettled(appId: string) {
    return this.listRecoverable().filter((entry) => entry.appId === appId);
  }

  count(appId: string, generationId: string) {
    const entries = this.listRecoverable().filter(
      (entry) => entry.appId === appId && entry.generationId === generationId
    );
    return {
      providerId: "process-custody",
      count: entries.length,
      evidenceIds: entries.map((entry) => entry.custodyId),
    };
  }

  private advance(
    custodyId: string,
    expectedRevision: number,
    phase: Phase,
    patch: Partial<File["entries"][number]> = {}
  ) {
    return this.file.mutate((state) => {
      const entry = state.entries.find((item) => item.custodyId === custodyId);
      if (!entry) throw new Error("process custody 不存在");
      if (entry.revision !== expectedRevision) {
        throw new Error("PROCESS_CUSTODY_REVISION_MISMATCH");
      }
      if (state.retiredCustodyIds.includes(custodyId)) {
        throw new Error("process custody 已退役");
      }
      if (phase === "aborted" && entry.phase !== "intent") {
        throw new Error("只有 pre-owned process custody 可 abort");
      }
      /* quarantine 是「说不清这个进程死没死」，前提是先有过身份。
         intent 没有 identity，它的唯一收口是 aborted——不许伪造 PID。 */
      if (phase === "quarantined" && !entry.processIdentity) {
        throw new Error("无 process identity 的 custody 只能 abort");
      }
      if (phase === "released" && entry.phase !== "release-pending") {
        throw new Error("released 只能来自 release-pending");
      }
      if (rank[phase] < rank[entry.phase]) {
        throw new Error("process custody phase 不可回退");
      }
      Object.assign(entry, patch, { phase, revision: entry.revision + 1 });
      if (TERMINAL.includes(phase)) state.retiredCustodyIds.push(custodyId);
      return entry as AppProcessCustodyEntry;
    });
  }
}
