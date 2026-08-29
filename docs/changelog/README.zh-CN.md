# 更新日志

[文档首页](../README.zh-CN.md) · [English](./README.md)

本文件只记录产品里程碑，不记录内部实现的逐次迭代。日期表示对应能力首次形成完整产品形态的时间。

## 2026-08-29 — Project 级工具、Extension 与 Design Canvas 源码预览

- 在干净公开历史上以正常子提交发布当前生产源码；测试、开发自动化与内部证据继续只留在 Bottega-Dev。
- 内置工具与手动 MCP server 支持精确 Project 覆盖。每个 turn 在副作用开始前冻结最终工具计划、scope revision、runtime 支持事实与 sealed MCP 配置。
- Extension 统一采用 `global | exact Project` 所有权，贯穿管理、Skill、App requirement、session、retained data 与删除恢复；terminal 旧 MCP-plan 账本可向前迁移，活跃且身份不完整的 custody 继续 fail closed。
- 增加随包交付的 Bottega Design Canvas，支持自包含 HTML 画板、方向与历史比较、编号视觉锚点、沙箱预览与 Agent 侧 render check。
- 四个第一方 App gitlink 全部推进到远端可达提交。本次是源码预览，不是仍受发布门禁约束的正式 `v0.1.0` 安装包 Release。

## 2026-08-25 — 公开源码发布

- Bottega 以 MIT License 发布，并使用只包含公开内容的全新 Git 历史。
- 建立硬性仓库边界：生产桌面源码与里程碑文档公开；测试、测试数据、Web 应用、内部评估、TODO、开发笔记、周度工程日志与仓库自动化保留在开发仓库。
- 公开文档统一进入 docs/，并按快速开始、功能、更新日志组织二级目录；根 README 只承担 GitHub 仓库入口职责。
- 产品、package、窗口、构建产物、ACP client 与导出文档统一使用 **Bottega** 身份。

## 2026-08-18 至 2026-08-23 — 可持久化协作

- 工作空间引用从 Chat 扩展到文件与 Section。
- 支持 Section 之间持久化交接图片，并把 Subagent 结果提升为可复用、默认 idle 的 Section。
- 统一管理 Codex、Claude Code、Kimi Code 与 OpenCode 的本地 Skills。
- 增加可搜索的只读历史联邦，并支持接续本机 Agent session。

## 2026-08-08 至 2026-08-23 — 显式同意的 Memory

- 增加产品托管的本机 OpenViking 与 EverOS provider。
- 引入 Chat、Project group 与个人三级共享范围，配套显式同意和可观测交付状态。
- 增加重建、来源、模型下载进度与可信版本切换。

## 2026-08-04 至 2026-08-21 — App、工具与浏览器

- 增加由进程内 CDP 控制的多标签页内置浏览器。
- 内置工具平台扩展到 Section、搜索、Base、文件、App 与浏览器动作。
- 统一 static、server 与 Base-backed App，并提供与 generation 绑定的权限和受约束 GUI SDK。

## 2026-07-28 至 2026-08-23 — Base

- 为 Chat 与 Project 引入结构化数据，支持 Table、List、Kanban、Map、Chart 与 Gallery 六种视图。
- 增加公式、relation、附件、行历史、导入导出，以及 capability 有界的 App 写入。

## 2026-07-16 至 2026-08-09 — 桌面端与 Multi-agent 基础

- 从 Web 原型迁移为 Electron 桌面工作台。
- 通过本机 CLI 与 ACP 连接 Codex、Claude Code、Kimi Code 和 OpenCode，同时保留 CLI 凭据主权。
- 增加流式 turn、审批、Plan、消息 Steer、Subagent、Project 工作空间、归档语义与 OS 级文件边界。
