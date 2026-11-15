/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingZhCN, the Simplified Chinese two-step Onboarding and Chat Skills prompt catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingZhCN: typeof onboardingEn = {
  heading: { "chat-home": "{{product}} 的文件放在哪里？", agent: "设置你的 Agent" },
  description: {
    "chat-home": "对话、文件和 Skills 都放在一个属于你的文件夹里。无论放在哪里，账号设置、密钥和设备授权都留在这台电脑上。",
    agent: "{{product}} 通过这台电脑上的编程 Agent 工作。至少安装一个即可继续——其余的随时可以从 Settings › Providers 添加。",
  },
  next: "继续", start: "开始使用",
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
  preview: {
    project: "Bottega Site",
    chats: { releaseNotes: "发布 Release Notes", settingsPanel: "迁移设置面板", changelog: "起草更新日志", importTests: "覆盖 CLI 导入路径", onboarding: "精简 Onboarding 文案", iconGrid: "比较两套图标网格", acp: "解释 ACP 握手" },
    priorAsk: "0.1.9 之后合并的 PR 里，用户真正会注意到的有哪些？",
    priorReply: "十八个里有六个。Agent 一致性是大家最先感受到的；两处内部重构合成一句。",
    ask: "根据 0.1.9 之后合并的 PR 起草 0.2.0 Release Notes。",
    workedFor: "工作了 {{duration}}",
    planTitle: "0.2.0 Release Notes", summary: "摘要", summaryFirst: "自 `0.1.9` 以来有六项主要变化，按用户最先感知的部分分组。", summarySecond: "Agent 能力对齐是头条——`Kimi` 与 `OpenCode` 现在拥有和 `Codex` 相同的权限阶梯。",
    plan: "Plan", model: "GPT-5.6 Sol",
    status: "正在回复", askAnything: "问任何问题",
  },
  skillsImportTitle: "在你已有的 Agent 里发现 {{count}} 个 Skill",
  skillsImportDescription: "导入后即可在所有兼容会话中使用。",
  skillsImportAll: "全部导入并启用", skillsSkip: "跳过", skillsUpdateFailed: "更新 Skills 引导状态失败",
};
