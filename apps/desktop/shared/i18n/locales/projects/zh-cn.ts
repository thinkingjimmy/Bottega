/**
 * [INPUT]: Depends on the projectsEn structural type
 * [OUTPUT]: Provides projectsZhCN, the Simplified Chinese Sidebar Projects catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/projects; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/zh-cn";


import type { projectsEn } from "./en";

export const projectsZhCN: typeof projectsEn = {
  provider: {
    loadFailed: "Projects 加载失败：{{message}}",
    addFailed: "Project 添加失败：{{message}}",
    appProjectFailed: "App Project 建立失败：{{message}}",
    renameFailed: "Project 重命名失败：{{message}}",
    appearanceFailed: "Project 外观保存失败：{{message}}",
    revealFailed: "无法在系统文件管理器中显示 Project：{{message}}",
    sortFailed: "Project 排序保存失败：{{message}}",
    coordinatorUnavailable: "Project 导入协调器尚未挂载。",
  },
  sortAria: workspaceCopy.project.sortLabel,
  sortLastUpdated: workspaceCopy.project.recent,
  sortManual: workspaceCopy.project.manual,
  add: "添加 Project",
  empty: "点击 + 添加文件夹",
  showMore: "显示更多",
  moreActions: workspaceCopy.project.more,
  newChatIn: "在 {{name}} 中新建任务",
  missingRecord: "Project 记录已丢失",
  missingName: "已丢失的 Project",
  missingFolder: "Project 文件夹已丢失：{{dir}}",
  editBadge: "编辑",
  baseTag: "Base",
  rename: workspaceCopy.project.rename,
  renameTitle: workspaceCopy.project.renameTitle,
  renameDescription: workspaceCopy.project.renameDescription,
  moveChatsToRoot: "把聊天移回根级",
  rescue: {
    title: "将聊天移出这个 Project？",
    description: "这个 Project 的本机记录已丢失。确认后的聊天会以普通聊天移回根级，下次继续时将开启新的 Agent 会话。",
    retry: "检查恢复进度",
    pending: "正在等待云端确认，原聊天仍然保留。",
    conflicted: "云端版本已变化。选择保留原聊天，即可放弃本次恢复。",
    confirmed: "云端已确认，正在完成本机移动。",
    keepOriginal: "保留原聊天",
    failed: "移动尚未完成，请检查状态后重试。",
    more: "还有更多聊天待处理，处理这一组后可查看下一组。",
    untitled: "未命名聊天",
  },
  unbound: {
    badge: "待选择文件夹",
    tooltip: "这台电脑上还没有这个 Project 的文件夹。选择一个后即可在其中工作。",
    chooseFolder: "选择文件夹…",
    chooseFailed: "Project 文件夹设置失败：{{message}}",
    turnRefused:
      "这台电脑上还没有这个 Project 的文件夹。请先在 Project 菜单中选择一个，再开始任务。",
  },
  removeLocal: "移除本地 Project",
  removeLocalTitle: "移除 {{name}}？",
  removeLocalDescription:
    "这只会从应用中移除本地 Project。电脑上的文件和现有聊天不会被删除。",
  archiveInsteadTitle: "改为归档 {{name}}？",
  archiveInsteadBase:
    "此 Project 拥有 Project Base，无法安全移除。改为归档可完整保留 Project、Base、文件和聊天。",
  archiveInsteadMemory:
    "共享的 group Memory 归属于此 Project，无法安全移除。改为归档可完整保留 Project、Memory、文件和聊天。",
  archiveInsteadManaged:
    "此 Project 仍拥有 managed worktree 聊天，无法安全解绑工作目录。请改为归档，或先永久删除这些 managed 聊天。",
  archiveInsteadBoth:
    "此 Project 拥有 Project Base 和共享的 group Memory，无法安全移除。改为归档可完整保留全部数据。",
  archiveInsteadConfirm: "归档 Project",
  archive: workspaceCopy.project.archive,
  hideAppProject: "从 Projects 隐藏",
  archiveTitle: workspaceCopy.project.archiveTitle,
  archiveDescription:
    "「{{name}}」及其 {{chats}} 个聊天将从侧栏撤下。可在 Settings › Archive 恢复或永久删除；外部/App 工作目录永不删除。",
  archiveRootBases: "一并归档的根级 Base：{{bases}} 个。",
  appearance: workspaceCopy.project.appearance,
};
