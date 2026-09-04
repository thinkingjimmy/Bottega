# 更新日志

[文档首页](../README.zh-CN.md) · [English](./README.md)

本文件只记录产品里程碑，不记录内部实现的逐次迭代。日期表示对应能力首次形成完整产品形态的时间。

## 2026-09-04 — v0.1.1

- 发布 v0.1.1 安装包：macOS arm64 DMG 与 ZIP、Windows x64 NSIS 安装包，以及 Linux x64 AppImage。这批产物仍未签名，各平台首次启动需要的一次性操作与 0.1.0 相同，仍见[快速开始](../getting-started/README.zh-CN.md)。
- 增加 Chat Fork。任意一条 assistant 回复都可以成为新 Chat 的起点，它之前的历史以只读方式继承；在 Git Project 上分叉还能获得一份产品托管的 worktree，同一场对话的两条分支不再互相覆盖同一个工作副本。
- 补齐 App 的使用侧。App Use 增加历史面板，App 也可以脱离主窗口、在独立窗口中运行。
- App GUI Surface 收敛为一套组件与一条消息通道，App 页面不再各自复制一份协议代码。
- 修复导入历史的两处真损坏。刷新导入历史不再清空 Chat 的 Project 归属；重新导入 session 会重写它的标题搜索文档，不再留下过期内容。
- 重排引导页。三步引导改为自适应窄窗口与容器感知的能力行，描述收敛为 chat home、Agent 与 extras 三段，在任何宽度下都保住可读的行宽。
- 让 Chat 存储的维护从「失败」改为「自愈」，也让真正的失败可被处理。与来源对话对不上的搜索投影会被重算，并经同一个写入口重写；自检确实失败时，侧栏给出带解决办法的类型化提示，以及一键打开预填 GitHub issue 的上报按钮。
- 让安装后的应用拥有自己的数据目录。从 Release 安装的副本现在把数据写入 `Bottega` 目录，不再与开发构建共用同一个目录，两者不会再互相重建本机状态。
- 让读不出的持久化账本自我恢复，而不是中止启动。内容不可信的账本会被改名隔离留证、以空态重建，应用照常启动。
- 随包交付的第一方 App preset 推进到各自已发布的提交。

## 2026-09-02 — v0.1.0

- 发布首批安装包。Bottega 现在可以从 GitHub Releases 获取 macOS arm64 DMG 与 ZIP、Windows x64 NSIS 安装包，以及 Linux x64 AppImage，全部由本次 tag 对应的提交构建。这批产物未签名，首次启动时各平台需要的一次性操作见[快速开始](../getting-started/README.zh-CN.md)。
- Chat 存储重建在 SQLite 之上，并以它为唯一真相源。对话、turn、附件与 fact 统一落在一个持久化本地数据库里，不再散落为逐 Chat 的文件；Chat 因此能在崩溃后存活、无需重新扫描即可恢复，也不再越长越慢。
- 让长对话的打开成本恒定。时间线、Chat 大纲与 Chat 内查找全部分页：打开一个有几万 turn 的 Chat 与打开一个短 Chat 代价相同，向上回溯也不会重新加载整份转录。
- 增加基于 gram 的全文搜索。搜索对中文、日文、韩文的匹配与空格分词语言一样可靠，且与转录读取同一份存储。
- 导入历史并入同一条时间线。从本机 Codex、Claude Code、Kimi Code 与 OpenCode CLI 接续的 session，现在与 Bottega 内创建的 Chat 使用同一份转录、大纲、搜索与导航，不再是一个独立的只读视图。
- 收窄 fact 写入。一个 turn 只更新它真正拥有的 fact，并发 turn、Memory 交付与 Base 写入不再互相覆盖状态。
- 关闭合并评审发现的问题。App Use 只在收到 completed 回执后才导航，被拒绝或恢复中的 App 不会再移动窗口；撤销 App 的 Base 访问权限成为一次原子操作，访问权与生命周期不再出现半状态；App 与 Project 的固定、Project 外观与设置导航重新组织，侧边栏始终反映真正打开的内容。

## 2026-08-29 — Project 级工具、Extension 与 Design Canvas 源码预览

- 在干净公开历史上以正常子提交发布当前生产源码；测试、开发自动化与内部证据继续只留在 Bottega-Dev。
- 内置工具与手动 MCP server 支持精确 Project 覆盖。每个 turn 在副作用开始前冻结最终工具计划、scope revision、runtime 支持事实与 sealed MCP 配置。
- Extension 统一采用 `global | exact Project` 所有权，贯穿管理、Skill、App requirement、session、retained data 与删除恢复。精确空的旧 Extension Registry、lifecycle ledger 与 projection ledger 可向前迁移；任何携带 live 或歧义授权事实的旧状态继续 fail closed。
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
