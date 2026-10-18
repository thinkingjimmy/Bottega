/**
 * [INPUT]: No runtime dependencies; translated Dock plugin copy.
 * [OUTPUT]: Provides dock catalog strings for zh-cn.
 * [POS]: Nested workbench plugin catalog, consumed by Dock cards, settings and health.
 */
export const dock = {
  "name": "Bottega Dock",
  "summary": "应用快捷入口与用量小组件。可保留系统 Dock，也可在确认后替代它。",
  "description": "Bottega Dock 将应用、系统快捷入口和用量小组件放在屏幕边缘。\n\nDock 目前处于 Alpha 阶段，默认关闭。你可以选择布局和模式。替代模式需要通过签名验证的安装包及你的确认。退出 Bottega 或关闭 Dock 时，会恢复系统 Dock。",
  "systemRequirement": "macOS {{version}} · Apple 芯片",
  "replacementAvailable": "确认后可启用",
  "replacementChecking": "正在检查安装包…",
  "replacementDevelopment": "开发版仅支持共存模式",
  "replacementUnverified": "无法验证安装包签名。请安装已签名的 Bottega。",
  "replacementHelperMissing": "缺少恢复辅助程序。请重新安装 Bottega。",
  "running": "Dock 正在运行",
  "off": "已关闭",
  "loading": "正在检查 Dock…",
  "unsupported": "此电脑不支持",
  "recoveryPending": "恢复尚未完成，请在 Dock 设置中重试恢复。",
  "coexist": "与系统 Dock 共存",
  "replace": "替代系统 Dock",
  "autohide": "自动隐藏",
  "pinned": "常驻显示",
  "settings": {
    "showHandle": "显示把手",
    "privacyMask": "隐藏敏感数值",
    "showRunning": "显示运行中的应用",
    "scale": "大小",
    "visibility": "显示方式"
  },
  "labels": {
    "mode": "运行模式",
    "phase": "运行阶段",
    "registration": "恢复代理注册",
    "accessibility": "辅助功能权限",
    "automation": "Finder 自动化权限",
    "recovery": "最近恢复结果",
    "sync": "布局同步",
    "replacement": "替代模式"
  },
  "phase": {
    "inactive": "未运行",
    "preparing": "准备中",
    "active": "运行中",
    "restoring": "恢复中",
    "suspended": "已暂停"
  },
  "registration": {
    "notRegistered": "未注册",
    "enabled": "已注册",
    "requiresApproval": "等待批准",
    "notFound": "恢复服务缺失",
    "unsupported": "此构建不提供",
    "unknown": "无法确认注册状态"
  },
  "permission": {
    "granted": "已允许",
    "notGranted": "未允许",
    "unsupported": "未检查",
    "unknown": "未检查",
    "needsPrompt": "使用时请求",
    "denied": "已拒绝",
    "unavailable": "不可用"
  },
  "recovery": {
    "none": "暂无恢复记录",
    "restored": "已恢复",
    "keptExternal": "保留了你的系统修改",
    "failed": "无法确认恢复完成"
  },
  "sync": {
    "localOnly": "仅保存在本机",
    "synced": "已同步；Dock 关闭后继续同步",
    "pending": "有更改等待同步",
    "offline": "离线；布局保留在本机",
    "conflict": "布局变更需要确认",
    "blocked": "同步暂不可用",
    "error": "同步失败；布局已保留"
  },
  "unsupportedReason": {
    "platform": "需要 macOS 27",
    "architecture": "需要 Apple 芯片",
    "osVersion": "需要 macOS 27",
    "helperMissing": "Dock 辅助程序缺失，请重新安装 Bottega。"
  },
  "effects": {
    "restore": "关闭前先恢复系统 Dock。",
    "unregister": "确认恢复完成后，注销恢复代理。",
    "hide": "Dock 栏、菜单与小组件将消失；布局保留，同步可用时继续同步。"
  },
  "capabilities": {
    "launch": "打开这台 Mac 上的应用与系统入口",
    "usage": "读取已有的本机用量与额度数据",
    "sync": "Dock 关闭后仍保留布局同步",
    "permissions": "辅助功能与 Finder 自动化权限按需由你授权"
  }
};
