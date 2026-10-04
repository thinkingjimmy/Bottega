/**
 * [INPUT]: Depends on the settingsSkillsEn structural type
 * [OUTPUT]: Provides settingsSkillsZhCN, the Simplified Chinese Settings › Skills catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/settings/skills; loaded on demand by the matching top-level locale
 */

import type { settingsSkillsEn } from "./en";

export const settingsSkillsZhCN: typeof settingsSkillsEn = {
  tabs: { skills: "Skills", extensions: "扩展" }, refresh: "刷新 Skills", importTitle: "添加 Skills",
  description: "只需导入个人 Library 一次，即可在所有兼容会话中使用已启用的 Skill。",
  back: "返回", localFolder: "本地文件夹", chooseFolder: "选择文件夹…", importPrimary: "全部导入", importSelected: "导入并启用 {{count}} 个",
  backend: { codex: "Codex", claude: "Claude", kimi: "Kimi", opencode: "OpenCode" },
  sourceKind: { "local-folder": "本地", adopted: "已导入", extension: "扩展" },
  selectSkill: "选择 {{name}}", enable: "启用", disable: "停用", delete: "删除", gotoPackage: "查看扩展",
  batch: { selected: "已选择 {{count}} 个", done: "完成" },
  emptyTitle: "个人 Library 中还没有 Skill", emptyScanning: "正在你的 Agent 中查找 Skill…",
  emptyLead: "在你已有的 Agent 里发现 {{count}} 个 Skill。导入一次，即可在所有兼容会话中使用。",
  emptyNothingHint: "没有发现可导入的 Skill。你可以安装一个扩展，或选择本地文件夹。",
  readOnly: "Skill 管理当前为只读",
  budget: "已启用 {{count}} 个 · 会话清单约 {{size}}（按库启用集估算）",
  search: "搜索 Skills", noMatches: "没有匹配的 Skill。",
  confirmDeleteTitle: "删除 Skills？", confirmDeleteBody: "将从个人 Library 永久删除 {{count}} 个 Skill。", confirmDeleteAction: "删除",
  footerImport: "导入你已有的 Skill →", footerManage: "管理 Skills",
  contentState: { downloading: "正在下载…", missing: "本机没有内容" },
  noticeSlugConflict: "已在另一台设备上改名",
  error: { failed: "Skill 操作失败，请重试。" },
  reason: {
    "missing-skill-md": "缺少 SKILL.md", "invalid-frontmatter": "SKILL.md 元数据无效", "invalid-name": "Skill 名称无效",
    "skill-md-too-large": "SKILL.md 过大", "too-many-directories": "嵌套目录过多", "too-many-candidates": "候选过多",
    symlink: "不接受符号链接", "unsafe-path": "路径越出了 Skill 文件夹", "not-a-directory": "这不是文件夹",
    unreadable: "无法读取文件夹", missing: "文件夹不存在", changed: "读取期间文件夹发生变化", timeout: "发现超时",
    "source-gone": "来源不可用", "postcondition-changed": "操作期间状态发生变化", "acquisition-failed": "导入失败",
    "ref-invalid": "Skill 引用无效", unknown: "无法校验当前状态",
  },
};
