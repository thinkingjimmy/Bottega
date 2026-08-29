/**
 * [INPUT]: Depends on the type of AppRecord/AppOperation shared/apps-ipc
 * [OUTPUT]: Provides status document mapping, failed/working/pending-import/awaiting-generation predicates, the record-level badge label, pronouns and leave page rules
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

/**
 * state=ready 却还没有 active generation：包已落地，成代/授权尚未收口，
 * manifest 投影因而仍是 null。此时说「已就绪」是在替系统撒谎——同一张卡上
 * 的图标、描述都还停在占位形态。两个真相源打架时，以代绑定为准。
 */
export const isAwaitingGeneration = (record: AppRecord) =>
  record.state === "ready" && record.generationBinding.active === null;

export const appStateLabel = (record: AppRecord) =>
  isAwaitingGeneration(record) ? "待成代" : stateLabel[record.state];

export const shouldRedirectAppDetail = (state: AppState) =>
  state === "creating" || state === "installing";
