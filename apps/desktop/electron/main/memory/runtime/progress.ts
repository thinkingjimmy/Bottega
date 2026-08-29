/**
 * [INPUT]: Depends on shared MemoryRuntimeOperation and MemoryRuntimeStepKind
 * [OUTPUT]: Re-exports StepKind from shared and provides operationSteps/operationStepTotal; the order of steps per managed operation is only this true value, while which kinds exist belongs to shared
 * [POS]: The main/memory/runtime purely progressive specification; Coordinator progresses by table and verifies completeness at the end
 */

import type {
  MemoryRuntimeOperation,
  MemoryRuntimeStepKind,
} from "../../../../shared/memory-ipc";

/* 步骤身份住在 shared：renderer 要按它取文案，两处各写一份枚举迟早
   长出只有一边认得的档。这里只排顺序，不再定义有哪些档。 */
export type StepKind = MemoryRuntimeStepKind;

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
