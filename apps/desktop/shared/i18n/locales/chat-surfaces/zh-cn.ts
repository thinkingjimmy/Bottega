/**
 * [INPUT]: Depends on the chatSurfacesEn structural type
 * [OUTPUT]: Provides the Simplified Chinese Chat surfaces catalog with the exact English structure
 * [POS]: Simplified Chinese Chat surfaces locale leaf assembled into the existing chat namespace
 */

import { chatSurfacesEn } from "./en";

export const chatSurfacesZhCN: typeof chatSurfacesEn = {
  sidePanel: {
    shell: {
      loadingBase: "正在加载 Base",
      closePreview: "关闭预览",
      readingFile: "正在读取文件…",
      bytes: "{{count}} 字节",
      resize: "调整第三栏宽度",
      resizeHint: "拖动或使用方向键调整第三栏宽度",
    },
    appGrant: {
      badgeAria: "{{name}} 的权限 —— 数据：{{data}}；代你操作：{{delegation}}",
      on: "开",
      off: "关",
      omittedIntro: "上一轮 Agent 没看到这个 App —— {{reason}}",
      omission: {
        referenceLimit: "这个 Chat 附加的 App 太多了，减掉几个再试。",
        instructionBudget: "附加的 App 说明超出 2 KB 预算，减掉几个再试。",
        backendUnsupported:
          "当前后端没有工具通道，「代你操作」用不了；文件只读仍然有效。",
        baseToolsDisabled: "Base 的读写工具都关着，去 Settings › Tools 打开。",
      },
      degradation: {
        baseReadsDisabled: "这一轮它只能改数据行，读不了表：Base 读取被关掉了。",
        baseRowMutationsDisabled:
          "这一轮它只能读表，改不了数据行：Base 行修改被关掉了。",
      },
      excludedIntro: "上一轮有扩展没交付，这个 App 跑不全：{{items}}",
      excludedItem: "{{name}}（{{code}}）",
      excludedRequiredItem: "{{name}}（{{code}}，必需）",

      extensionDetails: "扩展与交付详情",
      requirementSummary:
        "要求：{{requirement}}；已安装：{{installed}}；准入：{{admission}}；代际：{{generation}}；启用：{{enabled}}；已授权给 App：{{granted}}",
      required: "必需",
      optional: "可选",
      yes: "是",
      no: "否",
      none: "无",
      unknown: "未知",
      unresolved: "未解析",
      configOverrideDiff: "配置覆盖差异：{{value}}",
      eligible: "可用性：{{value}}",
      deliverySummary: "交付健康度：{{delivery}}；本轮活跃：{{active}}",
    },
    appTab: {
      readFailed: "App 状态读取失败",
      surfaceFailed: "App surface 签发失败",
      unavailable:
        "App 已失效或正在删除；slot 已保留，但不会签发 runtime 或 data 能力。",
      stop: "停止 App",
      startFailed: "启动 App 失败",
      open: "打开 App",
      notAuthorized: "此 App 在当前 Chat 未授权，因此读不到数据，也开不出界面。",
      authorize: "在此 Chat 中授权",
    },
    image: {
      fallbackTitle: "图片",
      preview: "图片预览",
      previewNamed: "图片预览：{{name}}",
      zoom: "缩放",
      restoring: "正在恢复图片",
      reading: "正在读取图片",
      unavailable: "图片已不在当前对话中，或暂时无法读取。",
      retry: "重试",
    },
  },
  transcript: {
    image: {
      unavailable: "无法预览图片",
      reading: "正在读取图片",
      generatedAlt: "生成的图片",
      openInSidePanel: "在第三栏打开图片：{{title}}",
      fallbackTitle: "图片",
    },
    actions: {
      copy: "复制",
      copied: "已复制",
    },
    outlineLabel: "会话大纲",
    plan: {
      editingAria: "正在编辑 Plan",
      editing: "编辑中",
      title: "Plan",
      copy: "复制 Plan",
      copied: "已复制",
      collapsePanel: "收起 Plan 第三栏",
      showPanel: "在第三栏显示 Plan",
      showFullPanel: "在第三栏显示完整 Plan",
    },
    loadEarlier: "显示更早消息",
    loadingEarlier: "正在加载更早消息…",
    fatalResultTitle: "本轮结果未能安全写入",
    fatalResultLocked: "输入保持锁定，直到你放弃这轮结果。",
    abandonFatal: "放弃本轮结果",
    cleanupFailedTitle: "进程清理未完成",
    cleanupFailed:
      "{{backend}} 进程组清理失败。请先确认相关进程已经结束，再解除本 Chat 的安全锁。",
    acknowledgeCleanup: "已确认进程结束",
    loadedEarlier: "已加载 {{count}} 条更早消息",
    subagentDetailsCleared: "该 Subagent 的详情已被清理",
    subagentDetailsLimited: "实时详情已达上限",
    showLess: "收起",
    showMore: "显示更多",
    openAttachmentInSidePanel: "在第三栏打开图片：{{title}}",
    workingFor: "已处理 {{duration}}",
  },
  usageLimit: {
    unavailable: "{{backend}} 暂时不可用",
    resetTime: "恢复时间",
    usageWindow: "额度周期",
    window: {
      fiveHour: "5 小时窗口",
      weekly: "每周窗口",
    },
    retry: "立即重试",
    resetAt: "{{date}}（{{zone}}）",
    aboutMinutes: "约 {{minutes}} 分钟",
    aboutHours: "约 {{hours}} 小时",
    aboutHoursMinutes: "约 {{hours}} 小时 {{minutes}} 分钟",
  },
};
