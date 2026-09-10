# Bottega 功能

[文档首页](../README.zh-CN.md) · [English](./README.md)

Bottega 把 Agent 对话视为一个可持续、本地工作空间的控制面。产品由以下核心能力域构成。

## Multi-agent

- 通过统一、后端无关的 ACP transport 连接 Codex、Claude Code、Kimi Code 与 OpenCode。
- 聊天空闲时可为下一轮切换 Agent，保留同一转录、每条回复的作者及有界历史接续；各家官方 CLI 继续管理自己的登录、用量与配额。
- 输入框展示运行时与认证可用性，并提供有作用域的安装、登录和重试入口。
- 在设置页和 Agent 选择器查看 Codex、Claude Code、Kimi 可获得的配额窗口、剩余额度及重置时间；OpenCode 明确提示不提供统一额度信息。
- 提供 Plan、运行中 Steer、消息队列与可见的工具过程，同时不掩盖不同后端的能力差异。
- 创建 Section 与 Subagent 并行工作，查看进度，在明确预算内交接上下文，并把有价值的结果提升为持久 Section。
- 搜索和接续受支持的本机 CLI 历史，不静默改写原始记录。

## 草图

- 通过输入框 **+ → 草图** 绘画、添加文字或八种图形，并局部擦除笔迹或图形。
- 自适应方形画布提供浮动工具、撤销/重做、颜色与粗细控制。
- 从草稿或还原队列中重新打开草图继续编辑，发送时通过普通图片附件流程交付白底 PNG。

## Base

- 让 Chat 或 Project 在对话旁拥有结构化、以 row 为事实源的数据空间。
- 同一份数据支持 Table、List、Kanban、Map、Chart 与 Gallery 六种视图。
- 支持公式、relation、筛选、排序、附件、行历史，以及 CSV/JSON/XLSX 交换。
- Agent 通过显式内置工具与 revision 校验读取和修改 Base。
- App 写入受 capability 约束，GUI 不会静默获得无限制数据权限。

## App

- 从不可变 Git revision 安装 static、server 或 Base-backed App。
- 随包开发看板、记账、健身和设计画布均使用 React 界面与共享交互规范。
- 安装、重建、授权与激活前检查 App 的最低 Bottega 版本，升级后返回原候选继续确认；四个第一方 App 均要求 Bottega 0.1.3 或更新版本。
- App 改名保留当前运行版本、数据与授权，无需重新构建。
- 使用随包交付的 Bottega Design Canvas 创建自包含 HTML 方向、比较 Live/History 版本，并把编号视觉锚点送回 Agent；预览不获得网络或存储权限。
- 使用随包交付的 Fitness Log 浏览 17 个肌肉区域的 72 个动作、查看动作动图并管理训练计划，宿主 React 界面支持五语言。
- 通过 App SDK 读取完整、版本一致的 Base 快照，并获得可恢复的加载状态和显式重试入口。
- 把 App 绑定到 Chat 与 Project，同时分离使用、编辑和授权。
- 通过受约束的产品 SDK，在结构化数据旁呈现 App GUI。
- 针对精确 App generation，分别授权 read、insert、patch、delete 与 attachment 能力。
- 分享可复用工作流，不复制本机凭据或私有工作空间状态。

## 工具与 Extension

- Settings › Tools 提供全局默认值，并允许针对一个精确 Project 覆盖内置工具与手动 MCP server。
- turn 开始前冻结最终工具与 MCP plan，重试和 session 恢复不会静默采用更新后的权限。
- Extension 可安装到全局或一个精确 Project；Skill、App requirement、session、retained data 与删除清理共用同一 scoped owner。
- MCP 密钥只进入 main-owned sealed storage；持久化所有权证据不完整时一律 fail closed。

## Memory

- 长期 Memory 默认关闭，召回或采集前必须获得明确同意。
- 可选择产品托管的本机 OpenViking 或 EverOS 后端。
- 召回范围可以限定为单个 Chat、一个 Project group，或个人工作空间。
- 在把上下文交给 Agent 前，严格分离可信产品指令与不可信召回事实。
- 明确显示交付、重建、来源、版本与注意状态，不把“不可用”伪装成“空”。

## 后台活动

- 后台运行由一个开关管理，登录自启可单独设置，两项默认关闭。
- macOS 可选择 Bottega Logo 图标、黑白菜单栏图标或刘海任务面板。系统记住选择，没有连接刘海屏时使用图标；Windows/Linux 使用系统托盘。
- 从刘海面板关注运行中的任务和待处理请求，支持键盘导航，并可返回相关聊天。
- 通过可用的后台入口重新打开或退出 Bottega。

## 本地存储

- Chat、Base、Project、App 与附件保持持久的本机所有权，并具有中断恢复与明确的留存规则。
- 无需云账号即可使用，普通本地工作不积累上传队列；0.1.4 不包含云同步服务。
- 更换版本前备份完整应用数据目录。从 0.1.3 或更早版本升级到 0.1.4 需要空白应用数据目录，操作方式见[升级说明](../getting-started/README.zh-CN.md#升级到-014)。

## 共同基础

这些能力域遵守同一组原则：本机 CLI 凭据主权、capability 有界文件访问、主进程持久化所有权、显式归档与删除流程，以及后端不支持某项能力时的诚实降级。
