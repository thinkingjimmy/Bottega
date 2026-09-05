/**
 * [INPUT]: Depends on one shared author-source analysis, frozen manifest capabilities, and the gate-3 author allowlist exported by metadata.ts (derived from runtime-dependencies.json)
 * [OUTPUT]: Provides independent Gate 1/2/3 new-generation admission without removing any installed runtime contract
 * [POS]: gui-build pre-sandbox admission boundary; compatibility serving remains outside this policy
 */

import type { BaseAppManifest } from "../../../../shared/apps-ipc";
import type { SourceFreezeReceipt } from "./contracts";
import { GATE_3_AUTHOR_SPECIFIERS } from "./metadata";
import { analyzeAuthorSource, type AuthorSourceAnalysis } from "./source-analysis";

const APP_GUI_ADMISSION_GATES = ["gate-1", "gate-2", "gate-3"] as const;
export type AppGuiAdmissionGate = (typeof APP_GUI_ADMISSION_GATES)[number];

const GATE_3_IMPORTS = new Set<string>(GATE_3_AUTHOR_SPECIFIERS);
const GATE_2_SDK_BINDINGS = new Set([
  "useBaseMeta",
  "useBaseSnapshot",
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

  /* 开发/CI 开关，不是产品配置：只关新一代与重建的准入，已封存的运行时照跑。
     空串关掉全部门，缺省（undefined）等于三门全开。 */
  static fromEnvironment(value = process.env.BOTTEGA_APP_GUI_ADMISSION_GATES) {
    if (value === undefined) return new AppGuiAdmissionPolicy();
    const gates = value === "" ? [] : value.split(",");
    if (gates.some((gate) => !APP_GUI_ADMISSION_GATES.includes(gate as AppGuiAdmissionGate))) {
      throw new Error("BOTTEGA_APP_GUI_ADMISSION_GATES contains an unknown gate");
    }
    return new AppGuiAdmissionPolicy(gates as AppGuiAdmissionGate[]);
  }

  async assert(receipt: SourceFreezeReceipt, manifest: BaseAppManifest) {
    const required = requiredGates(await analyzeAuthorSource(receipt), manifest);
    const closed = required.find((gate) => !this.open.has(gate));
    if (!closed) return required;
    const message = `${closed} admission is closed for new or rebuilt App GUI generations`;
    throw Object.assign(new Error(message), {
      code: "GUI_ADMISSION_GATE_CLOSED",
      findings: [{ code: "GUI_ADMISSION_GATE_CLOSED", file: "app.json", message }],
    });
  }
}

export function requiredGates(
  analysis: AuthorSourceAnalysis,
  manifest: BaseAppManifest
): readonly AppGuiAdmissionGate[] {
  const { specifiers, appReactBindings: bindings } = analysis;
  const gate3 = [...specifiers].some((specifier) => GATE_3_IMPORTS.has(specifier)) ||
    bindings.has("*") ||
    [...bindings].some((binding) => GATE_3_SDK_BINDINGS.has(binding)) ||
    Boolean(manifest.gui?.hostActions?.includes("file.export"));
  const gate2 = gate3 ||
    [...bindings].some((binding) => GATE_2_SDK_BINDINGS.has(binding)) ||
    Boolean(manifest.gui?.preferences) ||
    Boolean(manifest.gui?.capabilities.includes("workspace-read"));
  return ["gate-1", ...(gate2 ? ["gate-2" as const] : []), ...(gate3 ? ["gate-3" as const] : [])];
}
