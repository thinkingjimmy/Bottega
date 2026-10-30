<p align="center">
  <img src="./packages/ui/src/assets/brand/bottega-mark.png" alt="Bottega logo" width="112">
</p>

<h1 align="center">Bottega</h1>

<p align="center"><strong>The workshop that builds itself.</strong></p>

<p align="center">
  Bottega is an open-source, local-first desktop workspace for Codex, Claude Code, Kimi Code, and OpenCode.<br>
  Turn Agent conversations into durable workspaces with Base, Apps, Memory, browser tools, and multi-agent collaboration—while credentials stay with the official local CLIs.
</p>

<p align="center">
  <a href="https://github.com/thinkingjimmy/Bottega/releases/tag/v0.2.11"><img alt="0.2.11 stable" src="https://img.shields.io/badge/release-0.2.11%20stable-blue"></a>
  <a href="https://github.com/thinkingjimmy/Bottega/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/thinkingjimmy/Bottega?style=flat&amp;logo=github"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

<p align="center">
  <a href="https://www.getbottega.app">Website</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="./docs/getting-started/README.md">Quickstart</a> ·
  <a href="https://github.com/thinkingjimmy/Bottega/releases/tag/v0.2.11">Download</a> ·
  <a href="./docs/features/README.md">Features</a> ·
  <a href="./docs/changelog/README.md">Changelog</a> ·
  <a href="https://x.com/hellojimmywong">X</a>
</p>

<p align="center">
  <strong>English</strong> | <a href="./docs/README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="./images/readme.png" alt="Bottega-README">
</p>

# Key features

- **Your Agents, one sidebar.** Run Codex, Claude Code, Kimi Code, and OpenCode through their official local CLIs. Switch Agents for the next turn in an idle chat while keeping the same transcript.
- **Make the workspace yours.** Manage built-in plugins and their settings, choose Agent models and reasoning levels from dropdowns, and place Bottega Dock on your preferred display and edge.
- **Work with Artifacts.** Open saved files in a workspace and edit Canvas pages, boards, text, and object properties.
- **Sketch your next prompt.** Draw, add text and shapes, and erase details in the composer. Keep sketches editable until they are sent as PNG images.
- **Build AI-native Apps.** Describe the workflow you need and turn it into a durable App with its own interface, data, and permissions—not another result trapped in a transcript.
- **Customize by chatting.** Open an editable App's source Chat, describe the change, and let your Agent update its features, data, and interface directly.
- **Every Chat, one data space.** Give a Chat or Project a structured Base, then work with the same rows as a table, list, Kanban board, map, chart, or gallery.
- **Plan, develop, review — as a workflow.** Turn on a workflow for a Project's Base: your Agents plan, develop, and review each task while you confirm the plan and decide on the result, from the desktop, a browser, or your phone.
- **Sync it, or keep it local.** Everyone starts on this computer. Sign in when you want your work on more than one device: content is end-to-end encrypted with a sync password that only you hold, and the server never sees your plain text.
- **Reach the computer that holds the work.** Signing in publishes that computer's sidebar to your account. Switch computers in the sidebar from a browser, a phone, or another desktop, and drive the one you need.
- **Open your workspace in a browser.** Sign in at [app.getbottega.app](https://app.getbottega.app) to read and edit your Chats, Bases, and Apps from another computer or a phone.

[Explore the complete feature guide →](https://www.getbottega.app/features/agents/)

# Get started

Choose a prebuilt desktop release or run Bottega directly from source. Before launching, install and authenticate at least one supported CLI: Codex, Claude Code, Kimi Code, or OpenCode.

## Download

[Download 0.2.11 →](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.2.11)

| Platform | Download |
| --- | --- |
| macOS (Apple silicon / ARM64) | [DMG or ZIP](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.2.11) |

0.2.11 is an **official stable release for macOS on Apple silicon only**. Automatic updates are enabled for this release and follow the official stable channel.

**Updating:** 0.2.6 and 0.2.7 installations use the stable update channel. The shipped 0.2.5 personal build has its updater disabled and requires a manual installation of 0.2.11. Before replacing the app, quit Bottega completely and back up your Bottega folder and application data.

This release uses **protocol 22**. Update connected desktops and reload Bottega Web after the coordinated service update. Existing Bottega content, cloud content, sync passwords, and account keys remain. No data reset is required. See the [changelog](./docs/changelog/README.md) for custom Dock Widgets, data permissions and upgrade limits.

Use the official **Developer ID signed and Apple notarized** DMG or ZIP. Download `Bottega-0.2.11-release-evidence.tar.gz` from the same release and read `release-manifest.json` at its root. Run `shasum -a 256` on the installer and compare the result with its `sha256` in the manifest, then copy Bottega into `Applications`. See the [installation guide](./docs/getting-started/README.md#download-and-install) for the commands.

**Historical validation:** 0.2.7 was published by owner decision before complete local and final-package GUI acceptance. It has no complete acceptance evidence archive. Those facts remain specific to 0.2.7; its Release page lists the actual assets.

Bottega drives the Codex, Claude Code, Kimi Code, and OpenCode CLIs already installed and logged in on your machine. On first launch, pick your Bottega folder, let Bottega detect the CLIs, then create a task and choose its Agent before sending the first message. Setup never asks about an account: signing in is a later step, from Settings.

Codex uses its native App Server and requires **CLI 0.163.0-alpha.10.2 exactly**. Ask for approval and Approve for me allow network access, temporary-directory writes and ordinary reads outside the workspace. Plan does not enforce filesystem read-only access. Read the [Codex permission changes](./docs/features/README.md#codex-command-permissions) and the [supported CLI versions](./docs/getting-started/README.md#requirements) before starting.

## Build from source

Requires a Mac with Apple silicon. This source pins Node.js 24.21.0 and pnpm 11.9.0.

```bash
git clone --recurse-submodules https://github.com/thinkingjimmy/Bottega.git
cd Bottega
npm install --global pnpm@11.9.0
pnpm install --frozen-lockfile
node apps/desktop/scripts/node-runtime/fetch-node.mjs --dev-manifest
pnpm dev
```

To create a production build or a local installer:

```bash
pnpm build
pnpm dist
```

A signed distribution requires your own Apple signing configuration. Official release installers are available from the [Releases page](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.2.11). See the [getting-started guide](./docs/getting-started/README.md) for requirements, supported Agent CLIs, and build commands.

## Build provenance

The [macOS candidate workflow](./.github/workflows/build-macos.yml) builds the production source in this repository. Its [Actions runs](https://github.com/thinkingjimmy/Bottega/actions/workflows/build-macos.yml) record the exact source commit, pinned tools, installer hashes and GitHub provenance. Published installers keep the original GitHub build bytes and their recorded hashes.

Build-only candidates validate this build process and expire after one day. Official stable downloads are published on the [Releases page](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.2.11). Personal installers use manual updates; official 0.2.11 installers enable the stable automatic-update channel.

# Collaboration

Please use [GitHub Issues](https://github.com/thinkingjimmy/Bottega/issues) for bugs, feedback, and proposals. Pull requests are not accepted during this early, fast-moving stage and will be closed without review.

Bottega is available under the [MIT License](./LICENSE).
