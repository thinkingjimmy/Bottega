/**
 * [INPUT]: Depends on the settingsExtensionsEn structural type
 * [OUTPUT]: Provides settingsExtensionsZhCN, the Simplified Chinese Settings › Extensions catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/settings/extensions; loaded on demand by the matching top-level locale
 */

import type { settingsExtensionsEn } from "./en";

export const settingsExtensionsZhCN: typeof settingsExtensionsEn = {
  page: {
    bridgeMissing: "当前环境不支持扩展管理（IPC 桥缺席）",
    admissionClosed: "有扩展正在收敛停用：撤投影绑定、释放共享产物、重启持旧发现快照的会话并使缓存失效。收敛完成前不会启动新的 Agent 会话。",
    installedTitle: "已安装扩展",
    installedDescription: "从 GitHub 安装扩展，Skills 会立刻对所有 Agent 生效。",
    installGithub: "从 GitHub 安装",
    emptyTitle: "还没有安装扩展", emptyHint: "从 GitHub 安装扩展即可开始使用。",
    retainedTitle: "已卸载但数据仍在", retainedDescription: "回收 package 代码从不顺手删除 install-owned 数据。彻底删除是独立、显式的动作；删掉之后，重新安装同一个仓库也拿不回它。", purgeData: "彻底删除数据", retainedCustody: "仍有未归零的 custody：{{custody}}", retainedEpochs: "{{count}} 个 data epoch 仍保留在本机。",
  },
  install: {
    stage: { source: { title: "添加扩展", description: "粘贴 GitHub 仓库主页地址。系统会冻结 commit：根目录存在 plugin.json 时按 Agent Plugins 1.0 包准入，否则导入纯 skills/<名字>/SKILL.md 仓库。确认后 Skills 立即启用。", commit: "继续", pending: "正在解析来源…" }, install: { title: "安装前确认", commit: "确认安装", pending: "正在安装…" }, update: { title: "更新前确认", commit: "确认更新", pending: "正在更新…" } },
    resolveFailed: "解析来源失败", installFailed: "安装失败", summary: "{{url}} @ {{commit}}（{{files}} 个文件 / {{kilobytes}} KB）", repository: "仓库地址", repositoryHint: "解析为不可变 commit 后再展示能力，确认前不写入 registry。已装过的同一仓库会解析成这个安装的新一代。", back: "返回",
    disclosure: {
      format: "判定形态", pluginFormat: "Agent Plugins 1.0 包（根目录含 plugin.json）。", skillFormat: "纯 Skill 仓库（无 plugin.json；仅导入 skills/ 子树）。", scripts: "可执行脚本", none: "无", skill: "Skill {{name}}", allowedTools: "allowed-tools：{{tools}}", undeclared: "未声明", mcp: "MCP {{serverId}}（{{transport}}）", mcpUnavailable: "MCP 组件交付将按独立方案分档开放，当前尚不可用。{{target}}", staticHeaders: "；静态 header：{{headers}}", writeRoot: "持久数据写根", writeRootRequired: "含 stdio server，需要 install-owned 写根；新一代使用独立 data epoch，不与旧代共写。", writeRootNone: "不需要", capabilityChange: "相对上一代的能力变化", addedRemoved: "新增：{{added}}｜移除：{{removed}}", noChange: "无变化", report: "解析提示", postUpdate: "更新后状态", postInstall: "安装后状态", reauthorize: "能力已扩大：新一代默认停用，每个 component 都要重新启用。旧一代保持不可变，仍服务已绑定它的 App。", retainAuthorization: "能力未扩大：沿用当前的逐项启用状态。旧一代保持不可变，仍服务已绑定它的 App。", defaultEnabled: "确认后 Skills 立即启用。", migrateAria: "迁移 {{appId}} 到新一代", migrateDescription: "当前绑定 {{generation}}。迁移会创建新的待授权 generation；不迁移则继续使用旧一代。", migrateLabel: "迁移 App {{appId}}",
    },
  },
  package: {
    enabledCount: "已启用 {{enabled}}/{{total}} 个 Skills", mcpUnavailable: "MCP 组件尚不可交付", manageSkills: "管理 Skills",
    description: "{{admission}} · {{administration}} · 目录{{catalog}} · App 授权独立 · commit {{commit}}", admission: { valid: "已准入", misconfigured: "配置有误" }, administration: { active: "管理状态正常", "disable-pending": "管理停用收敛中", denied: "管理状态已否决" }, catalog: { on: "已开", off: "已关" }, checkUpdate: "检查更新", disable: "停用", cancelUninstall: "放弃卸载", uninstall: "卸载", eligibilityEntry: "{{backend}}：{{status}}", componentDescription: "{{kind}} · {{transport}}", kind: { skill: "Skill", "mcp-server": "MCP server" }, generation: "上一代 {{generation}}", generationBlocked: "仍被 {{count}} 个持有者精确绑定，保持不可变、可寻址。", generationFree: "无人引用，可由独立卸载动作回收。", done: "已完成", pending: "待收敛", convergenceBlocked: "收敛受阻", foreignCopy: "外部副本 {{projectionId}}", foreignCopyDetail: "{{componentInstanceIdentity}} 不是产品写入的副本，只能标 {{strength}} 并由你手动处置；产品不会替它声称已撤销。", uninstallBlocked: "卸载受阻", otherOwners: "其它持有者", runtimeReferences: "运行期引用", runtimeReferencesDetail: "未归还的 projection lease {{leases}} 个；仍被引用的共享产物 {{artifacts}} 份（不回收）。", custody: "进程 / transport custody", migrate: "迁移到新一代", migrateDescription: "仍精确绑定 {{generation}}。迁移会在“该引用已关闭”的快照上重新冻结：required 变 blocked、optional 变 degraded，并需要重新授权。不迁移就放弃卸载，这个包保持已停用但仍安装。", retryUninstall: "重试卸载",
    convergenceStep: { "projection-binding-revoked": "撤销产品管理的投影绑定", "shared-artifacts-released": "按 refcount 释放共享产物", "product-sessions-drained": "重启持旧发现快照的产品会话", "discovery-cache-invalidated": "使发现缓存失效" },
    uninstallStep: { "durable-references-resolved": "解决 durable 引用（reservation / App 代 / 其它持有者）", "runtime-custody-drained": "等 plan lease、投影 lease 与进程 custody 归零", "package-generations-removed": "回收全部 package generation", "package-bytes-collected": "回收无人引用的包字节（不含 install-owned 数据）" },
    strength: { "per-tool-enforced": "逐工具强制", "per-turn-enforced": "逐轮强制", "server-inclusion-only": "整台 server 注入", "workspace-requested": "请求 workspace", "backend-delegated": "由 backend 代理", "unsupported-by-policy": "策略不支持", unknown: "未知" },
    exclusion: { "package-disabled": "package 已停用", "package-disable-pending": "package 正在停用", "package-generation-removal-pending": "generation 正在回收", "component-disabled": "component 未启用", "backend-capability-mismatch": "backend 能力不匹配", "delivery-channel-unsupported": "交付通道不支持", "transport-unsupported": "transport 不支持", "projection-unavailable": "投影不可用", "runtime-health-failed": "runtime 健康检查失败", "turn-policy-ineligible": "本轮策略不允许", "snapshot-materialization-failed": "快照物化失败" },
  },
};
