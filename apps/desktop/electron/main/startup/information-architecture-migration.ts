/**
 * [INPUT]: Depends on Node filesystem, durable JSON replacement, and injectable directory/IO/crash-cutpoint ports
 * [OUTPUT]: Provides the replayable four-ledger information-architecture migration journal with monotonic stages and corruption quarantine
 * [POS]: Startup publication gate between legacy-compatible Store readers and renderer-visible navigation
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { durableReplaceFile } from "../persistence/durable-json";

export const INFORMATION_ARCHITECTURE_MIGRATION_STAGES = [
  "prepared",
  "app-facts-written",
  "project-classified",
  "bases-classified",
  "chats-migrated",
  "refs-reconciled",
  "completed",
] as const;

export type InformationArchitectureMigrationStage =
  (typeof INFORMATION_ARCHITECTURE_MIGRATION_STAGES)[number];

type Journal = Readonly<{
  schemaVersion: 1;
  migrationId: string;
  stage: InformationArchitectureMigrationStage;
  edges: typeof INFORMATION_ARCHITECTURE_MIGRATION_EDGES;
  receipts: Partial<
    Record<
      Exclude<InformationArchitectureMigrationStage, "prepared">,
      InformationArchitectureMigrationReceipt
    >
  >;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  recoveredFromCorruption: boolean;
}>;

export const INFORMATION_ARCHITECTURE_MIGRATION_EDGES = {
  apps: "v14->v15",
  projects: "v5->v6",
  bases: "legacy->navigation-v1",
  chats: "v11->v12",
} as const;

export type InformationArchitectureMigrationLedger =
  | keyof typeof INFORMATION_ARCHITECTURE_MIGRATION_EDGES
  | "references"
  | "migration";

export type InformationArchitectureMigrationEvidence = Readonly<{
  ledger: InformationArchitectureMigrationLedger;
  expectedRevision: string;
  checksum: string;
  records: ReadonlyArray<
    Readonly<{ id: string; expectedRevision: string; checksum: string }>
  >;
}>;

export type InformationArchitectureMigrationReceipt =
  InformationArchitectureMigrationEvidence & Readonly<{ committedAt: number }>;

const LEDGER_BY_STAGE = {
  "app-facts-written": "apps",
  "project-classified": "projects",
  "bases-classified": "bases",
  "chats-migrated": "chats",
  "refs-reconciled": "references",
  completed: "migration",
} as const satisfies Record<
  Exclude<InformationArchitectureMigrationStage, "prepared">,
  InformationArchitectureMigrationLedger
>;

type Dependencies = Readonly<{
  ensureDirectory?: (path: string) => Promise<void>;
  readText?: (path: string) => Promise<string>;
  writeText?: (path: string, content: string) => Promise<void>;
  now?: () => number;
  cutpoint?: (stage: InformationArchitectureMigrationStage) => Promise<void> | void;
}>;

const stageIndex = (stage: InformationArchitectureMigrationStage) =>
  INFORMATION_ARCHITECTURE_MIGRATION_STAGES.indexOf(stage);

export class InformationArchitectureMigrationJournal {
  readonly filePath: string;
  private journal: Journal | null = null;
  private readonly readText: (path: string) => Promise<string>;
  private readonly writeText: (path: string, content: string) => Promise<void>;
  private readonly ensureDirectory: (path: string) => Promise<void>;
  private readonly now: () => number;

  constructor(userData: string, private readonly dependencies: Dependencies = {}) {
    this.filePath = join(userData, "migrations", "app-information-architecture-v1.json");
    this.ensureDirectory = dependencies.ensureDirectory ?? ((path) => mkdir(path, { recursive: true }).then(() => undefined));
    this.readText = dependencies.readText ?? ((path) => readFile(path, "utf8"));
    this.writeText = dependencies.writeText ?? durableReplaceFile;
    this.now = dependencies.now ?? Date.now;
  }

  async initialize() {
    await this.ensureDirectory(dirname(this.filePath));
    try {
      this.journal = parseJournal(JSON.parse(await this.readText(this.filePath)));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        await rename(
          this.filePath,
          `${this.filePath}.corrupt-${this.now()}`
        ).catch(() => undefined);
      }
      const now = this.now();
      this.journal = {
        schemaVersion: 1,
        migrationId: `app-information-architecture-v1:${now}`,
        stage: "prepared",
        edges: INFORMATION_ARCHITECTURE_MIGRATION_EDGES,
        receipts: {},
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        recoveredFromCorruption:
          (cause as NodeJS.ErrnoException).code !== "ENOENT",
      };
      await this.persist();
    }
    return this.snapshot();
  }

  snapshot() {
    if (!this.journal) throw new Error("information architecture journal 未初始化");
    return structuredClone(this.journal);
  }

  async advance(
    stage: InformationArchitectureMigrationStage,
    evidence?: InformationArchitectureMigrationEvidence
  ) {
    const current = this.snapshot();
    if (stageIndex(stage) < stageIndex(current.stage)) return current;
    if (stageIndex(stage) > stageIndex(current.stage) + 1) {
      throw new Error(`migration stage 不可跳跃：${current.stage} → ${stage}`);
    }
    if (stage === current.stage) return current;
    if (stage === "prepared" || !evidence) {
      throw new Error(`migration stage ${stage} 缺少 durable evidence`);
    }
    if (evidence.ledger !== LEDGER_BY_STAGE[stage]) {
      throw new Error(
        `migration stage ${stage} evidence ledger 错误：${evidence.ledger}`
      );
    }
    const committedAt = this.now();
    this.journal = {
      ...current,
      stage,
      receipts: {
        ...current.receipts,
        [stage]: { ...structuredClone(evidence), committedAt },
      },
      updatedAt: committedAt,
      completedAt: stage === "completed" ? committedAt : null,
    };
    await this.persist();
    await this.dependencies.cutpoint?.(stage);
    return this.snapshot();
  }

  private async persist() {
    await this.writeText(this.filePath, `${JSON.stringify(this.snapshot(), null, 2)}\n`);
  }
}

export function informationArchitectureMigrationEvidence(
  ledger: InformationArchitectureMigrationLedger,
  values: ReadonlyArray<Readonly<{ id: string; revision: string | number; value: unknown }>>
): InformationArchitectureMigrationEvidence {
  const records = values
    .map((item) => ({
      id: item.id,
      expectedRevision: String(item.revision),
      checksum: hash(item.value),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    ledger,
    expectedRevision: hash(records.map(({ id, expectedRevision }) => [id, expectedRevision])),
    checksum: hash(records),
    records,
  };
}

function parseJournal(raw: unknown): Journal {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("migration journal 不是对象");
  }
  const value = raw as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.migrationId !== "string" ||
    !INFORMATION_ARCHITECTURE_MIGRATION_STAGES.includes(
      value.stage as InformationArchitectureMigrationStage
    ) ||
    typeof value.startedAt !== "number" ||
    typeof value.updatedAt !== "number" ||
    (value.completedAt !== null && typeof value.completedAt !== "number") ||
    canonical(value.edges) !== canonical(INFORMATION_ARCHITECTURE_MIGRATION_EDGES) ||
    typeof value.recoveredFromCorruption !== "boolean"
  ) {
    throw new Error("migration journal shape 无效");
  }
  const stage = value.stage as InformationArchitectureMigrationStage;
  const receipts = parseReceipts(value.receipts, stage);
  const completedAt = value.completedAt as number | null;
  if (
    value.startedAt > value.updatedAt ||
    (stage === "completed"
      ? completedAt !== receipts.completed?.committedAt
      : completedAt !== null)
  ) {
    throw new Error("migration journal 时间线无效");
  }
  return { ...(value as Omit<Journal, "receipts">), receipts };
}

function parseReceipts(
  raw: unknown,
  currentStage: InformationArchitectureMigrationStage
): Journal["receipts"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("migration receipts shape 无效");
  }
  const values = raw as Record<string, unknown>;
  const receiptStages = INFORMATION_ARCHITECTURE_MIGRATION_STAGES.slice(1) as ReadonlyArray<
    Exclude<InformationArchitectureMigrationStage, "prepared">
  >;
  if (Object.keys(values).some((key) => !receiptStages.includes(key as never))) {
    throw new Error("migration receipts 包含未知 stage");
  }
  const receipts: Journal["receipts"] = {};
  for (const stage of receiptStages) {
    const shouldExist = stageIndex(stage) <= stageIndex(currentStage);
    const rawReceipt = values[stage];
    if (!shouldExist && rawReceipt !== undefined) {
      throw new Error(`migration receipt ${stage} 早于 stage 发布`);
    }
    if (!shouldExist) continue;
    receipts[stage] = parseReceipt(rawReceipt, stage);
  }
  return receipts;
}

function parseReceipt(
  raw: unknown,
  stage: Exclude<InformationArchitectureMigrationStage, "prepared">
): InformationArchitectureMigrationReceipt {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`migration receipt ${stage} 缺失`);
  }
  const value = raw as Record<string, unknown>;
  if (
    value.ledger !== LEDGER_BY_STAGE[stage] ||
    typeof value.expectedRevision !== "string" ||
    !isDigest(value.expectedRevision) ||
    typeof value.checksum !== "string" ||
    !isDigest(value.checksum) ||
    typeof value.committedAt !== "number" ||
    !Array.isArray(value.records)
  ) {
    throw new Error(`migration receipt ${stage} shape 无效`);
  }
  const records = value.records.map((rawRecord) => {
    if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
      throw new Error(`migration receipt ${stage} record shape 无效`);
    }
    const record = rawRecord as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      record.id.length === 0 ||
      typeof record.expectedRevision !== "string" ||
      record.expectedRevision.length === 0 ||
      typeof record.checksum !== "string" ||
      !isDigest(record.checksum)
    ) {
      throw new Error(`migration receipt ${stage} record shape 无效`);
    }
    return {
      id: record.id,
      expectedRevision: record.expectedRevision,
      checksum: record.checksum,
    };
  });
  const sorted = [...records].sort((left, right) => left.id.localeCompare(right.id));
  if (
    new Set(records.map(({ id }) => id)).size !== records.length ||
    canonical(records) !== canonical(sorted) ||
    value.expectedRevision !==
      hash(records.map(({ id, expectedRevision }) => [id, expectedRevision])) ||
    value.checksum !== hash(records)
  ) {
    throw new Error(`migration receipt ${stage} checksum 无效`);
  }
  return {
    ledger: value.ledger as InformationArchitectureMigrationLedger,
    expectedRevision: value.expectedRevision,
    checksum: value.checksum,
    records,
    committedAt: value.committedAt,
  };
}

const isDigest = (value: string) => /^[a-f0-9]{64}$/.test(value);

const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
