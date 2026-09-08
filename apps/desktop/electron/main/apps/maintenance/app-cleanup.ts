/**
 * [INPUT]: Depends on Electron session storage clearing, Node fs, backendById for maintenance-agent cleanup, and removeServeAck from apps/runtime/serve-loop
 * [OUTPUT]: Provides installLogPath and cleanupAppFiles, which removes every unowned file or state left behind by a deleted App
 * [POS]: apps module's single unowned-file cleanup list for App deletion; every new unowned path must be registered here. Ledger-backed data (`app-data/<appId>`) is out of scope — it is disposed by `settleDeleteData` via cascade discard or, under retain-data, archived into `app-data-archives/<archiveId>`
 */

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { session } from "electron";
import type { AppRecord } from "../../../../shared/apps-ipc";
import { backendById } from "../../backends";
import { removeServeAck } from "../runtime/serve-loop";

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
