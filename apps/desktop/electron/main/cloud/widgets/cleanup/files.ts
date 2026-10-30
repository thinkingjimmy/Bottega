/**
 * [INPUT]: Depends on exact Widget journal schemas, the original authored runtime pins and guarded account-owned filesystem paths.
 * [OUTPUT]: Provides cold account cleanup, original source-pin release and bounded scoped API/archive/ciphertext removal without touching source Projects or Chats.
 * [POS]: Deferred cleanup implementation; loaded owners replace direct file mutation through WidgetScopeCleanup.
 */
import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { DurableJson, syncDirectory } from "../../../persistence/durable-json";
import { removeWidgetAccountArchives } from "../../../plugins/surface-runtime/packages/retention";
import { widgetPackageLedgerSchema } from "../../../plugins/surface-runtime/packages/store";
import { runtimeFileSchema } from "../../../plugins/surface-runtime/model";
import type { PluginSurfaceRuntime } from "../../../plugins/surface-runtime/service";
import {widgetDefinitionLedgerSchema} from '../../../system-dock/widgets/lifecycle/model';
import { localWidgetRuntimeSchema } from "../../../system-dock/store/custom/model";
import { widgetInstanceLedgerSchema } from "../../../system-dock/store/custom/instances";
import { installLedgerSchema } from "../../../system-dock/widgets/install/model";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { WidgetCleanupParticipant } from "./owner";
const stat = async (path: string) =>
  lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
async function regular(path: string) {
  const info = await stat(path);
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1))
    throw new Error("WIDGET_CLEANUP_CUSTODY_CHANGED");
  return info;
}
async function directory(path: string) {
  const info = await stat(path);
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error("WIDGET_CLEANUP_CUSTODY_CHANGED");
  return info;
}
export async function widgetAccountPins(
  userData: string,
  installationId: string,
  accountId: string,
) {
  const path = join(userData, "dock-widget-packages.json");
  if (!(await regular(path))) return [];
  const file = new DurableJson(path, widgetPackageLedgerSchema, () => ({
    version: 1 as const,
    packages: [],
  }));
  await file.initialize();
  try {
    return file
      .snapshot()
      .packages.filter(
        (value) =>
          value.descriptor.source.accountId === accountId &&
          value.descriptor.source.installationId === installationId,
      )
      .flatMap((value) =>
        value.operationIds.map((id) => ({
          definitionId: value.descriptor.source.definitionId,
          generationId: value.descriptor.source.generationId,
          id,
        })),
      );
  } finally {
    await file.closeAndFlush();
  }
}
export async function clearWidgetRuntimePins(
  userData: string,
  installationId: string,
  accountId: string,
  runtime: PluginSurfaceRuntime,
) {
  await runtime.releaseAccountGenerations({ accountId, installationId });
  for (const pin of await widgetAccountPins(
    userData,
    installationId,
    accountId,
  )) {
    const record = runtime.descriptor(pin.definitionId);
    if (
      record?.retentionPins.some(
        (value) =>
          value.id === pin.id && value.generationId === pin.generationId,
      )
    )
      await runtime.releaseGeneration(pin.definitionId, pin.id);
  }
}
export async function clearWidgetAccountFile(
  userData: string,
  installationId: string,
  accountId: string,
  name: WidgetCleanupParticipant,
) {
  if(name==="api"){const {clearApiAccountFile}=await import("../../../system-dock/widgets/api/state/cleanup");await clearApiAccountFile(userData,accountId);return;}
  const names = {
    definitions:"dock-widget-definitions.json",
    applications: "dock-widget-runtime.json",
    instances: "dock-widget-instances.json",
    installations: "dock-widget-installations.json",
    generations: "plugin-surfaces.json",
    packages: "dock-widget-packages.json",
  };
  const path = join(userData, names[name]);
  if (name === "packages")
    await removeWidgetAccountArchives(userData, accountId);
  if (!(await regular(path))) return;
  if(name==="definitions"){const file=new DurableJson(path,widgetDefinitionLedgerSchema,()=>({version:1 as const,retirements:[]}));await file.initialize();try{await file.mutate(state=>{state.retirements=state.retirements.filter(value=>value.scope.accountId!==accountId);});}finally{await file.closeAndFlush();}}else if (name === "applications") {
    const file = new DurableJson(path, localWidgetRuntimeSchema, () => ({
      version: 1 as const,
      mappings: [],
      operations: [],
    }));
    await file.initialize();
    try {
      await file.mutate((state) => {
        state.mappings = state.mappings.filter(
          (value) => value.scope.accountId !== accountId,
        );
        state.operations = state.operations.filter(
          (value) => value.scope.accountId !== accountId,
        );
      });
    } finally {
      await file.closeAndFlush();
    }
  } else if (name === "instances") {
    const file = new DurableJson(path, widgetInstanceLedgerSchema, () => ({
      version: 1 as const,
      operations: [],
    }));
    await file.initialize();
    try {
      await file.mutate((state) => {
        state.operations = state.operations.filter(
          (value) => value.scope.accountId !== accountId,
        );
      });
    } finally {
      await file.closeAndFlush();
    }
  } else if (name === "installations") {
    const file = new DurableJson(path, installLedgerSchema, () => ({
      version: 1 as const,
      confirmations: [],
      operations: [],
      uninstalls: [],
    }));
    await file.initialize();
    try {
      await file.mutate((state) => {
        state.uninstalls = state.uninstalls.filter(
          (value) => value.scope.accountId !== accountId,
        );
        state.confirmations = state.confirmations.filter(
          (value) => value.scope.accountId !== accountId,
        );
        state.operations = state.operations.filter(
          (value) => value.scope.accountId !== accountId,
        );
      });
    } finally {
      await file.closeAndFlush();
    }
  } else if (name === "packages") {
    const file = new DurableJson(path, widgetPackageLedgerSchema, () => ({
      version: 1 as const,
      packages: [],
    }));
    await file.initialize();
    try {
      await file.mutate((state) => {
        state.packages = state.packages.filter(
          (value) => value.descriptor.source.accountId !== accountId,
        );
      });
    } finally {
      await file.closeAndFlush();
    }
  } else {
    const pins = await widgetAccountPins(userData, installationId, accountId);
    const file = new DurableJson(path, runtimeFileSchema, () => ({
      schemaVersion: 1 as const,
      plugins: [],
      quarantined: [],
    }));
    await file.initialize();
    try {
      await file.mutate((state) => {
        for (const record of [...state.plugins, ...state.quarantined])
          record.retentionPins = record.retentionPins.filter(
            (value) =>
              !(
                value.scope?.accountId === accountId &&
                value.scope.installationId === installationId
              ) &&
              !pins.some(
                (pin) =>
                  pin.definitionId === record.pluginId &&
                  pin.id === value.id &&
                  pin.generationId === value.generationId,
              ),
          );
      });
    } finally {
      await file.closeAndFlush();
    }
  }
}
export async function clearWidgetCiphertext(
  userData: string,
  scope: SyncScope,
) {
  const root = join(userData, "widget-source-custody"),
    account = join(root, hashCanonical(scope));
  if (
    !(await directory(userData)) ||
    !(await directory(root)) ||
    !(await directory(account))
  )
    return;
  await rm(account, { recursive: true });
  await syncDirectory(root);
}
