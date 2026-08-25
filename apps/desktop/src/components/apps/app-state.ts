/**
 * [INPUT]: Depends on the type of AppRecord/AppOperation shared/apps-ipc
 * [OUTPUT]: Provides status document mapping, failed/working/pending-import, pronouns and leave page rules
 * [POS]: state of apps → state of components→ Chinese text file only source, shared card with details page, eliminate three sets of maps simultaneously
 */

import type { AppOperation, AppRecord } from "../../../shared/apps-ipc";

type AppState = AppRecord["state"];
type FailedState = "install-failed" | "update-failed" | "delete-failed";

export const stateLabel: Record<AppState, string> = {
  creating: "创建中",
  installing: "安装中",
  ready: "已就绪",
  "install-failed": "安装失败",
  updating: "更新中",
  "update-failed": "更新失败",
  deleting: "删除中",
  "delete-failed": "删除失败",
  quarantined: "已隔离",
};

export const failureTitle: Record<FailedState, string> = {
  "install-failed": "安装失败",
  "update-failed": "更新失败",
  "delete-failed": "删除失败",
};

/** 重试按钮文案；install-failed 统一为"干净重装"（retryInstall 会清空 manifest 重装）。 */
export const retryLabel: Record<FailedState, string> = {
  "install-failed": "干净重装",
  "update-failed": "重试构建与启动",
  "delete-failed": "重试删除残留",
};

export const cancelOperationLabel: Record<AppOperation, string> = {
  install: "取消安装",
  update: "取消更新",
  repair: "取消修复",
};

export const isFailedState = (state: AppState): state is FailedState =>
  state === "install-failed" ||
  state === "update-failed" ||
  state === "delete-failed";

export const isPendingBaseImport = (record: AppRecord) =>
  record.state === "install-failed" &&
  record.manifest === null &&
  record.generationBinding.active === null &&
  (record.origin === "github" || record.origin === "preset");

export const isWorkingState = (state: AppState) =>
  state === "creating" ||
  state === "installing" ||
  state === "updating" ||
  state === "deleting";

export const shouldRedirectAppDetail = (state: AppState) =>
  state === "creating" || state === "installing";
