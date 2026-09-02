<p align="center">
  <img src="../../apps/desktop/src/assets/bottega-sidebar-logo.png" alt="Bottega" width="360">
</p>

[文档首页](../README.zh-CN.md) · [English](./README.md) · [功能](../features/README.zh-CN.md) · [更新日志](../changelog/README.zh-CN.md)

# 快速开始

Bottega 是一个本地优先的 macOS AI 编程 Agent 工作台。它连接你电脑上已经安装并登录的 Codex、Claude Code、Kimi Code 和 OpenCode CLI，再通过 Base、App、Memory、浏览器工具与多 Agent 协作，为对话补上可持续使用的工作结构。

项目仍处于早期快速演进阶段，接口与存储格式可能直接断代，不保证提供兼容层。

## Bottega 的差异化价值

- **继续使用你已经信任的 Agent。** Bottega 通过 ACP 连接官方本地 CLI，不复制、不迁移、也不代管凭据。
- **让对话成为工作空间。** Chat 可以拥有结构化 Base 数据、可复用 App、文件、浏览器标签页与长期上下文，而不是止步于一份孤立转录。
- **协调多个 Agent。** Plan、Steer、Section、Subagent 与结果提升，让并行工作可见、可接力、可复用。
- **权限始终显式。** 文件、App、工具、Memory 与跨 Chat 访问都通过有边界的 capability 授权，而不是默认获得环境中的全部权限。

产品模型与四个核心能力域见[功能文档](../features/README.zh-CN.md)。

## 环境要求

- macOS
- Node.js 22.12 或更高版本
- pnpm 11 或更高版本
- 至少安装一个受支持的 CLI：
  - Codex CLI 0.145.0 或更高版本
  - Claude Code 2.1.216 或更高版本
  - Kimi Code 0.29.1 或更高版本
  - OpenCode

启动 Bottega 前，请先在对应官方 CLI 中完成登录。Bottega 不会要求或导入这些凭据。

## 下载与安装

每个 release 都会在 [Releases 页面](https://github.com/thinkingjimmy/Bottega/releases)发布三个平台的安装包。

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| macOS（Apple 芯片） | `Bottega-<version>-arm64.dmg` 或 `-arm64-mac.zip` | 主要目标平台，仅支持 Apple 芯片。 |
| Windows（x64） | `Bottega-<version>-windows-x64.exe` | NSIS 安装包，安装过程中可选择目录。 |
| Linux（x64） | `Bottega-<version>-linux-x64.AppImage` | 先 `chmod +x`，然后直接运行。 |

这批产物**未做代码签名**，因此每个桌面平台都会要求确认一次。

**macOS。** Gatekeeper 不允许双击打开未签名应用。可以在「应用程序」里右键点击 Bottega 选择**打开**，在弹窗中确认；也可以在终端里一次性清除隔离属性：

```bash
xattr -d com.apple.quarantine /Applications/Bottega.app
```

**Windows。** SmartScreen 可能提示「Windows 已保护你的电脑」，原因是发布者未被识别。点击**更多信息**，再点击**仍要运行**。

签名与公证版本在计划中；在此之前，如果需要额外确认，请用 release 构建日志中打印的 SHA256 校验下载文件。

## 从源码构建

```bash
git clone --recurse-submodules https://github.com/thinkingjimmy/Bottega.git
cd Bottega
corepack enable
pnpm install
pnpm dev
```

如果 clone 时没有拉取 submodule，请先初始化随仓库固定的第一方 App：

```bash
git submodule update --init --recursive
```

常用命令：

```bash
pnpm typecheck   # 校验 TypeScript
pnpm build       # 构建 Electron 应用
pnpm dist        # 在本地构建 macOS DMG
```

`pnpm dist` 会为当前平台产出未签名的本地安装包，与已发布的安装包等价。

首次启动时，选择 Chat Homes 目录并等待 Bottega 检测本机 CLI。工作区与至少一个后端就绪后，即可创建任务，并在发送首条消息前选择 Agent。

## 仓库边界

本仓库只承载公开产品源码：Electron 桌面应用、共享 UI 包、生产资源与里程碑文档。

开发仓库与本仓库刻意分离。测试代码、测试数据、E2E harness、Web 应用、内部评估、TODO、开发笔记、周度详细 changelog、`.claude` 与 `.github` 自动化均不在此发布。公开仓库从全新的 Git 历史开始，因此被排除的开发资料也不会残留在早期 commit 中。

## 如何协作

Bug、产品反馈与功能建议，请直接提交到 [GitHub Issues](https://github.com/thinkingjimmy/Bottega/issues)。

**现阶段不接受 Pull Request。** Bottega 仍在快速变化，内部经常进行大规模重构；在持续移动的架构上审阅外部 patch 会拖慢主开发路径。请把问题或方案写进 Issue。此阶段创建的 Pull Request 会直接关闭，不进入评审。

## 协议

Bottega 使用 [MIT License](../../LICENSE)。
