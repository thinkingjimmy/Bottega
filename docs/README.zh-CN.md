# Bottega 文档

[English](./README.md) · [仓库首页](../README.md)

当前版本：[0.2.12](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.2.12)，仅提供 macOS Apple 芯片（ARM64）安装包。Codex CLI 仅支持 0.163.0-alpha.10.2，并使用[原生命令权限](./features/README.zh-CN.md#codex-命令权限)。0.2.5 个人版需要手动更新。升级前请阅读[安装与更新说明](./getting-started/README.zh-CN.md#升级到-0212)。[Bottega Web](https://app.getbottega.app) 继续可用。

文档按职责组织，让仓库根目录只聚焦源码与构建配置。

- [快速开始](./getting-started/README.zh-CN.md)：产品价值、环境要求、安装、pnpm 命令、仓库边界与协作方式。
- [功能](./features/README.zh-CN.md)：Multi-agent、Base、流程、Agent 配置、App、Project 级工具与 Extension、Memory，以及这些能力共享的产品基础。
- [更新日志](./changelog/README.zh-CN.md)：只记录产品里程碑，不包含内部开发过程日志。

## 组件许可

[Bottega 的 MIT 许可](https://github.com/thinkingjimmy/Bottega/blob/main/LICENSE)适用于未另行注明许可的自有代码。随附第三方组件保留各自条款。

原生 Canvas 和 Slides 使用为 Bottega 适配的 BaoCut 修改分支，以 baoyu-design 2.3 为功能与外观参考。这些组件提供可读源码，分别受 [Canvas BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/canvas-runtime/LICENSE) 和 [Slides BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/slides-runtime/LICENSE)约束。它们是修改版本，与上游正式发行分开标识，未改为 MIT 许可。

Community License 允许个人、研究和内部使用，包括付费内部开发，并按其条件允许非商业再分发。在对外提供的商业软件中集成覆盖代码，或进行商业分发、对外商业托管，需要相关权利人的单独书面授权。公开源码或免费提供部分功能，不自动授予这些权利。创作成果遵循许可中的 Content 条款及适用素材许可。

完整原始许可、版权与第三方声明保留在源码和随附运行时资源中。
