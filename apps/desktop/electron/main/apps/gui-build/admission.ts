/**
 * [INPUT]: Depends on immutable compiled source receipts, frozen manifest capabilities, and an internal exact gate allowlist
 * [OUTPUT]: Provides independent Gate 1/2/3 new-generation admission without removing any installed runtime contract
 * [POS]: gui-build pre-sandbox admission boundary; compatibility serving remains outside this policy
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import type { BaseAppManifest } from "../../../../shared/apps-ipc";
import type { SourceFreezeReceipt } from "./contracts";
import { analyzeAuthorModuleUsage } from "./source-analysis";

export const APP_GUI_ADMISSION_GATES = ["gate-1", "gate-2", "gate-3"] as const;
export type AppGuiAdmissionGate = (typeof APP_GUI_ADMISSION_GATES)[number];

const GATE_3_IMPORTS = new Set([
  "@bottega/app-blocks",
  "@bottega/charts",
  "@tanstack/react-table",
  "@tanstack/react-virtual",
  "react-hook-form",
  "zod",
  "date-fns",
  "@dnd-kit/core",
  "@dnd-kit/sortable",
]);
const GATE_2_SDK_BINDINGS = new Set([
  "useBaseMeta",
  "useBaseRows",
  "useBaseMutation",
  "useAttachment",
  "useAppPreferences",
  "useWorkspaceFiles",
  "useWorkspaceVersions",
  "useWorkspaceSourceLine",
  "useWorkspacePreview",
  "WorkspacePreview",
]);
const GATE_3_SDK_BINDINGS = new Set(["useHostAction", "useFileExport"]);

export class AppGuiAdmissionPolicy {
  private readonly open: ReadonlySet<AppGuiAdmissionGate>;

  constructor(gates: readonly AppGuiAdmissionGate[] = APP_GUI_ADMISSION_GATES) {
    this.open = new Set(gates);
  }

  static fromEnvironment(value = process.env.BOTTEGA_APP_GUI_ADMISSION_GATES) {
    if (value === undefined) return new AppGuiAdmissionPolicy();
    const gates = value === "" ? [] : value.split(",");
    if (gates.some((gate) => !APP_GUI_ADMISSION_GATES.includes(gate as AppGuiAdmissionGate))) {
      throw new Error("BOTTEGA_APP_GUI_ADMISSION_GATES contains an unknown gate");
    }
    return new AppGuiAdmissionPolicy(gates as AppGuiAdmissionGate[]);
  }

  async assert(receipt: SourceFreezeReceipt, manifest: BaseAppManifest) {
    const required = await requiredGates(receipt, manifest);
    const closed = required.find((gate) => !this.open.has(gate));
    if (!closed) return required;
    const message = `${closed} admission is closed for new or rebuilt App GUI generations`;
    throw Object.assign(new Error(message), {
      code: "GUI_ADMISSION_GATE_CLOSED",
      findings: [{ code: "GUI_ADMISSION_GATE_CLOSED", file: "app.json", message }],
    });
  }
}

export async function requiredGates(
  receipt: SourceFreezeReceipt,
  manifest: BaseAppManifest
): Promise<readonly AppGuiAdmissionGate[]> {
  const imports = new Set<string>();
  const sdkBindings = new Set<string>();
  for (const file of receipt.files) {
    if (!file.path.startsWith("gui/src/") || !/\.[jt]sx?$/.test(file.path)) continue;
    const source = await readFile(join(receipt.snapshotRoot, file.path), "utf8");
    const tree = ts.createSourceFile(file.path, source, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TSX);
    const usage = analyzeAuthorModuleUsage(tree);
    usage.specifiers.forEach((specifier) => imports.add(specifier));
    usage.appReactBindings.forEach((binding) => sdkBindings.add(binding));
  }
  const gate3 = [...imports].some((specifier) => GATE_3_IMPORTS.has(specifier)) ||
    sdkBindings.has("*") ||
    [...sdkBindings].some((binding) => GATE_3_SDK_BINDINGS.has(binding)) ||
    Boolean(manifest.gui?.hostActions?.includes("file.export"));
  const gate2 = gate3 ||
    [...sdkBindings].some((binding) => GATE_2_SDK_BINDINGS.has(binding)) ||
    Boolean(manifest.gui?.preferences) ||
    Boolean(manifest.gui?.capabilities.includes("workspace-read"));
  return ["gate-1", ...(gate2 ? ["gate-2" as const] : []), ...(gate3 ? ["gate-3" as const] : [])];
}
