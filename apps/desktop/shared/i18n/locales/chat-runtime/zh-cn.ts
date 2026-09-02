/**
 * [INPUT]: Depends on the English Chat runtime catalog shape
 * [OUTPUT]: Provides the Simplified Chinese Chat runtime catalog
 * [POS]: zh-CN projection for attachment, queue, submission, settings, and recovery messages
 */

import type { chatRuntimeEn } from "./en";

export const chatRuntimeZhCN: typeof chatRuntimeEn = {
  attachment: {
    takeoverFailed: "**运行状态接管失败：** {{message}}",
    chatLoadFailed: "**聊天加载失败：** {{message}}",
  },
  queue: {
    notPersisted: "消息未写入，请修正后重试。",
    recoverable: "消息可恢复；重发会派生新提交身份。",
    retryAgentTurn: "用户消息已持久化，请使用“重试 Agent turn”。",
    reconciling: "提交仍在对账，普通重试可能重复执行。",
    failedResourcesReleased: "提交已失败，main 已回收重试资源；请重新编辑发送。",
    failed: "提交已失败。",
    steerReturned: "steering 未完成，消息已退回队列。",
    staleResourcesDecision: "消息含重启前的资源；请选择精确重发或删除。",
    staleWorkspaceWait: "消息含重启前的 Workspace 资源；只能等待精确结果或删除。",
    steerPrepareFailed: "无法准备插入消息：{{message}}",
    steerVerifyFailed: "无法确认消息是否已插入：{{message}}",
    steerHistoryPending: "消息已插入，历史记录正在补写。",
    steerQueuedNext: "消息未被当前 turn 消费，已排为下一条。",
    steerDeliveryUnknown: "无法确认消息是否已送达，请核对对话后选择重发或删除。",
    turnEnded: "当前 turn 已结束，该消息将按正常队列发送。",
    viewChangedSteerCancelled: "Chat 视图已切换，未发送旧视图的 Steer。",
    workspaceChangedNoResend: "Workspace 已变化；这条消息不能按新 Workspace 重发，请删除后重新输入。",
    durableOutcomeUnavailable: "无法取得 durable outcome，已保持对账状态。",
    mainCustodyPending: "提交仍在 main custody 中，请等待确定结果。",
    noSafeNegativeProof: "Main 没有给出安全负证明，不能盲目重发。",
    ordinaryResendUnavailable: "当前提交不可普通重发；请按 durable outcome 提示处理。",
  },
  submission: {
    notSent: "**消息未发送：** {{message}}",
    stateUnknown: "**消息状态未知：** {{message}}。已保留原提交身份，请在队列中选择重发或删除。",
    relayPaused: "消息已排队：该 Section 的接力链已暂停，请先处理聊天顶部的“继续”提示。",
    relayPending: "消息已排队：该 Section 有待处理的接力消息。",
    acceptedRefreshFailed: "消息已被 Agent 接受，但本地会话状态刷新失败：{{message}}。请勿重复发送；当前任务仍会继续。",
    backendSetupRequired: "**需要先完成 {{backend}} 初始化。** 已为你打开安装与登录向导。",
    localPreparationFailed: "本地会话准备失败：{{message}}",
  },
  settings: {
    readFailed: "Agent 设置读取失败：{{message}}",
    saveFailed: "Agent 设置保存失败：{{message}}",
    transcriptReadFailed: "**Agent 设置读取失败：** {{message}}",
  },
  relayStopFailed: "停止整条 Section 接力链失败，已尝试停止当前请求：{{message}}。你可以重试。",
  actionFailed: "**{{action}}失败：** {{message}}",
  abandonTurn: "放弃轮次",
  acknowledgeCleanup: "确认清理",
  unnamed: "未命名",
};
