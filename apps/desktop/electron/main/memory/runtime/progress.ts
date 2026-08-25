/**
 * [INPUT]: Depends on shared MemoryRuntimeOperation
 * [OUTPUT]: Provides StepKind, operationSteps and operationStepTotal; The type/order of steps for each type of host operation is only this true value
 * [POS]: The main/memory/runtime purely progressive specification; Coordinator progresses by table and verifies completeness at the end
 */

import type { MemoryRuntimeOperation } from "../../../../shared/memory-ipc";

export type StepKind =
  | "refresh-version-catalog"
  | "remove-plist"
  | "remove-venv"
  | "prepare-toolchain"
  | "ensure-venv"
  | "fetch-artifacts"
  | "install-packages"
  | "register-manifest"
  | "initialize"
  | "model-assets"
  | "config-converge"
  | "install-plist"
  | "bootstrap"
  | "await-ready"
  | "config-write"
  | "config-regenerate"
  | "config-adopt-manual"
  | "bootout"
  | "wipe-data"
  | "remove-root";

const INSTALL_STEPS = [
  "prepare-toolchain",
  "ensure-venv",
  "fetch-artifacts",
  "install-packages",
  "register-manifest",
  "initialize",
  "model-assets",
  "config-converge",
  "install-plist",
  "bootstrap",
  "await-ready",
] as const satisfies readonly StepKind[];

export const RUNTIME_OPERATION_STEPS: Record<
  MemoryRuntimeOperation,
  readonly StepKind[]
> = {
  install: INSTALL_STEPS,
  repair: INSTALL_STEPS,
  upgrade: ["remove-plist", "remove-venv", ...INSTALL_STEPS],
  "switch-version": [
    "refresh-version-catalog",
    "remove-plist",
    "remove-venv",
    ...INSTALL_STEPS,
  ],
  "config-write": ["config-write", "bootstrap", "await-ready"],
  "config-regenerate": ["config-regenerate", "bootstrap", "await-ready"],
  "config-adopt-manual": ["config-adopt-manual"],
  bootstrap: ["bootstrap"],
  bootout: ["bootout"],
  "runtime-reset": [
    "wipe-data",
    "initialize",
    "config-converge",
    "install-plist",
    "bootstrap",
    "await-ready",
  ],
  uninstall: ["remove-plist", "remove-root"],
};

export const operationStepTotal = (operation: MemoryRuntimeOperation) =>
  RUNTIME_OPERATION_STEPS[operation].length;

export const operationSteps = (operation: MemoryRuntimeOperation) =>
  RUNTIME_OPERATION_STEPS[operation];
