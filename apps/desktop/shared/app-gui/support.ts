/**
 * [INPUT]: Depends on zod and discriminated App GUI compatibility refs
 * [OUTPUT]: Provides the strict compatibility-support matrix schema/type and one deterministic supported/blocked/quarantine verdict; run-contract derivation stays internal because the verdict is the only thing any caller reads
 * [POS]: Shared app-gui release floor; updater and rollback gates consume this pure verdict instead of inferring support from local refcounts
 */

import { z } from "zod";
import type { AppGuiCompatibilityRef } from "./contracts";

const APP_GUI_RUN_CONTRACTS = [
  "base-gui-legacy-v1",
  "sealed-runtime-v3",
  "app-generation-cutover-v2",
  "base-gui-query-v1",
  "app-preferences-v1",
  "workspace-read-v1",
  "workspace-opaque-preview-v1",
  "host-actions-v1",
  "file-export-v1",
] as const;

type AppGuiRunContract = (typeof APP_GUI_RUN_CONTRACTS)[number];

export const appGuiCompatibilitySupportSchema = z.object({
  schema: z.literal("bottega.app-gui-compatibility-support/v1"),
  generationAdmission: z.object({
    environmentVariable: z.literal("BOTTEGA_APP_GUI_ADMISSION_GATES"),
    defaultOpen: z.array(z.enum(["gate-1", "gate-2", "gate-3"])).max(3),
    semantics: z.string().min(1).max(500),
  }).strict(),
  runContracts: z.array(z.enum(APP_GUI_RUN_CONTRACTS)).max(APP_GUI_RUN_CONTRACTS.length),
  authoringContracts: z.array(z.string().min(1).max(100)).max(20),
  securityRevocations: z.array(z.enum(APP_GUI_RUN_CONTRACTS)).max(APP_GUI_RUN_CONTRACTS.length),
  migrationTargets: z.partialRecord(z.enum(APP_GUI_RUN_CONTRACTS), z.string().min(1).max(200)),
}).strict().superRefine((matrix, context) => {
  for (const field of ["runContracts", "authoringContracts", "securityRevocations"] as const) {
    if (new Set(matrix[field]).size !== matrix[field].length) {
      context.addIssue({ code: "custom", path: [field], message: `${field} contains duplicates` });
    }
  }
});

export type AppGuiCompatibilitySupport = z.infer<typeof appGuiCompatibilitySupportSchema>;
type AppGuiCompatibilityVerdict =
  | Readonly<{ status: "supported"; required: readonly AppGuiRunContract[] }>
  | Readonly<{
      status: "blocked";
      required: readonly AppGuiRunContract[];
      unsupported: readonly AppGuiRunContract[];
      migrationTargets: Readonly<Partial<Record<AppGuiRunContract, string>>>;
    }>
  | Readonly<{
      status: "quarantine";
      required: readonly AppGuiRunContract[];
      revoked: readonly AppGuiRunContract[];
      migrationTargets: Readonly<Partial<Record<AppGuiRunContract, string>>>;
    }>;

function requiredAppGuiRunContracts(
  refs: readonly AppGuiCompatibilityRef[]
): readonly AppGuiRunContract[] {
  const required = new Set<AppGuiRunContract>();
  for (const ref of refs) addRequiredContracts(required, ref);
  return APP_GUI_RUN_CONTRACTS.filter((contract) => required.has(contract));
}

export function evaluateAppGuiCompatibility(
  refs: readonly AppGuiCompatibilityRef[],
  input: unknown
): AppGuiCompatibilityVerdict {
  const matrix = appGuiCompatibilitySupportSchema.parse(input);
  const required = requiredAppGuiRunContracts(refs);
  const revoked = required.filter((contract) => matrix.securityRevocations.includes(contract));
  if (revoked.length) {
    return { status: "quarantine", required, revoked, migrationTargets: targets(matrix, revoked) };
  }
  const unsupported = required.filter((contract) => !matrix.runContracts.includes(contract));
  return unsupported.length
    ? { status: "blocked", required, unsupported, migrationTargets: targets(matrix, unsupported) }
    : { status: "supported", required };
}

function addRequiredContracts(
  required: Set<AppGuiRunContract>,
  ref: AppGuiCompatibilityRef
) {
  if (ref.kind === "static-v2") {
    required.add("base-gui-legacy-v1");
    return;
  }
  required.add("sealed-runtime-v3");
  required.add("app-generation-cutover-v2");
  if (ref.dataSdk.kind !== "none") required.add("base-gui-query-v1");
  if (ref.preferences.kind !== "none") required.add("app-preferences-v1");
  if (ref.workspace.kind !== "none") {
    required.add("workspace-read-v1");
    required.add("workspace-opaque-preview-v1");
  }
  if (ref.hostActions.kind !== "none") {
    required.add("host-actions-v1");
    if (ref.hostActions.required.includes("file.export")) required.add("file-export-v1");
  }
}

function targets(
  matrix: AppGuiCompatibilitySupport,
  contracts: readonly AppGuiRunContract[]
) {
  return Object.fromEntries(
    contracts.flatMap((contract) => matrix.migrationTargets[contract]
      ? [[contract, matrix.migrationTargets[contract]]]
      : [])
  );
}
