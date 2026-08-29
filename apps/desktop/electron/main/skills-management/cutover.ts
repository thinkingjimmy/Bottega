/**
 * [INPUT]: Depends on the retired projections-v2 ledger, digest observation, durable file replacement, Extension Registry ref release, and filesystem rename/remove primitives
 * [OUTPUT]: Provides an idempotent deprojection-only startup cutover with guarded backup return, explicit in-place relinquishment of pure projections, old job abandonment, and kill-point recovery
 * [POS]: Global Skills startup barrier; no catalog, IPC, or turn runtime may start until this module removes projections.json as its completion marker
 */

import { access, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionPackageGenerationRef } from "../../../shared/extensions-ipc";
import type { ExtensionRegistryStore } from "../extensions/registry-store";
import { durableReplaceFile } from "../persistence/durable-json";
import { observeSkillFolderDigest } from "./package";

const MATERIALIZATION_ACTIONS = new Set([
  "project",
  "takeover",
  "rematerialize",
  "upgrade",
]);
const WITHDRAWAL_ACTIONS = new Set([
  "remove",
  "withhold",
  "takeover-withhold",
  "repair",
  "release-backup",
  "abandon-backup",
]);
const TERMINAL_PHASES = new Set(["committed", "failed"]);

type RetiredBinding = Readonly<{
  bindingId: string;
  targetPath: string;
  generationDigest: string;
  backupPath: string | null;
  backupDigest: string | null;
  packageGenerationId: string | null;
  packageRecordDigest: string | null;
}>;

type RetiredOperation = Readonly<{
  action: string;
  phase: string;
  targetPath: string;
  generationDigest: string;
  previousGenerationDigest: string | null;
  stagePath: string;
  backupPath: string;
  backupDigest: string | null;
  trashPath: string;
}>;

type RetiredProjectionStore = Readonly<{
  schemaVersion: 2;
  bindings: readonly RetiredBinding[];
  operations: readonly RetiredOperation[];
}>;

export type SkillsCutoverFaults = Readonly<{
  afterOperations?: () => void | Promise<void>;
  afterBackup?: (index: number) => void | Promise<void>;
  afterReferences?: () => void | Promise<void>;
}>;

export type SkillsCutoverReport = Readonly<{
  performed: boolean;
  returnedBackups: number;
  preservedTargets: number;
  missingBackups: number;
  releasedReferences: number;
  abandonedJobs: number;
}>;

export async function runSkillsCutover(input: Readonly<{
  userData: string;
  registry: Pick<ExtensionRegistryStore, "releaseGenerationRef">;
  faults?: SkillsCutoverFaults;
}>): Promise<SkillsCutoverReport> {
  const root = join(input.userData, "unified-skills");
  const projectionsPath = join(root, "projections.json");
  if (!(await exists(projectionsPath))) return emptyReport();
  const ledger = parseRetiredLedger(
    JSON.parse(await readFile(projectionsPath, "utf8"))
  );
  const report = mutableReport();

  for (const operation of ledger.operations) {
    if (!TERMINAL_PHASES.has(operation.phase)) {
      await finishOperation(operation, report);
    }
  }
  await input.faults?.afterOperations?.();

  for (const [index, binding] of ledger.bindings.entries()) {
    if (binding.backupPath) {
      await returnBackup(
        {
          targetPath: binding.targetPath,
          managedDigest: binding.generationDigest,
          backupPath: binding.backupPath,
          backupDigest: binding.backupDigest,
        },
        report
      );
      await input.faults?.afterBackup?.(index);
    }
  }

  for (const binding of ledger.bindings) {
    const ref = extensionRef(binding);
    if (!ref) continue;
    await input.registry.releaseGenerationRef(
      ref,
      `unified-skill:${binding.bindingId}`
    );
    report.releasedReferences += 1;
  }
  await input.faults?.afterReferences?.();

  report.abandonedJobs = await breakJobsGeneration(join(root, "jobs.json"));
  await cleanupStateDirectories(ledger);
  await rm(projectionsPath, { force: true });
  return Object.freeze({ ...report, performed: true });
}

async function finishOperation(
  operation: RetiredOperation,
  report: ReturnType<typeof mutableReport>
) {
  await rm(operation.stagePath, { recursive: true, force: true });
  if (WITHDRAWAL_ACTIONS.has(operation.action)) {
    if (operation.backupPath) {
      await returnBackup(
        {
          targetPath: operation.targetPath,
          managedDigest: operation.generationDigest,
          backupPath: operation.backupPath,
          backupDigest: operation.backupDigest,
        },
        report
      );
    }
    await rm(operation.trashPath, { recursive: true, force: true });
    return;
  }
  if (!MATERIALIZATION_ACTIONS.has(operation.action)) return;

  if (operation.action === "takeover" && operation.backupPath) {
    await returnBackup(
      {
        targetPath: operation.targetPath,
        managedDigest: operation.generationDigest,
        backupPath: operation.backupPath,
        backupDigest: operation.backupDigest,
      },
      report
    );
    return;
  }

  const target = await observeSkillFolderDigest(operation.targetPath);
  if (target.kind === "present" && target.digest === operation.generationDigest) {
    await rm(operation.targetPath, { recursive: true, force: true });
  }
  const trash = await observeSkillFolderDigest(operation.trashPath);
  if (
    trash.kind === "present" &&
    operation.previousGenerationDigest &&
    trash.digest === operation.previousGenerationDigest &&
    (await observeSkillFolderDigest(operation.targetPath)).kind === "missing"
  ) {
    await rename(operation.trashPath, operation.targetPath);
  } else if (trash.kind !== "unavailable") {
    await rm(operation.trashPath, { recursive: true, force: true });
  }
}

async function returnBackup(
  input: Readonly<{
    targetPath: string;
    managedDigest: string;
    backupPath: string;
    backupDigest: string | null;
  }>,
  report: ReturnType<typeof mutableReport>
) {
  const backup = await observeSkillFolderDigest(input.backupPath);
  if (
    backup.kind !== "present" ||
    (input.backupDigest !== null && backup.digest !== input.backupDigest)
  ) {
    report.missingBackups += 1;
    return;
  }
  const target = await observeSkillFolderDigest(input.targetPath);
  if (target.kind === "present") {
    if (target.digest !== input.managedDigest) {
      report.preservedTargets += 1;
      return;
    }
    await rm(input.targetPath, { recursive: true, force: true });
  } else if (target.kind !== "missing") {
    report.preservedTargets += 1;
    return;
  }
  await rename(input.backupPath, input.targetPath);
  report.returnedBackups += 1;
}

async function breakJobsGeneration(path: string) {
  if (!(await exists(path))) return 0;
  let abandoned = 0;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      schemaVersion?: unknown;
      jobs?: unknown;
    };
    if (raw.schemaVersion === 2) {
      const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
      return jobs.filter((job) =>
        job &&
        typeof job === "object" &&
        (job as { status?: unknown }).status === "abandoned"
      ).length;
    }
    const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
    abandoned = jobs.filter((job) => {
      const status =
        job && typeof job === "object"
          ? (job as { status?: unknown }).status
          : null;
      return ![
        "completed",
        "completed-with-failures",
        "failed",
        "undone",
      ].includes(String(status));
    }).length;
  } catch {
    abandoned = 0;
  }
  await durableReplaceFile(
    path,
    `${JSON.stringify(
      { schemaVersion: 2, jobs: [], abandonedJobs: abandoned },
      null,
      2
    )}\n`
  );
  return abandoned;
}

async function cleanupStateDirectories(ledger: RetiredProjectionStore) {
  const candidates = new Set<string>();
  for (const binding of ledger.bindings) {
    if (binding.backupPath) candidates.add(dirname(binding.backupPath));
  }
  for (const operation of ledger.operations) {
    candidates.add(dirname(operation.stagePath));
    candidates.add(dirname(operation.backupPath));
    candidates.add(dirname(operation.trashPath));
  }
  for (const directory of candidates) {
    const entries = await readdir(directory).catch(() => null);
    if (entries?.length === 0) await rmdir(directory).catch(() => undefined);
  }
}

function extensionRef(
  binding: RetiredBinding
): ExtensionPackageGenerationRef | null {
  if (!binding.packageGenerationId || !binding.packageRecordDigest) return null;
  return {
    packageGenerationId: binding.packageGenerationId,
    recordDigest:
      binding.packageRecordDigest as ExtensionPackageGenerationRef["recordDigest"],
  };
}

function parseRetiredLedger(value: unknown): RetiredProjectionStore {
  if (!value || typeof value !== "object") throw invalidLedger();
  const raw = value as {
    schemaVersion?: unknown;
    bindings?: unknown;
    operations?: unknown;
  };
  if (
    raw.schemaVersion !== 2 ||
    !Array.isArray(raw.bindings) ||
    !Array.isArray(raw.operations)
  ) {
    throw invalidLedger();
  }
  return {
    schemaVersion: 2,
    bindings: raw.bindings.map(parseBinding),
    operations: raw.operations.map(parseOperation),
  };
}

function parseBinding(value: unknown): RetiredBinding {
  const item = record(value);
  return {
    bindingId: text(item.bindingId),
    targetPath: text(item.targetPath),
    generationDigest: digest(item.generationDigest),
    backupPath: nullableText(item.backupPath),
    backupDigest: nullableDigest(item.backupDigest),
    packageGenerationId: nullableText(item.packageGenerationId),
    packageRecordDigest: nullableDigest(item.packageRecordDigest),
  };
}

function parseOperation(value: unknown): RetiredOperation {
  const item = record(value);
  return {
    action: text(item.action),
    phase: text(item.phase),
    targetPath: text(item.targetPath),
    generationDigest: digest(item.generationDigest),
    previousGenerationDigest: nullableDigest(item.previousGenerationDigest),
    stagePath: text(item.stagePath),
    backupPath: text(item.backupPath),
    backupDigest: nullableDigest(item.backupDigest),
    trashPath: text(item.trashPath),
  };
}

function record(value: unknown) {
  if (!value || typeof value !== "object") throw invalidLedger();
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  if (typeof value !== "string" || !value) throw invalidLedger();
  return value;
}

function nullableText(value: unknown) {
  return value === null ? null : text(value);
}

function digest(value: unknown) {
  const result = text(value);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw invalidLedger();
  return result;
}

function nullableDigest(value: unknown) {
  return value === null || value === undefined ? null : digest(value);
}

function invalidLedger() {
  return new Error("旧 Skills projections v2 账本无效，拒绝越过启动屏障");
}

function mutableReport() {
  return {
    performed: true,
    returnedBackups: 0,
    preservedTargets: 0,
    missingBackups: 0,
    releasedReferences: 0,
    abandonedJobs: 0,
  };
}

function emptyReport(): SkillsCutoverReport {
  return Object.freeze({
    performed: false,
    returnedBackups: 0,
    preservedTargets: 0,
    missingBackups: 0,
    releasedReferences: 0,
    abandonedJobs: 0,
  });
}

function exists(path: string) {
  return access(path).then(
    () => true,
    () => false
  );
}
