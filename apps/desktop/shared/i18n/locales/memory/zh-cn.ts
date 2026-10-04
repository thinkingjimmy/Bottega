/**
 * [INPUT]: Depends on memoryEn from ./en for both its structural type and the English leaves this catalog reuses
 * [OUTPUT]: Includes Memory access selection, explicit workflow-read consent, plugin chrome and native-memory distinction; Provides memoryZhCN, the Simplified Chinese Memory catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/memory; loaded on demand by the matching top-level locale
 */

import { memoryEn } from "./en";

export const memoryZhCN: typeof memoryEn = {
  ...memoryEn,
  plugin: { open: "打开 Memory 插件", name: "Memory", official: "官方 · 内置", about: "关于 Memory", unsupported: "此平台暂不支持 Memory。目前仅在 macOS 上可用。", nativeDistinction: "Bottega Memory 与 Codex、Claude 自带的记忆分开管理；原生记忆在各自插件设置中控制。" },
  access: {"none": "不使用", "readOnly": "只读", "description": "只读时，为此角色召回相关记忆。流程角色不会写入 Memory。", "workflowOff": "Memory 插件尚未允许流程角色读取。", "workflowOn": "这台电脑已允许流程角色读取 Memory。"},
  workflow: {"sectionTitle": "访问与控制", "label": "允许流程角色读取 Memory", "description": "只有配置选择“只读”的流程角色可以召回记忆。流程角色不会写入 Memory。", "consentTitle": "允许流程角色读取 Memory？", "consentBody": "已配置的规划、开发和评审角色可按任务名称和验收标准，在当前 Chat 或 Project 范围内召回记忆。流程角色不会写入记忆。暂停 Memory 或关闭此许可后，下一步骤将停止召回。", "confirm": "允许只读访问", "requiresActive": "请先启用 Memory 并完成同意。若已暂停，请先恢复 Memory。", "personal": "整台电脑共享记忆时，流程角色不能读取。请选择 Chat 或 Project 范围。", "saveFailed": "流程读取许可保存失败，请重试。"},
  store: {
    providerListFailed: "Memory provider 列表读取失败",
    statusFailed: "Memory 状态读取失败",
    healthFailed: "Memory 健康检查失败",
    historyPreviewFailed: "Memory 历史预览失败",
    attentionFailed: "Memory 挂起处置失败",
    runtimeStatusFailed: "Memory 运行时状态读取失败",
    configIssueFailed: "Memory 配置问题处置失败",
    manualConfigPreviewFailed: "Memory 手工配置目的地预览失败",
    runtimeOperationFailed: "Memory 运行时操作失败",
    updateCheckFailed: "Memory 版本检查失败",
    configPreviewFailed: "Memory 配置目的地预览失败",
    configAuthorityFailed: "Memory 配置目的地授权失败",
    manualConfigAuthorityFailed: "Memory 手工配置目的地授权失败",
    configSubmitFailed: "Memory 运行时配置提交失败",
    destructiveAuthorityFailed: "Memory 破坏性操作授权失败",
    destructiveFailed: "Memory 破坏性操作失败",
  },
  common: { unread: "尚未读取", paused: "暂停", enabled: "开启" },
  time: { none: "尚无", now: "刚刚" },
  page: { ...memoryEn.page, pausedBanner: "长期记忆已暂停。当前 Chat、Tools、Apps 与 Skills 仍照常工作。" },
  sharing: {
    title: "共享范围", description: "决定新记忆能在哪些 Chat 中召回；切换范围绝不会自动复用旧范围数据。", disabledMemory: "请先启用长期记忆，再修改共享范围。", disabledTarget: "当前记忆目标不可用。", previewFailed: "Memory 共享范围预览失败",
    dialogTitle: "更改记忆共享范围？", oldScopeRetained: "旧范围数据会保留，但立即停止召回；系统不会自动合并它们。", historyPaused: "暂停期间可改范围，但要导入历史，请先恢复长期记忆。", confirm: "确认更改范围", readingScope: "正在读取目标范围…",
    mode: { chat: "仅当前 Chat", group: "Project / 独立 Chat 池", personal: "个人记忆池" },
    isolation: { chat: "新记忆仅供当前 Chat incarnation 召回。", group: "同一 Project 的 Chat 可互相召回；所有独立 Chat 共用一个单独池。", personal: "所有 Project 与独立 Chat 都可从同一个个人记忆池召回。" },
  },
  receipt: { ...memoryEn.receipt, used: "长期记忆 · 已随请求发送 {{count}} 条", usedDetail: "发送不代表模型一定采用", none: "长期记忆 · 未找到相关内容", unavailable: "长期记忆不可用 · 本轮未使用长期记忆", planMode: "长期记忆 · 本轮未使用（Plan 模式）", promptNotIssued: "长期记忆 · Agent 请求未成功发送", failure: { initialization: "记忆状态初始化失败", "scope-resolution": "无法解析本轮记忆范围", "policy-store": "记忆授权账本不可用", "runtime-configuration": "记忆运行时配置不可用", identity: "记忆服务身份校验失败", provider: "记忆服务调用失败", ownership: "记忆归属校验失败", deadline: "记忆召回超过时限", "render-budget": "记忆上下文超过渲染预算", "stale-capability": "记忆能力已失效" } },
  runtime: { running: "执行中…", openRunning: "打开 Memory 运行状态" },
};
