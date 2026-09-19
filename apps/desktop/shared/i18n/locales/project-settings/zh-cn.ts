/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides projectSettingsZhCN, the Simplified Chinese Project Settings catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/project-settings; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/zh-cn";


export const projectSettingsZhCN = {
  entry: workspaceCopy.project.settings, open: "打开 Project 设置", title: workspaceCopy.project.settingsTitle,
  tabs: { general: "通用", personalization: "个性化", skills: "Skills", extensions: "扩展", tools: "工具" },
  general: {
    sectionBasics: workspaceCopy.project.basics, name: workspaceCopy.project.identity, renameAction: "重命名", appearanceAria: workspaceCopy.project.appearanceLabel,
    memory: "记忆", memoryDisabled: "记忆服务未启用", memoryPaused: "记忆已暂停", memoryUnavailable: "服务不可用", memoryScoped: "本 Project 拥有独立记忆域", memoryShared: "记忆按会话或个人域共享，Project 不单独分域", memoryDelivering: "导入记忆交付中…", memoryManage: "管理记忆",
    history: "History 导入", historyHint: "为本 Project 导入兼容的外部 Agent 历史。",
    appsSection: "App", appsDescription: "添加进来的 App 可以在这个 Project 的对话里使用。Pin 只把它放进 Sidebar，不改变它能看到的数据。", appsManagedByApp: "此 App Project 的能力授权在 App 页面管理。",
    placements: { pinControl: "将 {{name}} Pin 到 Sidebar", grantSummary: "{{grant}} · {{agent}}", unavailableBadge: "暂不可用", agentOn: "Agent 可代你操作", agentOff: "只有你能操作", noGrant: "还没有授权", unavailable: "这个版本还不能运行，去 Apps 页面修好后才能 Pin", empty: "这个 Project 还没有 App", emptyHint: "添加后，它会出现在这个 Project 的对话里。你来决定它能看到哪些数据。", loading: "正在加载 Apps…", failed: "Apps 加载失败。", retry: "重试", pending: "正在保存 Pin…", pinFailed: "无法保存这个 App 的 Pin。" },
    baseSection: workspaceCopy.project.baseTitle, baseEmpty: workspaceCopy.project.baseEmpty, baseCreate: workspaceCopy.project.baseCreate, baseOpen: workspaceCopy.project.baseOpen, baseSummary: workspaceCopy.project.baseSummary, baseLoading: "正在加载 Project Base",
    danger: workspaceCopy.project.danger, archiveHint: workspaceCopy.project.archiveHint, detachHint: "移除本机 Project 记录，不删除外部目录。", appLifecycleHint: "App Project 的生命周期随 App；请在 Apps 页删除该 App。"
  },
  instructions: {
    section: "Project 指令", description: "编辑各 Agent 在此 Project 工作目录读取的指令文件。", pointerHint: "此文件指向 AGENTS.md，通常无需直接编辑。", noWorkspace: "请先在侧栏 Project 行菜单中选择工作目录。", bridgeMissing: "当前环境无法使用 Project 个性化桥。", appReadOnly: "App Project 指令由 App generation 管理，因此只读。", appEditGuide: "请打开 App 页面，在 App Edit 会话中继续。", workspaceChanged: "Project 工作目录已更换。磁盘基线已刷新，你的草稿仍保留。", loading: "正在加载 Project 指令", saveFailed: "Project 指令保存失败", outsideWorkspace: "此指令文件的真身位于 Project 工作目录之外，无法读取或修改。", appManaged: "App Project 指令由 App generation 管理。"
  },
  skills: {
    section: "Project 可调用 Skills", scopeNote: "Project Skills 随工作目录走；继承的全局库请在设置 › Skills 管理。", runtimeNote: "本清单仅表示产品内可通过 `$` 调用的 Skills；各 Agent 终端的原生发现口径可能不同。", inheritedGroup: "继承的全局 Skills（{{count}}）", empty: "没有可调用的 Project Skill", emptyHint: "把技能放进 {{dir}}/.agents/skills/<名称>/SKILL.md，然后点击刷新。",   noWorkspace: "尚未选择 Project 工作目录", noWorkspaceHint: "选择工作目录后可添加 Project Skills；全局与扩展 Skills 仍显示在下方。", loadFailed: "Project Skills 加载失败。", badge: { repo: "Project", user: "用户", system: "系统", admin: "管理员", extension: "扩展" }
  },
  extensions: { scopeNote: "把扩展装到本 Project 后，它的 Skills 只对本 Project 会话生效，不影响其它 Project。" },
  tools: {
    scopeNote: "此处改动仅影响“{{name}}”；未覆盖的项目继续继承全局默认值。",
    bridgeMissing: "当前环境无法使用 Project 工具设置。",
  }
};
