# Bottega documentation

[简体中文](./README.zh-CN.md) · [Repository home](../README.md)

Source version: **0.4.5/protocol 27**, targeting macOS on Apple silicon (ARM64). Installer availability, accepted platforms and actual validation scope come from the [latest stable Release](https://github.com/thinkingjimmy/Bottega/releases/latest) and its evidence. A source version does not certify publication. Read the [native command permissions](./features/README.md#codex-command-permissions) and [installation and upgrade notes](./getting-started/README.md#upgrading-to-045). The 0.2.5 personal build needs a manual stable installation.

Documentation is organized by responsibility so the repository root remains focused on source and build configuration.

- [Getting started](./getting-started/README.md): product value, requirements, installation, pnpm commands, repository scope, and collaboration policy.
- [Features](./features/README.md): four Agents, native subagents, four-format Artifacts, Base, plugins, Apps, scoped Tools and Extensions, Memory and their shared foundations.
- [Changelog](./changelog/README.md): milestone-level product changes without internal development logs.

## Component licenses

The [MIT License](https://github.com/thinkingjimmy/Bottega/blob/main/LICENSE) applies to Bottega's first-party code unless a file or component states another license. Bundled third-party components retain their own terms.

Canvas, Slides and Design System use modified BaoCut editor forks adapted for Bottega. Their current behavior and appearance reference is baoyu-design 2.7.1; original source provenance is retained. They are source-available components under the [Canvas BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/canvas-runtime/LICENSE), [Slides BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/slides-runtime/LICENSE) and [Design System BaoCut Community License](https://github.com/thinkingjimmy/Bottega/blob/main/packages/design-system-runtime/LICENSE). They are modified versions, separate from official upstream releases, and are not relicensed under MIT. The independently maintained Dashboard code uses MIT; bundled reference materials retain their own terms.

The Community License permits personal, research and internal use, including paid internal development, and redistribution for noncommercial purposes under its conditions. Commercial redistribution, incorporation in commercial software supplied to others or commercial hosted access to covered code requires a separate written license from the applicable rights holders. Publishing source or distributing a free feature does not itself grant those rights. Creative outputs follow the Content provisions and any applicable asset licenses.

Full original licenses, copyright notices and third-party notices remain with the source and bundled runtime resources.
