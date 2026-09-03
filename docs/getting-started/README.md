<p align="center">
  <img src="../../apps/desktop/src/assets/bottega-sidebar-logo.png" alt="Bottega" width="360">
</p>

[Documentation](../README.md) · [简体中文](./README.zh-CN.md) · [Features](../features/README.md) · [Changelog](../changelog/README.md)

# Getting started

Bottega is a local-first macOS workspace for AI coding agents. It connects the Codex, Claude Code, Kimi Code, and OpenCode CLIs already installed and authenticated on your machine, then gives their conversations durable structure through Base, Apps, Memory, browser tools, and multi-agent collaboration.

The project is in an early, fast-moving stage. Interfaces and storage formats may change without a compatibility layer.

## Why Bottega

- **Use the agents you already trust.** Bottega talks to official local CLIs through ACP. It does not copy, migrate, or manage their credentials.
- **Turn conversations into workspaces.** A chat can own structured Base data, reusable Apps, files, browser tabs, and long-lived context instead of ending as an isolated transcript.
- **Coordinate more than one agent.** Plans, steering, Sections, Subagents, and result promotion make parallel work visible and reusable.
- **Keep authority explicit.** Files, Apps, tools, Memory, and cross-chat access are granted through bounded capabilities rather than an ambient all-access context.

See the [features guide](../features/README.md) for the product model and its four core capability areas.

## Requirements

- macOS
- Node.js 22.12 or newer
- pnpm 11 or newer
- At least one supported CLI:
  - Codex CLI 0.145.0 or newer
  - Claude Code 2.1.216 or newer
  - Kimi Code 0.29.1 or newer
  - OpenCode

Authenticate with the CLI provider before starting Bottega. Bottega never asks for or imports that credential.

## Download and install

Every release publishes installers for three platforms on the [Releases page](https://github.com/thinkingjimmy/Bottega/releases).

| Platform | Asset | Notes |
| --- | --- | --- |
| macOS (Apple silicon) | `Bottega-<version>-arm64.dmg` or `-arm64-mac.zip` | Primary target. Apple silicon only. |
| Windows (x64) | `Bottega-<version>-windows-x64.exe` | NSIS installer; choose the install directory during setup. |
| Linux (x64) | `Bottega-<version>-linux-x86_64.AppImage` | `chmod +x` the file, then run it. |

These builds are **not code-signed**, so each desktop platform needs a one-time step.

**macOS.** Gatekeeper blocks an unsigned download and reports that Bottega "is damaged and can't be opened". The file is fine; the quarantine flag macOS attaches to downloads is what triggers the message. After copying Bottega into `Applications`, clear the flag once from Terminal, then launch normally:

```bash
xattr -rd com.apple.quarantine /Applications/Bottega.app
```

The right-click **Open** and **Open Anyway** shortcuts do not apply to this build; the Terminal command is the supported path until signed releases ship.

**Windows.** SmartScreen may show a "Windows protected your PC" warning for an unrecognized publisher. Choose **More info**, then **Run anyway**.

Signed and notarized builds are planned; until then, verify the download against the SHA256 sums printed in the release build log if you need that assurance.

## Build from source

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

`pnpm dist` produces an unsigned local package for the current platform, equivalent to the published installers.

On first launch, choose a Chat Homes directory and let Bottega detect the supported CLIs. Once the workspace and at least one backend are ready, create a task and select its Agent before sending the first message.

## Repository scope

This repository is the public product source: the Electron desktop application, shared UI packages, production assets, and milestone documentation.

The development repository is intentionally separate. Tests, test data, E2E harnesses, the web application, internal evaluations, TODOs, development notes, weekly changelogs, `.claude`, and `.github` automation are not published here. The public repository starts from a clean history so excluded development material is not retained in earlier commits.

## Collaboration

Please use [GitHub Issues](https://github.com/thinkingjimmy/Bottega/issues) for bug reports, product feedback, and feature requests.

**Pull requests are not accepted at this stage.** Bottega is changing quickly and large internal rewrites are common; reviewing external patches against a moving architecture would slow the main development path. Please describe the problem or proposal in an Issue instead. Pull requests opened during this phase will be closed without review.

## License

Bottega is released under the [MIT License](../../LICENSE).
