/**
 * [INPUT]: Depends on the type of AppRecord/AppOperation shared/apps-ipc
 * [OUTPUT]: Provides lifecycle/progress translation maps, retry choices with titleKey/detailKey fields, effective operation/cancellation predicates, failed/working/pending-import/awaiting-generation predicates, declaresBaseGui, the record-level badge key, and detail redirect rules
 * [POS]: Pure Apps lifecycle semantics shared by cards, progress, and failure surfaces; locale copy remains in the Apps catalog
 */

import type {
  AppFailurePhase,
  AppOperation,
  AppRecord,
} from "../../../shared/apps-ipc";

type AppState = AppRecord["state"];
type FailedState = "install-failed" | "update-failed" | "delete-failed";

const stateLabelKey: Record<AppState, string> = {
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

/* ── 失败面的两句话：哪一步没过，以及你现在的处境 ────────────────────
 * 从前失败卡的标题是状态机的 state（「安装失败」），副标题是把 phase 枚举
 * 原样搬出来的「阶段：build」——最该被读到的第二行，写的是机器的话。
 *
 * 拆成两句各司其职的：标题说哪一步没过（阶段才是用户能对上的那件事），
 * 副标题说磁盘上还剩什么、这个 App 还能不能开。枚举退回机器区，那里才是
 * 它的位置。
 *
 * 两句是两个独立的 key，不做「{{phase}}，{{aftermath}}」的模板拼句：
 * 拼句要求五种语言共享同一个语序，而它们并不共享。
 * ────────────────────────────────────────────────────────────────── */
export const failurePhaseTitleKey: Record<AppFailurePhase, string> = {
  clone: "apps.failure.phaseTitle.clone",
  manifest: "apps.failure.phaseTitle.manifest",
  install: "apps.failure.phaseTitle.install",
  build: "apps.failure.phaseTitle.build",
  start: "apps.failure.phaseTitle.start",
  update: "apps.failure.phaseTitle.update",
  delete: "apps.failure.phaseTitle.delete",
};

export const failureAftermathKey: Record<FailedState, string> = {
  "install-failed": "apps.failure.aftermath.install",
  "update-failed": "apps.failure.aftermath.update",
  "delete-failed": "apps.failure.aftermath.delete",
};

/** 连清单都没读到的中断，处境与「装到一半失败」不同：磁盘上只有半份源码。 */
export const pendingImportAftermathKey = "apps.failure.aftermath.pendingImport";

/* ── 答案自带后果 ───────────────────────────────────────────────────
 * 一排平权按钮只能承载动词，选了会怎样只能写在别处或者根本不写。选项行
 * 要两句：标题是动词，detail 是这个答案的代价。于是每个答案在这里成对
 * 登记，而不是让调用点现拼 key —— 拼出来的 key grep 不到，也就没人能在
 * 改文案时找到它。
 * ────────────────────────────────────────────────────────────────── */
type FailureRetryKind = "reinstall" | "rebuild" | "continue";

export const failureRetryChoiceKey: Record<
  FailureRetryKind,
  Readonly<{ titleKey: string; detailKey: string }>
> = {
  reinstall: {
    titleKey: "apps.failure.choice.reinstall.title",
    detailKey: "apps.failure.choice.reinstall.detail",
  },
  rebuild: {
    titleKey: "apps.failure.choice.rebuild.title",
    detailKey: "apps.failure.choice.rebuild.detail",
  },
  continue: {
    titleKey: "apps.failure.choice.continue.title",
    detailKey: "apps.failure.choice.continue.detail",
  },
};

export const failureRetryKind = (record: AppRecord): FailureRetryKind =>
  isPendingBaseImport(record)
    ? "continue"
    : record.state === "update-failed"
      ? "rebuild"
      : "reinstall";

/** 修的是哪一份文件，决定了这个答案的后果句；两个值与 repairSite 一一对应。 */
export const repairDetailKey: Record<"staging" | "copy", string> = {
  staging: "apps.failure.choice.repair.staging",
  copy: "apps.failure.choice.repair.copy",
};

type CancelableAppOperation = Exclude<AppOperation, "delete">;

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

/**
 * 声明与已授权是两件事：manifest 里有 gui，这款 App 才谈得上 Studio 面。
 * 同一句判据从前在三处各写一遍——设置页的授权行、详情体的同意闸、
 * Use chat 的常驻开关。三处都对，但没有一处说了算，于是任何一次
 * manifest 形状的改动都得靠人记得改满三遍。
 */
export const declaresBaseGui = (record: Pick<AppRecord, "manifest">) =>
  record.manifest?.kind === "base" && Boolean(record.manifest.gui);
