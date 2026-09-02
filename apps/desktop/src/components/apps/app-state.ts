/**
 * [INPUT]: Depends on the type of AppRecord/AppOperation shared/apps-ipc
 * [OUTPUT]: Provides lifecycle/progress translation maps, effective operation/cancellation predicates, failed/working/pending-import/awaiting-generation predicates, the record-level badge key, and detail redirect rules
 * [POS]: Pure Apps lifecycle semantics shared by cards, progress, and failure surfaces; locale copy remains in the Apps catalog
 */

import type { AppOperation, AppRecord } from "../../../shared/apps-ipc";

type AppState = AppRecord["state"];
type FailedState = "install-failed" | "update-failed" | "delete-failed";

export const stateLabelKey: Record<AppState, string> = {
  creating: "apps.state.creating",
  installing: "apps.state.installing",
  ready: "apps.state.ready",
  "install-failed": "apps.state.installFailed",
  updating: "apps.state.updating",
  "update-failed": "apps.state.updateFailed",
  deleting: "apps.state.deleting",
  "delete-failed": "apps.state.deleteFailed",
  quarantined: "apps.state.quarantined",
};

export const failureTitleKey: Record<FailedState, string> = {
  "install-failed": "apps.state.installFailed",
  "update-failed": "apps.state.updateFailed",
  "delete-failed": "apps.state.deleteFailed",
};

/** 重试按钮文案；install-failed 统一为"干净重装"（retryInstall 会清空 manifest 重装）。 */
export const retryLabelKey: Record<FailedState, string> = {
  "install-failed": "apps.state.retryCleanInstall",
  "update-failed": "apps.state.retryBuild",
  "delete-failed": "apps.state.retryDelete",
};

export type CancelableAppOperation = Exclude<AppOperation, "delete">;

export const cancelOperationLabelKey: Record<CancelableAppOperation, string> = {
  install: "apps.state.cancelInstall",
  update: "apps.state.cancelUpdate",
  repair: "apps.state.cancelRepair",
};

export const progressTitleKey: Record<AppOperation, string> = {
  install: "apps.progress.installingTitle",
  update: "apps.progress.updatingTitle",
  repair: "apps.progress.repairingTitle",
  delete: "apps.progress.deletingTitle",
};

export const progressAriaKey: Record<AppOperation, string> = {
  install: "apps.progress.installingAria",
  update: "apps.progress.updatingAria",
  repair: "apps.progress.repairingAria",
  delete: "apps.progress.deletingAria",
};

export const effectiveAppOperation = (
  record: AppRecord,
  operation?: AppOperation
): AppOperation => {
  if (record.state === "deleting") return "delete";
  if (record.state === "creating" || record.state === "installing") {
    return "install";
  }
  if (record.state === "updating") {
    return operation === "repair" ? "repair" : "update";
  }
  return operation ?? "install";
};

export const isCancelableOperation = (
  operation: AppOperation
): operation is CancelableAppOperation => operation !== "delete";

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

const awaitingGenerationLabelKey = "apps.state.awaitingGeneration";

export const appStateLabelKey = (record: AppRecord) =>
  isAwaitingGeneration(record)
    ? awaitingGenerationLabelKey
    : stateLabelKey[record.state];

export const shouldRedirectAppDetail = (state: AppState) =>
  state === "creating" || state === "installing";
