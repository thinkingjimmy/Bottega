/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingZhCN, the Simplified Chinese Onboarding catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingZhCN: typeof onboardingEn = {
  mode: {"local": {"title": "在这台电脑上使用", "description": "所有内容留在这台电脑。以后可以在设置里登录并同步。"}, "account": {"title": "连接已有账号", "description": "登录后，这台电脑会加入你的加密同步空间，内容在设备之间同步。"}},
  accountUnavailable: "暂时无法连接账号。",
  agentPlace: {"local": "在这台电脑安装", "remote": "使用另一台电脑"},
  remoteEmpty: "先在另一台电脑登录并安装 Agent。",
  folderProgress: {"opening": "正在打开文件… {{completed}} / {{total}}", "saving": "正在保存文件… {{completed}} / {{total}}"} ,
  agentInstalled: "已安装",
  agentChecking: "检测中…",
  agentInstalling: "等待安装完成…",
  agentCheckFailed: "暂时无法检测安装，请重试。",
  step: { mode: "使用方式", account: "连接账号", "chat-home": "数据位置", agent: "Agent", extras: "更多能力" },
  heading: { mode: "如何使用 {{product}}？", "chat-home": "{{product}} 的文件放在哪里？", agent: "设置你的 Agent", extras: "发挥 {{product}} 的更多能力" },
  back: "上一步", next: "继续", start: "开始使用",
  description: { mode: "选择你的使用方式。", "chat-home": "选择已有的 Bottega 文件夹可恢复其中的内容，也可以选择空文件夹开始。账号设置、密钥和设备授权留在这台电脑上。", agent: "安装至少一个 Agent 即可继续。", extras: "导入可复用的 Skills，并设置长期记忆。两项均为可选，之后可随时在 Settings 中更改。" },
  extras: { skills: "Skills", memory: "长期记忆" },
  skillsScanFailed: "暂时无法扫描 Skills，可重试或稍后在 Settings 中添加。",
  skillsImportTitle: "在你已有的 Agent 里发现 {{count}} 个 Skill",
  skillsImportDescription: "导入后即可在所有兼容会话中使用。",
  skillsScanning: "正在查找已有 Skill…", skillsFound: "在你已有的 Agent 里发现 {{count}} 个 Skill · 导入后即可在所有兼容会话中使用", skillsNone: "暂未发现可导入的 Skill", skillsDone: "你的个人 Skills Library 已就绪", skillsImportAll: "全部导入并启用", skillsSkip: "跳过", skillsUpdateFailed: "更新 Skills 引导状态失败",
  chatHome: { unconfigured: "请选择这台电脑上的文件夹。", ready: "Bottega 文件夹已就绪。" },
  chatHomeUnset: "尚未选择", choose: "选择目录…", opening: "正在打开…",
  memoryEnabled: "可在 Settings › Memory 查看运行观测与缺口。", memoryDisabled: "需要先安装本机记忆服务并完成一次隐私披露确认，之后才会开始召回与提取。",
  memoryAction: "去设置记忆",
  memoryInstalling: "正在安装 {{provider}}……会在后台继续，现在就可以开始使用。", memoryInstallFailed: "{{provider}} 未能安装完成。",
  memoryConnect: "{{provider}} {{version}} 已安装，连接模型即可完成。", memoryReady: "{{provider}} 已就绪，开启后开始召回与提取。",
  memoryProgress: "查看进度", memoryTurnOn: "开启", memoryHide: "收起",
};
