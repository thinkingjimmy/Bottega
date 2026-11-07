# Bottega documentation

[简体中文](./README.zh-CN.md) · [Repository home](../README.md)

Current version: [0.4.0](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.4.0) for macOS on Apple silicon (ARM64), using protocol 26. Ordinary Codex Chat checks its native protocol and capabilities; generated native titles and isolated editor tasks keep separate CLI qualification. Read the [native command permissions](./features/README.md#codex-command-permissions) and [installation and update notes](./getting-started/README.md#upgrading-to-040). The 0.2.5 personal build needs a manual update. [Bottega Web](https://app.getbottega.app) remains available.

Documentation is organized by responsibility so the repository root remains focused on source and build configuration.

- [Getting started](./getting-started/README.md): product value, requirements, installation, pnpm commands, repository scope, and collaboration policy.
- [Features](./features/README.md): Multi-agent, four-format Artifacts, Base, workflows, Agent configurations, Apps, scoped Tools and Extensions, Memory and their shared foundations.
- [Changelog](./changelog/README.md): milestone-level product changes without internal development logs.

## Component licenses

The [MIT License](https://github.com/thinkingjimmy/Bottega/blob/main/LICENSE) applies to Bottega's first-party code unless a file or component states another license. Bundled third-party components retain their own terms.

Canvas, Slides and Design System use modified BaoCut editor forks adapted for Bottega. Their current behavior and appearance reference is baoyu-design 2.7.1; original source provenance is retained. They are source-available components under the [Canvas BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/canvas-runtime/LICENSE), [Slides BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/slides-runtime/LICENSE) and [Design System BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/design-system-runtime/LICENSE). They are modified versions, separate from official upstream releases, and are not relicensed under MIT. The independently maintained Dashboard code uses MIT; bundled reference materials retain their own terms.

The Community License permits personal, research and internal use, including paid internal development, and redistribution for noncommercial purposes under its conditions. Commercial redistribution, incorporation in commercial software supplied to others or commercial hosted access to covered code requires a separate written license from the applicable rights holders. Publishing source or distributing a free feature does not itself grant those rights. Creative outputs follow the Content provisions and any applicable asset licenses.

Full original licenses, copyright notices and third-party notices remain with the source and bundled runtime resources.
