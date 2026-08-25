/**
 * [INPUT]: Depends on Electron session, Node fs, Backends, maintains port clearance and serve ack clearance
 * [OUTPUT]: Provides cleanup AppFiles and install LogPath and remove the full amount of files from the App
 * [POS]: The apps module's ** unmanaged** delete the cleanlist single source; The new feature must be registered here, and AppsService only calls without routing.The server data epoch is the AppDataCutoverLedger, the archive is the AppDataArchiveStore, and the data is not deleted by the user `settleDeleteData` Cascade by Cascade|Keep data and activate the bytes
 */

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { session } from "electron";
import type { AppRecord } from "../../../shared/apps-ipc";
import { backendById } from "../backends";
import { removeServeAck } from "./runtime/serve-loop";

export function installLogPath(userData: string, appId: string) {
  return join(userData, "logs", "apps", `${appId}.install.log`);
}

export async function cleanupAppFiles(
  paths: { userData: string; appsRoot: string },
  record: AppRecord,
  origin: string
) {
  const { userData, appsRoot } = paths;
  const { id: appId, dir: appDir } = record;
  const steps = [
    {
      label: "origin 存储",
      promise: session.defaultSession.clearStorageData({ origin }),
    },
    {
      label: "App 目录",
      promise: rm(appDir, { recursive: true, force: true }),
    },
    {
      label: "staging 目录",
      promise: rm(join(appsRoot, ".staging", appId), {
        recursive: true,
        force: true,
      }),
    },
    {
      label: "维护 Agent 状态",
      promise:
        record.maintenanceAgent === "auto"
          ? Promise.resolve()
          : backendById(record.maintenanceAgent).maintenance?.cleanup({
              userData,
              appId,
            }) ?? Promise.resolve(),
    },
    {
      label: "Repair workspace",
      promise: removeRepairRuns(userData, "repair-workspaces", appId),
    },
    {
      label: "Repair trash",
      promise: removeRepairRuns(userData, "repair-trash", appId),
    },
    {
      label: "Repair journal",
      promise: rm(join(userData, "apps-state", `${appId}.repair-journal`), {
        force: true,
      }),
    },
    {
      label: "安装日志",
      promise: rm(installLogPath(userData, appId), { force: true }),
    },
    {
      label: "仓库指纹",
      promise: rm(join(userData, "apps-state", `${appId}.fingerprint`), {
        force: true,
      }),
    },
    {
      label: "伺服 ack",
      promise: removeServeAck(userData, appId),
    },
    {
      label: "App 配置",
      promise: rm(join(userData, "app-config", `${appId}.json`), {
        force: true,
      }),
    },
  ];
  const results = await Promise.allSettled(steps.map(({ promise }) => promise));
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${steps[index].label}：${String(result.reason)}`]
      : []
  );
  if (failures.length > 0) {
    throw new Error(failures.join("；").slice(0, 3_500));
  }
}

async function removeRepairRuns(userData: string, root: string, appId: string) {
  const directory = join(userData, root);
  const names = await readdir(directory).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith(`${appId}-`))
      .map((name) =>
        rm(join(directory, name), { recursive: true, force: true })
      )
  );
}
