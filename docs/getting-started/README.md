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

After reinstalling Bottega, clearing its application data, or starting a new profile **on the same computer**, choose the same folder during setup. Saved content is available offline, Projects whose directories still exist come back without any clicks, and the computer keeps its place in your account. Reconnect external Project folders that have moved and authorize Apps again if you cleared their permissions. A restored Agent session resumes only when its saved history boundary can be verified; otherwise Bottega starts a new session from the saved history and says so.

### A Bottega folder belongs to its computer

The first time a computer synchronizes, it records itself as the folder's owner, in your account and in a `publisher.json` marker inside the folder. From then on that folder is that computer's.

- **The same computer again** — a reinstall, a cleared application data folder, or a second profile — opens the folder and takes it over silently. Nothing is asked and nothing is lost.
- **Another computer** is refused, with the owner named: "This Bottega folder belongs to *name*. This version cannot open it on another computer — create a new folder, or use it on that computer." Choose a different folder on that computer, or work on the one that owns it. The server refuses the same case even if the marker inside the folder is edited or deleted.
- **A folder that has never synchronized** has no owner and opens on any computer.

So in 0.1.6 a backup cannot be restored onto a different computer, and the same folder cannot be carried between two computers. Reading is never affected: everything a computer published stays readable in a browser and on your other computers, whether or not it is awake. Use Cloud Sync, not a copied folder, to work from more than one computer.

To change the location, use **Move folder** in Settings › General: Bottega restarts and moves the folder before it opens, and every saved path follows it. Moving to another disk copies and verifies everything first, then puts the old copy in the Trash. The move is refused while an Agent is working. Settings › General also shows the current location and can reveal it in your file manager. If you delete the folder yourself, Bottega starts setup again and copies your conversations into the new folder you choose. Editing or deleting the transcript files inside the folder does not edit or delete the conversation in Bottega.

Do not put the folder inside iCloud Drive, Dropbox, OneDrive, or another file-synchronization directory. That configuration is unsupported. Use Cloud Sync for parallel work across devices.

If the local Chat database cannot be opened, startup offers recovery actions, including rebuilding conversations from the folder while the previous database is preserved. Unfinished replies may be missing, and search indexes and synchronization state are recreated.

### Fresh install

Setup has one path and never mentions an account: choose your Bottega folder, set up an Agent (or press **Install later**), then optionally add Skills and long-term memory. Choose an empty folder to start clean, or a folder this computer used before to reopen its contents. Every installation, including an upgrade from an earlier release, goes through this step. Signing in comes later, from Settings, and is described under [Cloud Sync and Cloud Web](#cloud-sync-and-cloud-web).

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

If you are upgrading from 0.1.0 or 0.1.1, download and install [0.1.6](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.1.6) manually once. The older installed versions contain an updater bug; the fix takes effect after the new binary is installed. Windows continues to use manual installer downloads.

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

Signing in is optional. Local use needs no account and queues no uploads, and setup never asks about one.

- **Sign in through your browser.** Bottega opens your system browser for Google sign-in, you approve the request there, and the desktop app picks the session up. Google is the only sign-in method, and Bottega never asks for that password. Signing in lives in Settings › Sync.
- **Set a sync password, once.** The first computer on the account sets a separate sync password: at least 12 characters with a letter and a number, at least 5 different characters, no long runs of repeated or sequential characters, and nothing from your email name, `bottega`, or the most common passwords. The form ticks each rule as you type. It is not your Google password. Every device that signs in afterwards — another computer, Cloud Web, a phone browser — enters that same password. Only a desktop can set it, so a browser that reaches a brand-new account is told to sign in on a computer first instead of being asked for a password.
- **How it is protected.** The key that encrypts your content is derived from the password on your own device with Argon2id, content is sealed with XChaCha20-Poly1305 before it leaves the computer, and the server stores only ciphertext.
- **There is no password recovery.** No recovery key, no approval from another device, no reset. If you lose the password and no signed-in device can still decrypt, content that exists only in the cloud cannot be recovered. Bottega states this before the encrypted workspace is created and asks you to confirm it.
- **One account, one encrypted workspace.** A second computer chooses its own Bottega folder, signs in with the same account, and enters the same sync password to join.
- **Signing out** stops this computer publishing and stops it taking remote commands. It deletes nothing: what it already published stays readable in a browser and on your other computers, marked as signed out. Removing cloud data is a separate action in Settings, and Delete account is separate again.
- **Cloud Web.** Signed in at [app.getbottega.app](https://app.getbottega.app) you can read Chats with their tool activity and attachments, search chat titles and the last seven days of message bodies, work with Bases in all six views, read and edit synced App records, restore or delete archived items, and manage devices and preferences. Custom App interfaces, the in-app Browser, and local tools stay on your computer. Phone browsers are supported; Chrome is the tested browser.

### Signing in is remote control

A signed-in computer publishes its sidebar — its Projects and its Chats — to your account and accepts commands for them. There is no separate remote switch to find: the sync area in Settings is your sign-in state, this computer's name, and Sign out.

**Choose the computer you are looking at.** Once your account has more than one computer, a switcher appears at the top of the sidebar in Cloud Web, on a phone, and on the desktop; with a single computer there is nothing to choose and no switcher. Each tab is one computer, with a dot while it is awake and `Offline · 5 minutes ago` when it is not. A desktop always lists itself first. The sidebar below the switcher is that computer's Projects and Chats. Rename a computer in Settings; a second computer that arrives with a name already taken is registered as `… (2)` and can be renamed at any time.

**Drive it.** With the computer awake you can send a message, watch the reply stream, Stop, approve or reject permission requests, answer questions, steer, and follow up — from Cloud Web, from a phone browser, or from another desktop. Two devices can hold the same conversation: both messages queue in the order they arrive, two Stops count as one, and the second answer to the same permission request is told `Handled on <computer>` in one line rather than failing.

**Work with another computer's Projects.** A Project that belongs to another computer is drawn with a globe mark and that computer's name, and it offers no folder, path, or "Choose folder" — it has none here. A Chat you create under it is created, run, and stored on that computer. On the desktop, the sidebar's Projects `+` offers **Local Project** or **Pin a remote Project…**; pinning places another computer's Project in this computer's sidebar and copies nothing, unpinning changes nothing for the owner, and if the owner deletes or archives it the row stays, marked, with Unpin as its only action.

**While a computer is asleep or offline.** Its Chats stay readable, and renaming, archiving, reordering, editing a Base row, and writing an App record all still work — that computer reconciles them when it wakes. What needs it awake is execution: sending, Stop, approving, answering, steering, and deleting a Chat are greyed in place with a sentence saying why, your draft stays in the editor, and they recover on their own within about half a minute of the computer waking. A laptop is treated as offline about 90 seconds after its lid closes.

Bottega keeps a service-level switch that can turn remote control off for everyone if it has to. While it is off, browser Chats are read only; reading a transcript and watching a running turn still work.

<a id="upgrading-to-018"></a>

## Upgrading to 0.1.8

There is nothing to prepare. 0.1.8 opens a 0.1.7 chat database, settings, and Bottega folder as they are, and cloud data is kept.

The synchronization protocol moved to 10, and the service already speaks it. A 0.1.7 desktop signed in to the same account is asked to update before it can sync again; update every computer on the account. Your sync password does not change.

Bottega Dock is off until you turn it on in Settings › Dock. It needs macOS 15 or later on Apple silicon. If you choose to replace the system Dock, Bottega adds a recovery item to System Settings › General › Login Items & Extensions; it stays registered while replacement is on, so the system Dock can always be restored. To go back, choose **Restore System Dock** or turn Bottega Dock off.

<a id="upgrading-to-017"></a>

## Upgrading to 0.1.7

There is nothing to prepare. 0.1.7 opens a 0.1.6 chat database, settings, and Bottega folder as they are, and cloud data is kept. New Chats now start on an explicit default Agent, which begins as Codex; choose yours in Settings › Providers.

The synchronization protocol moved to 9, and the service already speaks it. A 0.1.6 desktop signed in to the same account is asked to update before it can sync again; update every computer on the account. Your sync password does not change — the stronger rules apply only when a new password is set.

<a id="upgrading-to-016"></a>

## Upgrading to 0.1.6

**0.1.6 does not open a 0.1.5 chat database.** On first launch the previous `bottega.sqlite3` and its sidecars are moved aside into `recovery/sqlite/` inside the application data folder, byte for byte, and the conversation index is rebuilt from your Bottega folder, which holds the content of record. Replies that never finished may be missing, and search indexes and synchronization state are recreated.

**Cloud data from 0.1.5 is not carried over.** 0.1.6 changes the synchronization protocol, and the service is reset before it ships: nothing 0.1.5 uploaded is kept. Sign in again afterwards. The first computer to sign in sets the sync password again, and every other computer, browser, and phone enters that new one.

Before installing, quit Bottega completely, including any background process, and back up both your Bottega folder and the complete application data folder. If anything looks wrong after the rebuild, moving the application data folder aside and starting from a fresh one is still the clean path — the procedure is the same as for 0.1.5 below, except that you choose the **same** Bottega folder again on the same computer rather than a new one.

Note that a Bottega folder now belongs to the computer that published it, so a backup cannot be restored onto a different computer; see [A Bottega folder belongs to its computer](#a-bottega-folder-belongs-to-its-computer).

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

On first launch, choose your Bottega folder and let Bottega detect the supported CLIs; **Install later** skips the Agent step. Skills and long-term memory are optional steps in the same wizard and can be changed later in Settings. Once the folder and at least one backend are ready, create a task and select its Agent before sending the first message. Signing in is not part of setup.

## Repository scope

This repository is the public product source: the Electron desktop application, shared UI packages, production assets, and milestone documentation.

The development repository is intentionally separate. Tests, test data, E2E harnesses, the web application, internal evaluations, TODOs, development notes, weekly changelogs, `.claude`, and `.github` automation are not published here. The public repository starts from a clean history so excluded development material is not retained in earlier commits.

## Collaboration

Please use [GitHub Issues](https://github.com/thinkingjimmy/Bottega/issues) for bug reports, product feedback, and feature requests.

**Pull requests are not accepted at this stage.** Bottega is changing quickly and large internal rewrites are common; reviewing external patches against a moving architecture would slow the main development path. Please describe the problem or proposal in an Issue instead. Pull requests opened during this phase will be closed without review.

## License

Bottega is released under the [MIT License](../../LICENSE).
