<p align="center">
  <img src="./apps/desktop/src/assets/bottega-sidebar-logo.png" alt="Bottega" width="360">
</p>

# Bottega

Bottega is a local-first macOS workspace for Codex, Claude Code, Kimi Code, and OpenCode. It turns Agent conversations into durable workspaces with Base, Apps, Memory, browser tools, and multi-agent collaboration while leaving credentials with the official local CLIs.

This repository currently publishes the latest source preview. Formal signed installers and the first GitHub Release are still gated by cross-platform and update-path verification.

[Documentation](./docs/README.md) · [简体中文](./docs/README.zh-CN.md) · [Features](./docs/features/README.md) · [Changelog](./docs/changelog/README.md)

## Quick start

    git clone --recurse-submodules https://github.com/thinkingjimmy/Bottega.git
    cd Bottega
    corepack enable
    pnpm install
    pnpm dev

See the [getting-started guide](./docs/getting-started/README.md) for requirements, supported Agent CLIs, build commands, and the repository boundary.

## Collaboration

Please use [GitHub Issues](https://github.com/thinkingjimmy/Bottega/issues) for bugs, feedback, and proposals. Pull requests are not accepted during this early, fast-moving stage and will be closed without review.

Bottega is available under the [MIT License](./LICENSE).
