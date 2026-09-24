/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingZhCN, the Simplified Chinese Onboarding catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingZhCN: typeof onboardingEn = {
  rail: {
    steps: "设置步骤",
    intro: "只需三步。这里的所有设置之后都能在 Settings 中更改。",
    footer: "{{product}} 在本机运行。除非你主动要求，任何内容都不会离开这台电脑。",
    done: "已完成",
  },
  step: {
    "chat-home": { label: "数据位置", hint: "对话和文件存放的地方" },
    agent: { label: "Agent", hint: "至少安装一个才能开始对话" },
    extras: { label: "更多", hint: "Skills 与记忆，可选" },
  },
  heading: { "chat-home": "{{product}} 的文件放在哪里？", agent: "设置你的 Agent", extras: "发挥 {{product}} 的更多能力" },
  description: {
    "chat-home": "选择一个空文件夹重新开始，或选择已有的 {{product}} 文件夹接着上次继续。无论哪种，账号设置、密钥和设备授权都留在这台电脑上。",
    agent: "{{product}} 通过这台电脑上的编程 Agent 工作。至少安装一个即可继续——其余的随时可以从 Settings › Providers 添加。",
    extras: "全部可选。现在跳过的，之后都能在 Settings 中开启。",
  },
  back: "上一步", next: "继续", start: "开始使用",
  folder: "{{product}} 文件夹",
  chatHome: { unconfigured: "尚未选择", ready: "已就绪" },
  chatHomeUnset: "请选择这台电脑上的文件夹。", choose: "选择…", opening: "正在打开…",
  folderProgress: { opening: "正在打开文件… {{completed}} / {{total}}", saving: "正在保存文件… {{completed}} / {{total}}" },
  agentLater: "稍后再装",
  agentLaterFailed: "未能保存该选择，请重试。",
  agentInstalled: "已安装",
  agentChecking: "检测中…",
  agentInstalling: "等待安装完成…",
  agentCheckFailed: "暂时无法检测安装，请重试。",
  agentAbout: { codex: "OpenAI 的编程 Agent", claude: "Anthropic 的编程 Agent", kimi: "月之暗面的编程 Agent", opencode: "开源，可接入自己的模型" },
  extras: { skills: "Skills", memory: "长期记忆" },
  skillsAbout: "导入你的 Agent 已有的 Skills，让每个会话都能使用。",
  skillsFound: "发现 {{count}} 个", skillsImported: "已导入", skillsImport: "全部导入",
  skillsScanning: "正在查找已有 Skill…", skillsNone: "暂未发现可导入的 Skill", skillsDone: "你的个人 Skills Library 已就绪",
  skillsScanFailed: "暂时无法扫描 Skills，可重试或稍后在 Settings 中添加。",
  skillsImportTitle: "在你已有的 Agent 里发现 {{count}} 个 Skill",
  skillsImportDescription: "导入后即可在所有兼容会话中使用。",
  skillsImportAll: "全部导入并启用", skillsSkip: "跳过", skillsUpdateFailed: "更新 Skills 引导状态失败",
  memory: {
    badge: { start: "未设置", installing: "安装中", failed: "未完成", connect: "已安装", ready: "已就绪", on: "已开启" },
    about: "记住过往对话中重要的内容。会在这台电脑上运行一个小型服务。",
    installing: "正在安装 {{provider}}——会在后台继续，之后再完成设置也可以。",
    failed: "{{provider}} 未能安装完成。",
    connect: "{{provider}} {{version}} 已安装，连接模型即可开始记忆。",
    ready: "{{provider}} 已就绪，开启后开始召回与提取。",
    on: "可在 Settings › Memory 查看运行观测与缺口。",
    setUp: "设置…", retry: "重试…", connectAction: "连接…", progress: "查看进度", turnOn: "开启",
  },
};
