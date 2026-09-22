# Changelog

[Documentation](../README.md) · [简体中文](./README.zh-CN.md)

This file records product milestones, not internal implementation iterations. Dates describe when each capability reached its first coherent product form.

## 2026-09-22 — v0.1.6

**Before upgrading:** 0.1.6 does not open a 0.1.5 chat database. On first launch the previous `bottega.sqlite3` and its sidecars are moved aside into `recovery/sqlite/` inside the application data folder, byte for byte, and the conversation index is rebuilt from your Bottega folder. Replies that never finished may be missing, and search indexes and synchronization state are recreated. Cloud data from 0.1.5 is not carried over either: the synchronization protocol changed and the service is reset before this release, so sign in again and let the first computer set the sync password again. Quit Bottega completely and back up both your Bottega folder and the application data folder first. See the [upgrade instructions](../getting-started/README.md#upgrading-to-016).

### What's new

- **A conversation belongs to the computer that created it.** Bottega no longer moves a running conversation between computers. Local is local, remote is remote: you open the computer that holds the work and drive it from wherever you are. Executor selection, hand-over, and the cross-computer queue are gone, along with the questions they used to ask you.
- **Signing in is remote control.** A computer that is signed in publishes its sidebar — its Projects and its Chats — and accepts commands for them. There is no second switch anywhere in the product: Settings' sync area is your sign-in state, this computer's name, and Sign out. Setup no longer asks whether to work on this computer or connect an account; everyone starts local, and signing in is a later step. The sync password is still part of signing in: the first computer sets it, and every later computer, browser, and phone enters it.
- **Switch computers in the sidebar.** Cloud Web, a phone browser, and the desktop share one strip at the top of the sidebar, one tab per computer, with a dot while it is awake and `Offline · 5 minutes ago` when it is not. It appears once your account holds a second computer, and a desktop always lists itself first. Rename a computer in Settings; a new computer arriving with a name already taken is registered as `… (2)`. A browser signed in to an account with no computer yet is told to sign in on a computer first, and is never asked for a password it cannot set.
- **Work with another computer's Projects.** A remote Project carries a globe mark and its computer's name and offers no folder, path, or "Choose folder" — it has none here. A Chat you create under it is created, run, and stored over there. On the desktop, the sidebar's Projects `+` now offers **Local Project** or **Pin a remote Project…**: pinning places another computer's Project in this computer's sidebar and copies nothing, unpinning changes nothing for the owner, and a Project the owner deletes or archives leaves a marked row with Unpin as its only action.
- **An offline computer no longer blocks your edits.** Renaming, archiving, reordering, editing a Base row, and writing an App record keep working while the computer that owns them is asleep, and it reconciles them when it wakes. Only execution needs it awake — send, Stop, approve, answer, steer, delete a Chat — and those controls grey in place with the reason instead of taking your draft away, then recover by themselves. When two devices answer the same permission request, the second one reads "Handled on *computer*" as a single line rather than an error.
- **A Bottega folder belongs to its computer.** The first synchronization records the owner, in your account and in the folder. The same computer takes the folder back after a reinstall, a cleared data folder, or a new profile, with nothing to confirm; another computer is refused by name, with one sentence explaining what to do instead. A folder that has never synchronized opens anywhere. Everything a computer published stays readable in a browser and on your other computers whether or not it is awake.
- **Continue an imported conversation anywhere.** An imported Codex, Claude Code, or Kimi history is no longer read-only in a fresh profile, in a workspace rebuilt from the folder, or under a Project with no folder chosen. It opens with the ordinary composer, and one divider marks where the imported history ends.
- **The first upload tells the truth, and is shorter.** Settings › Sync now counts real uploaded bytes instead of standing at `0 B`, and finishes exactly on its own total. Small conversations upload first, so the count starts moving in seconds. Each message now takes about half as many round trips as before.
- **Protocol 8.** The synchronization protocol and the local chat database both moved forward without a compatibility layer, which is what the upgrade note above is about.

### Download and install

The assets below include macOS arm64 DMG/ZIP, Windows x64 NSIS, and Linux x64 AppImage installers. These builds are **unsigned and not notarized**. macOS remains the primary platform; native App isolation and full feature parity on Windows/Linux are still in progress.

**macOS (Apple silicon):** open the DMG and drag Bottega into Applications. For the unsigned download, remove its quarantine flag once in Terminal, then open Bottega:

```bash
xattr -rd com.apple.quarantine /Applications/Bottega.app
```

**Windows (x64):** run the installer. If SmartScreen blocks the unrecognized publisher, choose **More info → Run anyway**.

**Linux (x64):** make the AppImage executable and launch it:

```bash
chmod +x Bottega-0.1.6-linux-x86_64.AppImage
./Bottega-0.1.6-linux-x86_64.AppImage
```

Install and authenticate at least one supported local CLI before starting a conversation. Users on 0.1.0 or 0.1.1 must install 0.1.6 manually because those versions contain the earlier updater bug. The storage preparation above applies to every earlier version.

## 2026-09-19 — v0.1.5

**Before upgrading:** 0.1.5 uses a new local storage layout built around the Bottega folder, and it does not import Chats, Projects, Apps, Bases, attachments, or settings from 0.1.4 or any earlier release. Quit Bottega completely, back up the entire application data folder, and keep your external Chat Homes and Project folders. Move the old application data folder to a backup location, then launch 0.1.5 with a fresh data folder and choose a new Bottega folder during setup. Previous Bottega chats, settings, and installed App records are not imported automatically; nothing in the old folder is changed. See the [backup and setup instructions](../getting-started/README.md#upgrading-to-015).

### What's new

- **Sync your work across computers, end to end encrypted.** Cloud Sync is optional and stays off until you turn it on; local use still needs no account. The first computer sets a separate sync password of at least 8 characters including an English letter and a number. The key that encrypts your content is derived from it on your own device with Argon2id, content is sealed with XChaCha20-Poly1305 before it is uploaded, and the server stores only ciphertext. There is no recovery key and no password reset, and Bottega says so before you turn sync on. One account holds one encrypted workspace; a second computer joins it with the same account and the same password.
- **Open your workspace in a browser.** Signed in at [app.getbottega.app](https://app.getbottega.app) you can read Chats with their tool activity and attachments, search chat titles and the last seven days of message bodies, work with Bases in all six views, read and edit synced App records, restore or delete archived items, and manage devices and preferences. Phone browsers are supported. Custom App interfaces, the in-app Browser, and local tools stay on your computer.
- **Continue a conversation from another device.** When remote control is enabled for the service, a signed-in desktop that is online and unlocked can be driven from Cloud Web or a phone browser: choose the computer and Agent, send a message, watch the reply stream, Stop, approve or reject permission requests, answer questions, steer, and follow up. Remote control is a server-side switch rather than an app setting. While it is off, Chats open in the browser as read only, and reading a transcript or watching a running turn still works.
- **Keep everything in a folder you own.** The Bottega folder chosen during setup holds Chat transcripts, original attachments, saved artifacts, Chat Home files, Project details, Base records, App source, and Skills. Account settings, keys, and device permissions stay on each computer. Quit Bottega before copying the folder for a complete backup, then choose that copy on another computer or in a fresh profile. File-synchronization folders such as iCloud Drive and Dropbox are unsupported. If the local Chat database cannot be opened, startup can rebuild conversations from the folder while preserving the previous database.
- **Start with the setup you want.** Onboarding first asks whether to work on this computer only or to connect an existing account, then walks through the Bottega folder, Agents, Skills, and long-term memory. Memory is set up inside the wizard instead of sending you to Settings.
- **See what your Agent produced.** Visualizations render inline and open in the side panel, file artifacts gain preview, save, reveal, and Quick Look actions, worksheets can be imported into a Base, and Claude artifacts open in the built-in browser. Previews stay sandboxed with no network or storage access.
- **More control over the four Agents.** OpenCode Go quota joins Codex, Claude Code, and Kimi in Settings and the Agent selector, with rolling, weekly, and monthly windows. Title generation now names one explicit Agent and model, and all four Agents can be chosen. A new **Settings › Lab** holds **Keep Agent connections**, off by default, which warms an Agent process when a conversation opens and reuses it for that conversation's turns in exchange for some memory.
- **Everyday sidebar work.** Drag Chats into the order you want, and that order is part of what syncs. Projects can be renamed without disturbing their contents and sorted by last update or by hand. Archiving a Chat or Project shows confetti, which can be turned off in Settings › General and pauses under the system reduced-motion setting.

### Download and install

The assets below include macOS arm64 DMG/ZIP, Windows x64 NSIS, and Linux x64 AppImage installers. These builds are **unsigned and not notarized**. macOS remains the primary platform; native App isolation and full feature parity on Windows/Linux are still in progress.

**macOS (Apple silicon):** open the DMG and drag Bottega into Applications. For the unsigned download, remove its quarantine flag once in Terminal, then open Bottega:

```bash
xattr -rd com.apple.quarantine /Applications/Bottega.app
```

**Windows (x64):** run the installer. If SmartScreen blocks the unrecognized publisher, choose **More info → Run anyway**.

**Linux (x64):** make the AppImage executable and launch it:

```bash
chmod +x Bottega-0.1.5-linux-x86_64.AppImage
./Bottega-0.1.5-linux-x86_64.AppImage
```

Install and authenticate at least one supported local CLI before starting a conversation. Users on 0.1.0 or 0.1.1 must install 0.1.5 manually because those versions contain the earlier updater bug. The storage preparation above applies to every earlier version.

## 2026-09-10 — v0.1.4

**Before upgrading:** 0.1.4 uses a new local storage format and cannot open or automatically migrate data from 0.1.3 or earlier. Quit Bottega completely, back up the entire application data folder, and keep your external Chat Homes and Project folders. Move the old application data folder to a backup location before launching 0.1.4 with a fresh folder. Previous Bottega chats, settings, and installed App records are not imported automatically. See the [backup and setup instructions](../getting-started/README.md#upgrading-to-014).

### What's new

- **Sketch directly in your prompt.** Open **+ → Sketch** to draw, add text or one of eight shapes, and erase part of a stroke or shape. Undo, redo, colors, and stroke widths stay close to the canvas. Saved sketches remain editable in drafts and restored queues, then reach the Agent as white-background PNG images.
- **See Agent quota before choosing.** Settings and the Agent selector show available Codex, Claude Code, and Kimi quota windows, remaining amounts, and reset times. OpenCode clearly reports that unified quota information is unavailable. Returning to the app resumes an interrupted first query; sign-in, installation, and repair actions remain available beside Agent status.
- **Keep local work durable.** Chat, Base, Project, App, and attachment storage now share stronger consistency and recovery rules. Interrupted work preserves its recorded state. Normal use remains local and requires no cloud account; cloud synchronization is not included in this release.
- **Use consistent first-party Apps.** Development Kanban, Expense Tracker, Fitness Log, and Design Canvas now use React and shared interface conventions while retaining their existing data and workflows. The bundled Apps still require Bottega 0.1.3 or newer.
- **Choose your background entry.** One setting controls background operation. On macOS, choose a Bottega Logo icon, a monochrome menu-bar icon, or the notch task panel; Bottega remembers the choice and uses an icon when no notched display is available. Launch at login remains a separate option, and both startup options default to off.
- **Smoother everyday controls.** Settings navigation, font sizing, rename dialogs, App progress, failure recovery, and sharing dialogs now provide clearer actions and more consistent layouts. Sketch opens in a responsive square canvas with floating controls and an in-place loading state.

### Download and install

The assets below include macOS arm64 DMG/ZIP, Windows x64 NSIS, and Linux x64 AppImage installers. These builds are **unsigned and not notarized**. macOS remains the primary platform; native App isolation and full feature parity on Windows/Linux are still in progress.

**macOS (Apple silicon):** open the DMG and drag Bottega into Applications. For the unsigned download, remove its quarantine flag once in Terminal, then open Bottega:

```bash
xattr -rd com.apple.quarantine /Applications/Bottega.app
```

**Windows (x64):** run the installer. If SmartScreen blocks the unrecognized publisher, choose **More info → Run anyway**.

**Linux (x64):** make the AppImage executable and launch it:

```bash
chmod +x Bottega-0.1.4-linux-x86_64.AppImage
./Bottega-0.1.4-linux-x86_64.AppImage
```

Install and authenticate at least one supported local CLI before starting a conversation. Users on 0.1.0 or 0.1.1 must install 0.1.4 manually because those versions contain the earlier updater bug. The storage preparation above applies to every earlier version.

## 2026-09-08 — v0.1.3

**Before upgrading:** 0.1.3 uses a new local storage format. Chat databases from 0.1.2 and earlier cannot be opened or automatically migrated. Quit Bottega and back up the complete application data folder before upgrading. Keep that folder for use with the older version; starting 0.1.3 requires a fresh data folder, and previous Bottega chats and settings are not imported automatically. Follow the [backup and setup instructions](../getting-started/README.md#upgrading-to-013).

### What's new

- **Switch Agents within a chat.** Choose Codex, Claude Code, Kimi Code, or OpenCode for the next turn while the chat is idle. Keep one transcript with clear author and switch markers; the new Agent receives bounded context and can retrieve relevant chat history.
- **See whether an Agent is ready.** The composer shows installation, authentication, and runtime availability, with focused install, sign-in, and retry actions. Unavailable Agents no longer silently consume queued work, and recovery stays scoped to the affected chat or Agent.
- **Follow tasks outside the main window on macOS.** Independently enable launch at login, keep-running behavior after closing the window, and a floating task panel. The top-of-screen panel shows running tasks and requests needing attention, supports keyboard navigation, and opens the related chat. All three options are off by default.
- **Check App compatibility before installation.** All four first-party Apps now declare Bottega 0.1.3 as their minimum version. Installation, rebuilding, authorization, and activation check that requirement; an upgrade prompt can return to the original App candidate after restarting. Rejected updates preserve the existing working version and permissions.
- **Rename Apps without disturbing their work.** Changing an App's display name keeps its active version, source, data, and permissions intact.
- **Simplify adding Projects.** History-import choices appear when local CLI history is actually available, while Projects without history can be added directly.

### Downloads

macOS arm64 DMG/ZIP, Windows x64 NSIS, and Linux x64 AppImage installers are available below. These builds remain unsigned; follow the [first-launch instructions](../getting-started/README.md). macOS remains the primary platform; native App isolation and full feature parity on Windows/Linux are still in progress.

Users on 0.1.0 or 0.1.1 must download and install 0.1.3 manually because those versions contain the earlier updater bug. The storage preparation above applies to all earlier versions.

## 2026-09-05 — v0.1.2

**Upgrading from 0.1.0 or 0.1.1:** download and install 0.1.2 manually from the [Releases page](https://github.com/thinkingjimmy/Bottega/releases/tag/v0.1.2). Those versions contain the updater bug fixed here, so they cannot receive this fix through their existing update button.

- Fixed update downloads being blocked by an unavailable release compatibility key in unsigned builds. The sidebar now distinguishes automatic installation from manual download, shows download progress, and keeps a route to Releases or About when an update or background check fails.
- Rebuilt Fitness Log on the host React interface. It keeps 72 exercises, 17 muscle regions, five languages, animated demonstrations, training plans, and responsive light/dark layouts while using the shared component and data APIs.
- Made App data loading complete and recoverable. Base snapshots read every page and publish one consistent revision; Fitness plan submissions retain their original row IDs through retries and uncertain outcomes, preventing duplicate submissions.
- Fixed in-chat Find retry and navigation behavior. A failed page waits for an explicit retry, stale responses cannot replace a newer query, and switching chats no longer leaves the previous managed-worktree branch visible.
- Repaired App catalog startup for older schema versions: preserve the original bytes in a quarantine copy, then establish an empty current catalog. Corrupt current-format catalogs still require the explicit repair flow. Also tightened staged-turn recovery and Memory cancellation handling.
- Published macOS arm64 DMG/ZIP, Windows x64 NSIS, and Linux x64 AppImage installers. These builds remain unsigned; the existing [first-launch steps](../getting-started/README.md) still apply.

## 2026-09-04 — v0.1.1

- Published the v0.1.1 installers: a macOS arm64 DMG and ZIP, a Windows x64 NSIS installer, and a Linux x64 AppImage. These builds are still unsigned, so the one-time step each platform asks for on first launch is unchanged from 0.1.0 and stays documented in the [getting-started guide](../getting-started/README.md).
- Added Chat Fork. Any assistant reply can become the starting point of a new chat that inherits the history before it as read-only, and a fork on a Git Project can take a product-managed worktree of its own, so two branches of the same conversation stop overwriting one working copy.
- Grew the usage side of Apps. App Use now has a history panel, and an App can run in a standalone window instead of only inside the main one.
- Unified the App GUI Surface on one component set and one message channel, so App pages no longer each carry their own copy of the protocol.
- Fixed two real losses in imported history. Refreshing imported history now keeps each chat's Project membership, and re-importing a session rewrites its title search document instead of leaving a stale one behind.
- Reflowed onboarding. The three steps now adapt to narrow windows with container-aware capability rows, and the descriptions collapse to chat home, Agent, and extras, which keeps a readable line width at every width.
- Made chat-store maintenance repair drift instead of failing, and made a genuine failure actionable. A search projection that no longer matches the conversations it derives from is recomputed and rewritten through the same write path; when a self-check does fail, the Sidebar shows a typed notice with the way out and a report button that opens a prefilled GitHub issue.
- Gave the installed app its own data directory. A copy installed from a release now keeps its data in a `Bottega` directory instead of sharing the one a development build uses, so the two no longer rebuild each other's local state.
- Made an unreadable durable ledger recover instead of stopping startup. A ledger whose contents cannot be trusted is now quarantined under a new name for evidence and rebuilt empty, and the app continues to start.
- Advanced the bundled first-party App presets to their published commits.

## 2026-09-02 — v0.1.0

- Published the first installers. Bottega is now available from GitHub Releases as a macOS arm64 DMG and ZIP, a Windows x64 NSIS installer, and a Linux x64 AppImage, all built from this tagged commit. These builds are unsigned; the [getting-started guide](../getting-started/README.md) documents the one-time step each platform asks for on first launch.
- Rebuilt the Chat store on SQLite as its single source of truth. Conversations, turns, attachments, and facts now live in one durable local database instead of per-chat files, so a chat survives crashes, resumes without a rescan, and stops growing slower as it grows longer.
- Made long conversations cheap to open. The timeline, the chat outline, and in-chat find are paged: opening a chat with tens of thousands of turns costs the same as opening a short one, and scrolling back never reloads the whole transcript.
- Added gram-based full-text search across chats. Search now matches Chinese, Japanese, and Korean text as reliably as space-separated languages, and returns results from the same store the transcript reads.
- Unified imported history into one timeline. Sessions adopted from the local Codex, Claude Code, Kimi Code, and OpenCode CLIs now render in the same transcript as chats created in Bottega, with the same outline, search, and navigation, instead of a separate read-only view.
- Narrowed fact writes. A turn now updates only the facts it actually owns, so concurrent turns, Memory delivery, and Base writes no longer overwrite each other's state.
- Closed the merge-review findings. App Use only navigates after a completed receipt, so a rejected or recovering App never moves the window; revoking an App's Base access now happens as one atomic step, so access and lifecycle can no longer disagree; and App and Project pinning, Project appearance, and Settings navigation were reorganized so the sidebar always reflects what is actually open.

## 2026-08-29 — Scoped tools, Extensions, and Design Canvas source preview

- Published the current production source as a normal child commit of the clean public history, while keeping tests, development automation, and internal evidence in Bottega-Dev.
- Added exact-Project overrides for built-in tools and manual MCP servers. Each turn now freezes its effective tool plan, scoped revisions, runtime support, and sealed MCP configuration before side effects begin.
- Unified Extensions under `global | exact Project` ownership across management, Skills, App requirements, sessions, retained data, and deletion recovery. Exact-empty legacy Extension registries, lifecycle ledgers, and projection ledgers migrate forward; any legacy state carrying live or ambiguous authority remains fail closed.
- Added the bundled Bottega Design Canvas with self-contained HTML artboards, direction and history comparison, numbered visual review anchors, a sandboxed preview, and an Agent-side render check.
- Advanced all four bundled first-party App gitlinks to publicly reachable commits. This is a source preview, not the still-gated formal `v0.1.0` installer release.

## 2026-08-25 — Public source release

- Published Bottega under the MIT License with a clean, public-only Git history.
- Established a hard repository boundary: production desktop source and milestone documentation are public; tests, test data, the web application, internal evaluations, TODOs, development notes, weekly engineering logs, and repository automation remain in the development repository.
- Organized public documentation under docs/, with second-level getting-started, features, and changelog sections while keeping the root README as the GitHub entry page.
- Adopted **Bottega** as the product, package, window, build, ACP client, and exported-document identity.

## 2026-08-18 to 2026-08-23 — Durable collaboration

- Expanded workspace references from chats to files and Sections.
- Added durable image handoff between Sections and promotion of Subagent results into reusable, idle Sections.
- Unified local Skills management across Codex, Claude Code, Kimi Code, and OpenCode.
- Added searchable, read-only history federation and supported adoption for local Agent sessions.

## 2026-08-08 to 2026-08-23 — Memory with explicit consent

- Added managed local OpenViking and EverOS providers.
- Introduced Chat, Project-group, and personal sharing scopes with explicit consent and observable delivery state.
- Added rebuild, source, model-download progress, and trustworthy version switching.

## 2026-08-04 to 2026-08-21 — Apps, tools, and browser

- Added a multi-tab in-app browser controlled through in-process CDP.
- Grew the built-in tool platform to cover Sections, search, Base, files, Apps, and browser actions.
- Unified static, server, and Base-backed Apps with generation-bound permissions and a constrained GUI SDK.

## 2026-07-28 to 2026-08-23 — Base

- Introduced structured Chat and Project data with Table, List, Kanban, Map, Chart, and Gallery views.
- Added formulas, relations, attachments, row history, imports/exports, and capability-scoped App mutations.

## 2026-07-16 to 2026-08-09 — Desktop and multi-agent foundation

- Moved from a web prototype to an Electron desktop workspace.
- Connected Codex, Claude Code, Kimi Code, and OpenCode through local CLIs and ACP while preserving CLI credential ownership.
- Added streaming turns, approvals, Plan mode, message steering, Subagents, project workspaces, archive semantics, and OS-level file boundaries.
