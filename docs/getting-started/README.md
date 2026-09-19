<p align="center">
  <img src="../../apps/desktop/src/assets/bottega-sidebar-logo.png" alt="Bottega" width="360">
</p>

[Documentation](../README.md) · [简体中文](./README.zh-CN.md) · [Features](../features/README.md) · [Changelog](../changelog/README.md)

# Getting started

Bottega is a local-first macOS workspace for AI coding agents. It connects the Codex, Claude Code, Kimi Code, and OpenCode CLIs already installed and authenticated on your machine, then gives their conversations durable structure through Base, Apps, Memory, browser tools, and multi-agent collaboration.

The project is in an early, fast-moving stage. Interfaces and storage formats may change without a compatibility layer.

## Your Bottega folder

0.1.5 introduces the Bottega folder: one folder on your disk, chosen during setup, that holds your readable content. Chat transcripts, original attachments, saved artifacts, Chat Home files, Project details, Base records, App source, and Skills live there. Account settings, encryption keys, device permissions, and execution records stay in the application data directory on each computer.

Folder format v1 is the start of the supported upgrade path. To back up your local content, quit Bottega completely, then copy the whole folder. A copy made while Bottega is running is a best-effort recovery source only: it can contain incomplete messages or missing files, and recovery reports those gaps. Keep the original until you have checked the restored copy. Content that exists only in Cloud Sync still has to be downloaded.

After reinstalling Bottega or moving to another computer, choose the copied folder during setup. Saved content is then available offline. Reconnect external Project folders and authorize Apps again on the new computer, then sign in and enter your sync password to reconnect Cloud Sync. If an older backup differs from the cloud, the cloud keeps its current content and local conversation differences become separate Chats. A restored Agent session resumes only when its saved history boundary can be verified; otherwise Bottega starts a new session from the saved history and says so.

The folder location is fixed after setup. To use a different location, quit Bottega, copy the complete folder, then choose that copy after reinstalling. Settings › General shows the current location and can reveal it in your file manager. Editing or deleting the transcript files inside the folder does not edit or delete the conversation in Bottega.

Do not put the folder inside iCloud Drive, Dropbox, OneDrive, or another file-synchronization directory. That configuration is unsupported. Use Cloud Sync for parallel work across devices.

If the local Chat database cannot be opened, startup offers recovery actions, including rebuilding conversations from the folder while the previous database is preserved. Unfinished replies may be missing, and search indexes and synchronization state are recreated.

### Fresh install

On first launch, Bottega asks whether to work on this computer only or to connect an existing account, then asks you to choose your Bottega folder. Choose an empty folder to start clean, or an existing Bottega folder to reopen its contents. Every installation, including an upgrade from an earlier release, goes through this step.

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

If you are upgrading from 0.1.0 or 0.1.1, download and install [0.1.5](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.1.5) manually once. The older installed versions contain an updater bug; the fix takes effect after the new binary is installed. Windows continues to use manual installer downloads.

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

## Cloud Sync and Cloud Web

Cloud Sync is optional and stays off until you turn it on. Local use needs no account and queues no uploads.

- **Sign in through your browser.** Bottega opens your system browser for Google sign-in, you approve the request there, and the desktop app picks the session up. Google is the only sign-in method, and Bottega never asks for that password.
- **Set a sync password.** The first computer sets a separate sync password of at least 8 characters including an English letter and a number. It is not your Google password. The key that encrypts your content is derived from it on your own device with Argon2id, content is sealed with XChaCha20-Poly1305 before it leaves the computer, and the server stores only ciphertext.
- **There is no password recovery.** No recovery key, no approval from another device, no reset. If you lose the password and no signed-in device can still decrypt, content that exists only in the cloud cannot be recovered. Bottega states this before you turn sync on and asks you to confirm it.
- **One account, one encrypted workspace.** A second computer chooses its own Bottega folder, signs in with the same account, and enters the same sync password to join.
- **Cloud Web.** Signed in at [app.getbottega.app](https://app.getbottega.app) you can read Chats with their tool activity and attachments, search chat titles and the last seven days of message bodies, work with Bases in all six views, read and edit synced App records, restore or delete archived items, and manage devices and preferences. Custom App interfaces, the in-app Browser, and local tools stay on your computer. Phone browsers are supported; Chrome is the tested browser.

### Remote control

When remote control is enabled for the service, a signed-in desktop that is online and unlocked can be driven from Cloud Web or a phone browser: choose the computer and Agent, send a message, watch the reply stream, Stop, approve or reject permission requests, answer questions, steer, and follow up. Remote control is a server-side switch rather than an app setting, and it stays off until Bottega turns it on. While it is off, Chats open in the browser as read only; reading a transcript and watching a running turn still work.

<a id="upgrading-to-015"></a>

## Upgrading to 0.1.5

0.1.5 keeps your content in a Bottega folder you choose during setup, and it does not import Chats, Projects, Apps, Bases, attachments, or settings from 0.1.4 or any earlier release. Nothing in the old application data folder is changed or deleted; it is simply not picked up.

1. Quit Bottega completely, including any background process, and back up the complete application data folder. Keep your external Chat Homes and Project folders as well.
2. Move the application data folder to a backup location instead of deleting it. On macOS, after quitting, run:

```bash
bottega_data="$HOME/Library/Application Support/Bottega"
bottega_backup="${bottega_data}.backup-$(date +%Y%m%d-%H%M%S)"
mv -n "$bottega_data" "$bottega_backup"
```

3. Install and launch 0.1.5, then complete onboarding again. Choose a new, empty Bottega folder when asked; everything in [Your Bottega folder](#your-bottega-folder) applies from that point on. Previous Bottega chats, settings, and installed App records are not imported automatically. External Project files and official CLI credentials remain where they were.

The application data folder locations, the rule about moving the whole folder rather than single files, and the procedure for restoring a backup are the same as for 0.1.4; see the section below. The same preparation applies when you come from 0.1.3 or earlier.

<a id="upgrading-to-013"></a>

## Upgrading to 0.1.4

0.1.4 does not migrate the local storage formats used by 0.1.3 or any earlier release. An existing chat database causes startup to stop with a schema error; reinstalling the application does not change that database.

1. Quit Bottega completely, including any background process, and back up the complete application data folder. Keep external Chat Homes and Project folders as well.
2. To start fresh in 0.1.4, move the application data folder to a backup location instead of deleting it. On macOS, after quitting, run:

```bash
bottega_data="$HOME/Library/Application Support/Bottega"
bottega_backup="${bottega_data}.backup-$(date +%Y%m%d-%H%M%S)"
mv -n "$bottega_data" "$bottega_backup"
```

3. Install and launch 0.1.4, then complete onboarding again. Previous Bottega chats, settings, and installed App records are not imported automatically. External Project files and official CLI credentials remain where they were.

The installed application data folder is `~/Library/Application Support/Bottega` on macOS, `%APPDATA%\Bottega` on Windows, and `$XDG_CONFIG_HOME/Bottega` on Linux (normally `~/.config/Bottega`). Move the whole folder, including database sidecars and related records; moving only `bottega.sqlite3` leaves inconsistent state. Development builds use a separate `@ai-chat/desktop` data directory.

Keep the backup untouched if you need access through the older application. To restore it, quit 0.1.4, separately archive its new data folder, and restore the original folder before opening the matching older version.

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

On first launch, choose whether to work on this computer only or to connect an existing account, choose your Bottega folder, and let Bottega detect the supported CLIs. Skills and long-term memory are optional steps in the same wizard and can be changed later in Settings. Once the folder and at least one backend are ready, create a task and select its Agent before sending the first message.

## Repository scope

This repository is the public product source: the Electron desktop application, shared UI packages, production assets, and milestone documentation.

The development repository is intentionally separate. Tests, test data, E2E harnesses, the web application, internal evaluations, TODOs, development notes, weekly changelogs, `.claude`, and `.github` automation are not published here. The public repository starts from a clean history so excluded development material is not retained in earlier commits.

## Collaboration

Please use [GitHub Issues](https://github.com/thinkingjimmy/Bottega/issues) for bug reports, product feedback, and feature requests.

**Pull requests are not accepted at this stage.** Bottega is changing quickly and large internal rewrites are common; reviewing external patches against a moving architecture would slow the main development path. Please describe the problem or proposal in an Issue instead. Pull requests opened during this phase will be closed without review.

## License

Bottega is released under the [MIT License](../../LICENSE).
