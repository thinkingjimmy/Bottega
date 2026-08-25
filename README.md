# Bottega

[简体中文](./README.zh-CN.md) · [Features](./FEATURES.md) · [Changelog](./CHANGELOG.md)

<p align="center">
  <img src="./apps/desktop/src/assets/bottega-sidebar-logo.png" alt="Bottega" width="360">
</p>

Bottega is a local-first macOS workspace for AI coding agents. It connects the Codex, Claude Code, Kimi Code, and OpenCode CLIs already installed and authenticated on your machine, then gives their conversations durable structure through Base, Apps, Memory, browser tools, and multi-agent collaboration.

The project is in an early, fast-moving stage. Interfaces and storage formats may change without a compatibility layer.

## Why Bottega

- **Use the agents you already trust.** Bottega talks to official local CLIs through ACP. It does not copy, migrate, or manage their credentials.
- **Turn conversations into workspaces.** A chat can own structured Base data, reusable Apps, files, browser tabs, and long-lived context instead of ending as an isolated transcript.
- **Coordinate more than one agent.** Plans, steering, Sections, Subagents, and result promotion make parallel work visible and reusable.
- **Keep authority explicit.** Files, Apps, tools, Memory, and cross-chat access are granted through bounded capabilities rather than an ambient all-access context.

See [FEATURES.md](./FEATURES.md) for the product model and its four core capability areas.

## Requirements

- macOS
- Node.js 20.19 or newer (Node.js 22.12 or newer recommended)
- pnpm 11 or newer
- At least one supported CLI:
  - Codex CLI 0.145.0 or newer
  - Claude Code 2.1.216 or newer
  - Kimi Code 0.29.1 or newer
  - OpenCode

Authenticate with the CLI provider before starting Bottega. Bottega never asks for or imports that credential.

## Install and run

```bash
git clone --recurse-submodules https://github.com/thinkingjimmy/Bottega.git
cd Bottega
corepack enable
pnpm install
pnpm dev
```

If you cloned without submodules, initialize the bundled first-party Apps before running:

```bash
git submodule update --init --recursive
```

Useful commands:

```bash
pnpm typecheck   # Validate TypeScript
pnpm build       # Build the Electron application
pnpm dist        # Build a local macOS DMG
```

On first launch, choose a Chat Homes directory and let Bottega detect the supported CLIs. Once the workspace and at least one backend are ready, create a task and select its Agent before sending the first message.

## Repository scope

This repository is the public product source: the Electron desktop application, shared UI packages, production assets, and milestone documentation.

The development repository is intentionally separate. Tests, test data, E2E harnesses, the web application, internal evaluations, TODOs, development notes, weekly changelogs, `.claude`, and `.github` automation are not published here. The public repository starts from a clean history so excluded development material is not retained in earlier commits.

## Collaboration

Please use [GitHub Issues](https://github.com/thinkingjimmy/Bottega/issues) for bug reports, product feedback, and feature requests.

**Pull requests are not accepted at this stage.** Bottega is changing quickly and large internal rewrites are common; reviewing external patches against a moving architecture would slow the main development path. Please describe the problem or proposal in an Issue instead. Pull requests opened during this phase will be closed without review.

## License

Bottega is released under the [MIT License](./LICENSE).
