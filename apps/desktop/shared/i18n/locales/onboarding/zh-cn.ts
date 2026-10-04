/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Includes Memory plugin enable, paused/resume and unsupported states; Provides onboardingZhCN, the Simplified Chinese Onboarding catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingZhCN: typeof onboardingEn = {
  optional: "可选",
  heading: { "chat-home": "{{product}} 的文件放在哪里？", agent: "设置你的 Agent", extras: "发挥 {{product}} 的更多能力" },
  description: {
    "chat-home": "对话、文件和 Skills 都放在一个属于你的文件夹里。无论放在哪里，账号设置、密钥和设备授权都留在这台电脑上。",
    agent: "{{product}} 通过这台电脑上的编程 Agent 工作。至少安装一个即可继续——其余的随时可以从 Settings › Providers 添加。",
    extras: "全部可选。现在跳过的，之后都能在 Settings 中开启。",
  },
  back: "上一步", next: "继续", start: "开始使用",
  folder: {
    aria: "文件存放位置",
    fresh: "全新开始", recommended: "推荐", freshDetail: "为你创建 {{path}}。",
    found: "接着上次继续", foundBadge: "已找到", foundDetail: "{{path}} 里已有你的 {{product}} 对话和文件。",
    choose: "选择文件夹…", chooseDetail: "新的或已有的都可以，{{product}} 会自动识别。",
  },
  opening: "正在打开…",
  folderProgress: { opening: "正在打开文件… {{completed}} / {{total}}", saving: "正在保存文件… {{completed}} / {{total}}" },
  agentLater: "稍后再装",
  agentLaterFailed: "未能保存该选择，请重试。",
  agentInstalled: "已安装",
  agentChecking: "检测中…",
  agentInstalling: "等待安装完成…",
  agentCheckFailed: "暂时无法检测安装，请重试。",
  agentAbout: { codex: "OpenAI 的编程 Agent", claude: "Anthropic 的编程 Agent", kimi: "月之暗面的编程 Agent", opencode: "开源，可接入自己的模型" },
  extras: { skills: "Skills", memory: "Memory 插件" },
  skillsAbout: "导入你的 Agent 已有的 Skills，让每个会话都能使用。",
  skillsFound: "发现 {{count}} 个", skillsImported: "已导入", skillsImport: "全部导入",
  skillsScanning: "正在查找已有 Skill…", skillsNone: "暂未发现可导入的 Skill", skillsDone: "你的个人 Skills Library 已就绪",
  skillsScanFailed: "暂时无法扫描 Skills，可重试或稍后在 Settings 中添加。",
  skillsImportTitle: "在你已有的 Agent 里发现 {{count}} 个 Skill",
  skillsImportDescription: "导入后即可在所有兼容会话中使用。",
  skillsImportAll: "全部导入并启用", skillsSkip: "跳过", skillsUpdateFailed: "更新 Skills 引导状态失败",
  memory: {
    badge: { start: "未设置", installing: "安装中", failed: "未完成", connect: "已安装", ready: "已就绪", on: "已开启", paused: "已暂停", unsupported: "暂不支持" },
    about: "记住过往对话中重要的内容。会在这台电脑上运行一个小型服务。",
    installing: "正在安装 {{provider}}——会在后台继续，之后再完成设置也可以。",
    failed: "{{provider}} 未能安装完成。",
    connect: "{{provider}} {{version}} 已安装，连接模型即可开始记忆。",
    ready: "{{provider}} 已就绪，开启后开始召回与提取。",
    on: "可在 Memory 插件设置中查看运行观测与缺口。",
    paused: "Memory 已暂停，已保存的记忆保留。", resume: "恢复",
    setUp: "设置…", retry: "重试…", connectAction: "连接…", progress: "查看进度", turnOn: "启用 Memory 插件",
  },
};
