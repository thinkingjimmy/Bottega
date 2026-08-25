# Bottega 功能

[English](./FEATURES.md)

Bottega 把 Agent 对话视为一个可持续、本地工作空间的控制面。产品由四个核心能力域构成。

## Multi-agent

- 通过统一、后端无关的 ACP transport 连接 Codex、Claude Code、Kimi Code 与 OpenCode。
- 每个任务绑定稳定的 Agent session，同时保留各家官方 CLI 自己的登录、用量与配额模型。
- 提供 Plan、运行中 Steer、消息队列与可见的工具过程，同时不掩盖不同后端的能力差异。
- 创建 Section 与 Subagent 并行工作，查看进度，在明确预算内交接上下文，并把有价值的结果提升为持久 Section。
- 搜索和接续受支持的本机 CLI 历史，不静默改写原始记录。

## Base

- 让 Chat 或 Project 在对话旁拥有结构化、以 row 为事实源的数据空间。
- 同一份数据支持 Table、List、Kanban、Map、Chart 与 Gallery 六种视图。
- 支持公式、relation、筛选、排序、附件、行历史，以及 CSV/JSON/XLSX 交换。
- Agent 通过显式内置工具与 revision 校验读取和修改 Base。
- App 写入受 capability 约束，GUI 不会静默获得无限制数据权限。

## App

- 从不可变 Git revision 安装 static、server 或 Base-backed App。
- 把 App 绑定到 Chat 与 Project，同时分离使用、编辑和授权。
- 通过受约束的产品 SDK，在结构化数据旁呈现 App GUI。
- 针对精确 App generation，分别授权 read、insert、patch、delete 与 attachment 能力。
- 分享可复用工作流，不复制本机凭据或私有工作空间状态。

## Memory

- 长期 Memory 默认关闭，召回或采集前必须获得明确同意。
- 可选择产品托管的本机 OpenViking 或 EverOS 后端。
- 召回范围可以限定为单个 Chat、一个 Project group，或个人工作空间。
- 在把上下文交给 Agent 前，严格分离可信产品指令与不可信召回事实。
- 明确显示交付、重建、来源、版本与注意状态，不把“不可用”伪装成“空”。

## 共同基础

四个能力域遵守同一组原则：本机 CLI 凭据主权、capability 有界文件访问、主进程持久化所有权、显式归档与删除流程，以及后端不支持某项能力时的诚实降级。
