# Bottega 文档

[English](./README.md) · [仓库首页](../README.md)

当前 `main` 是**待发布的 0.4.2 源码**，使用**协议 27**。最新已发布安装包仍为 [0.4.1](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.4.1)，使用**协议 26**。本次源码公开不表示 0.4.2 安装包、托管部署或原生验收已完成。 请阅读[当前源码范围](./getting-started/README.zh-CN.md#待发布-042-源码)与[已发布的 0.4.1 安装说明](./getting-started/README.zh-CN.md#升级到-041)。0.2.5 个人版需要手动安装已发布的稳定版本。

文档按职责组织，让仓库根目录只聚焦源码与构建配置。

- [快速开始](./getting-started/README.zh-CN.md)：产品价值、环境要求、安装、pnpm 命令、仓库边界与协作方式。
- [功能](./features/README.zh-CN.md)：四个 Agent、原生子代理、四类 Artifact、Base、插件、App、Project 级工具与 Extension、Memory，以及这些能力共享的产品基础。
- [更新日志](./changelog/README.zh-CN.md)：只记录产品里程碑，不包含内部开发过程日志。

## 组件许可

[Bottega 的 MIT 许可](https://github.com/thinkingjimmy/Bottega/blob/main/LICENSE)适用于未另行注明许可的自有代码。随附第三方组件保留各自条款。

Canvas、Slides 与 Design System 使用为 Bottega 适配的 BaoCut 修改分支，当前以 baoyu-design 2.7.1 为功能与外观参考，保留原始源码来源。它们提供可读源码，分别受 [Canvas BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/canvas-runtime/LICENSE)、[Slides BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/slides-runtime/LICENSE) 和 [Design System BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/design-system-runtime/LICENSE)约束。它们是修改版本，与上游正式发行分开标识，未改为 MIT 许可。独立维护的 Dashboard 代码使用 MIT；随附参考材料保留各自条款。

Community License 允许个人、研究和内部使用，包括付费内部开发，并按其条件允许非商业再分发。在对外提供的商业软件中集成覆盖代码，或进行商业分发、对外商业托管，需要相关权利人的单独书面授权。公开源码或免费提供部分功能，不自动授予这些权利。创作成果遵循许可中的 Content 条款及适用素材许可。

完整原始许可、版权与第三方声明保留在源码和随附运行时资源中。
