# Bottega features

[Documentation](../README.md) · [简体中文](./README.zh-CN.md)

Bottega treats an Agent conversation as the control surface for a durable local workspace. The following capability areas define the product.

## Multi-agent

- Connect Codex, Claude Code, Kimi Code, and OpenCode through one backend-neutral ACP transport.
- Switch the next Agent in an idle chat while preserving its transcript, per-reply authors, and bounded history handoff. Each provider keeps its own authentication and quota model.
- See runtime and authentication availability in the composer, with scoped installation, sign-in, and retry actions.
- Read available Codex, Claude Code, Kimi, and OpenCode Go quota windows, remaining amounts, and reset times in Settings and the Agent selector, including rolling, weekly, and monthly periods.
- Name one explicit Agent and model for background title generation; all four Agents can be chosen, and unavailable ones state why instead of disappearing.
- Use Plan mode, live steering, queued messages, and visible tool activity without hiding backend differences.
- Create Sections and Subagents for parallel work, inspect their progress, pass bounded context between them, and promote useful results into durable Sections.
- Search and adopt supported local CLI histories without silently rewriting their original records.
- Continue an imported conversation with the ordinary composer, whatever the profile it is opened in and whether or not its Project has a folder. One divider marks where the imported history ends.

## Sketch

- Open **+ → Sketch** in the composer to draw, add text or eight kinds of shapes, and erase selected parts of strokes or shapes.
- Use undo/redo, color, and stroke-width controls on a responsive square canvas with floating tools.
- Reopen sketches from drafts and restored queues to keep editing; send the final white-background PNG through the normal image attachment flow.
- Manage Sketch as a built-in plugin, edit a copy through an Agent conversation, and move between saved versions. A failed build keeps the working version available; confirmed sketch source remains recoverable across restarts.

## Artifacts

- Render Agent visualizations inline in the transcript, expand them, or open them in the Chat side panel.
- Preview, save, reveal, or Quick Look the files a turn produced, and import a worksheet into a Base with an explicit row-merge confirmation.
- Open Claude artifacts in the built-in browser, which reuses the existing persistent browser partition.
- Keep every preview sandboxed: an artifact frame gets no network or storage access, and oversized, interrupted, or invalid artifacts state the reason instead of rendering.
- Read artifacts produced on another computer once that computer has synced them, with an explicit waiting state until then.

## Base

- Give a Chat or Project a structured, row-backed data store beside the conversation.
- Present the same data through Table, List, Kanban, Map, Chart, and Gallery views.
- Support formulas, relations, filtering, sorting, attachments, row history, and CSV/JSON/XLSX exchange.
- Let Agents read and mutate Base data through explicit built-in tools and revision checks.
- Keep App writes capability-scoped so a GUI cannot silently gain unrestricted data access.

## Workflows

- Turn on the built-in **Plan · Develop · Review** workflow for a Project's Base, from the Base's ⋯ menu (**Set up a workflow…**) or from Project settings › Workflows. Choose which Agent configuration plans, develops, and reviews; you confirm the plan and decide on the result.
- The Base gains a locked **Stage** column (Plan, Develop, Review, Done) and an **Acceptance criteria** column, plus a **Board · by Stage** view when there is room. Your existing columns are not changed.
- Start a run from a row's ▶ **Run workflow**. Accept the plan or end the run; then accept the result, accept it with an exception and a reason, send it back for rework — keeping the plan or planning again — or end it.
- Pause, continue, cancel, or force-stop a run, retry a step, or check the result of a step whose outcome is unknown, and open the Chat behind any step. A run waiting on you reminds you when it starts waiting and again at 23 hours, and pauses at 24 hours.
- Planning and review always run in a read-only workspace. Codex, Claude Code, Kimi Code, and OpenCode can take workflow steps when their installed CLI passes the capability check. Unavailable configurations stay in the list with the reason, and a CLI version change triggers a fresh check.
- A change to a configuration or to the workflow applies only to runs that start afterwards.

## Agent configurations

- Keep reusable configurations in Settings › Agent configs. Start from Blank, Planner, Developer, or Reviewer, then choose the Provider and model, write the instructions and purpose, and set permissions (Ask for approval, Approve for me, or Full access), the workspace (Can change files or Read-only), and network access.
- Offer a configuration in all Projects or only in some.
- Choose models and reasoning levels from the same dropdowns as the composer. Loading failures offer Retry while keeping the list and unsaved edits.
- Select Skills and MCP tools and see the actual scope a run receives. Planning and review keep their read-only restrictions and do not receive external MCP tools.
- Decide whether a workflow may read long-term Memory; workflow runs do not capture new Memory.
- Synchronize configurations with your account; a saved change applies to runs that start afterwards.

## Plugins

- Open Settings › Plugins › All plugins to browse cards and read each plugin's capabilities, dependencies, source, and usage. Enabled plugins with settings have their own sidebar entries; Apps remain in the Apps page.
- Manage Base (always on), the four built-in Providers, Workflow, Sketch, Memory, and Dock through the same plugin settings. Turning a plugin off keeps its saved content and settings; affected features explain the missing dependency.
- Review the source, permissions, and signature of an eligible plugin package before confirming installation on its owning computer. Uninstalling a package and deleting its retained data are separate choices.
- Third-party Provider modules are not enabled in this release. The four built-in Providers remain the available production choices; no public plugin marketplace or SDK publication is included.

## App

- Install static, server, or Base-backed Apps from immutable Git revisions.
- Use React interfaces across the bundled Expense Tracker, Fitness Log, and Design Canvas, with shared interface conventions.
- Check each App's minimum Bottega version before installation, rebuilding, authorization, or activation; return to the original candidate after upgrading. All three bundled Apps require Bottega 0.1.3 or newer.
- Rename an App without rebuilding its active version or changing its data and permissions.
- Turn an App off or back on from the desktop or Web. Turning it off explains the running work it will stop, retains queued work, and keeps its Base data editable. Destructive actions have their own confirmation.
- Use the bundled Bottega Design Canvas to create self-contained HTML directions, compare live and historical versions, and send numbered visual anchors back to the Agent without granting the preview network or storage access.
- Use the bundled Fitness Log to explore 72 exercises across 17 muscle regions, view animated demonstrations, and manage training plans in five languages through the host React interface.
- Read complete, revision-consistent Base snapshots through the App SDK, with recoverable loading and explicit retry states.
- Bind Apps to Chats and Projects while keeping use, editing, and authorization separate.
- Expose an App GUI next to its structured data surface through a constrained product SDK.
- Grant read, insert, patch, delete, and attachment access independently for an exact App generation.

## Tools and Extensions

- Treat Settings › Tools as the global default, then override built-in tools and manual MCP servers for one exact Project.
- Freeze the effective tool and MCP plan before a turn starts so retries and resumed sessions cannot silently adopt newer permissions.
- Install Extensions globally or for one exact Project; Skills, App requirements, sessions, retained data, and deletion cleanup follow the same scoped owner.
- Keep MCP secrets in main-process-only sealed storage and fail closed when durable ownership evidence is incomplete.

## Memory

- Keep long-term Memory off by default and require explicit consent before recall or capture.
- Choose a managed local OpenViking or EverOS backend.
- Scope recall to one Chat, one Project group, or the user's personal workspace.
- Separate trusted product instructions from recalled, untrusted facts before sending context to an Agent.
- Show delivery, rebuild, source, version, and attention state instead of collapsing “unavailable” into “empty.”
- Pause or resume a computer's Memory from Web settings; an offline request stays pending until that computer applies it.
- Memory data stays local, but extraction may use your configured model service and incur its charges. Rebuilding existing history requires separate consent; a separately authorized rebuild can continue while ordinary capture is paused.

## Background activity

- Enable background operation with one setting; launch at login remains a separate option. Both default to off.
- On macOS, choose a Bottega Logo icon, a monochrome menu-bar icon, or the notch task panel. The selection is remembered, with an icon available when no notched display is connected. Windows and Linux use their system tray.
- Follow running tasks and pending requests in the notch panel, navigate with the keyboard, and return to the related chat.
- Reopen or quit Bottega through the available background entry.

## Bottega Dock

- On macOS 15 or later with Apple silicon, keep the Apps you build in Bottega, your other Apps, Finder, Downloads, the Trash, and an AI-limits ring per Agent in one Dock.
- Enable it from Settings › Plugins › Dock. 0.2.0 supports coexistence with the system Dock; system Dock replacement is unavailable in this prerelease.
- Choose the primary display, prefer an external display, or select a specific display, then place the Dock on the left, bottom, or right edge. Display and edge preferences stay on this computer.
- Use the native glass appearance where supported, with a fallback background when it is unavailable. Turning the plugin off preserves your layout.
- Keep the same end-to-end encrypted Dock layout on every computer in your account; simultaneous changes merge, and real conflicts ask you.

## Cloud Sync

- Keep synchronization optional: Bottega works without an account, setup never asks about one, and signing in uploads nothing until you confirm the first sync.
- Sign in through your system browser with Google, approve the request there by choosing the code Bottega shows on that computer, and let the desktop app pick the session up. Bottega never asks for that password.
- Unlock synced content with a separate sync password. A new one needs at least 12 characters with a letter and a number, at least 5 different characters, no long runs of repeated or sequential characters, and nothing from your email name, `bottega`, or the most common passwords; the form ticks each rule as you type. The content key is derived on your own device with Argon2id, and content is sealed with XChaCha20-Poly1305 before upload.
- Accept that there is no recovery: no recovery key, no approval from another device, no password reset, and no sync reset. The risk is stated and confirmed before the encrypted workspace is created.
- Keep one encrypted workspace per account. The first computer sets the sync password; every later computer, browser, and phone enters it. Only a desktop can set it.
- Keep the sync area to three things: sign-in state, this computer's name, and Sign out. Signing out stops publishing and stops accepting commands without deleting anything; removing this computer's cloud copies is a separate action, and deleting the account is separate again.
- Watch the first upload honestly: the Sync row counts real uploaded bytes, and the smallest conversations go first so the count starts moving in seconds instead of minutes.
- Synchronize Chats with their tool activity, Subagents and attachments, Bases and their App records, Project metadata, and Skills. Conflicting edits keep both candidates with an explicit decision instead of silently overwriting.
- Keep working while offline or paused: local content stays readable, queued work resumes under the same identity, and a wrong password or a lost connection never deletes local data or cloud keys.

## Cloud Web and remote control

- Read Chats in a browser at [app.getbottega.app](https://app.getbottega.app), with the same transcript, tool activity, Subagents, and attachments as the desktop.
- Search chat titles and the last seven days of message bodies. Search runs in the browser against decrypted content; queries and plain-text indexes are never uploaded.
- Work with Bases through the same six views, read and edit synced App records, restore or delete archived items, and manage devices, sessions, and preferences.
- Follow workflow runs on a Project's Base: start a run, confirm the plan, decide on the result, send it back for rework, pause, continue, cancel, or retry a step. The **Needs you** bell lists everything waiting for your decision, with complete step reports and evidence available from the run. Workflow and Agent configuration setup stays on the desktop; plugin requests that require a computer are confirmed there.
- Stay unlocked on a browser you trust, or lock it again at any time. Static and Base-backed App interfaces open in the browser as well; server App interfaces, the in-app Browser, and local tools remain on the computer that owns them.
- Use a phone browser: layout, touch targets, sheets, and drag interactions adapt below 768px. App and Base menus adapt to narrow screens and keep offline status beside the affected action.
- Opt in to browser notifications where the browser supports them. Delivery depends on the browser, operating system permissions, and device state.
- Treat signing in as remote control: a signed-in computer publishes its Projects and Chats to the account and accepts commands for them. There is no second switch in the product.
- Switch computers from one strip at the top of the sidebar, shared by Cloud Web, phones, and the desktop. It appears once the account holds more than one computer, shows each computer's presence, and puts this computer first on a desktop. The sidebar below it is that computer's.
- Rename a computer in Settings; a name another computer already holds is refused, and a new computer that arrives with a taken name is registered with a numeric suffix.
- Drive the selected computer while it is awake: send a message, watch live output, Stop, approve or reject permission requests, answer questions, steer, and follow up. The target must be online, unlocked, and on a matching protocol version.
- Let several devices hold one conversation: messages queue in arrival order, a repeated Stop counts once, and the second answer to the same permission request reads "Handled on *computer*" as one line rather than an error.
- Work with another computer's Project: it carries a globe mark and the owning computer's name, offers no folder or path, and a Chat created under it is created, run, and stored over there. On the desktop, pin one into this computer's sidebar; pinning copies nothing, unpinning changes nothing for the owner, and a Project the owner deletes or archives leaves a marked row you can unpin.
- Keep record writes working while a computer is away: renaming, archiving, reordering, editing a Base row, and writing an App record all succeed and reconcile when it wakes. Execution — send, Stop, approve, answer, steer, delete a Chat — is greyed in place with the reason, keeps your draft, and recovers on its own when the computer returns.
- Bottega keeps a service-level switch that can turn remote control off for everyone. While it is off, browser Chats are read only; reading a transcript and watching a running turn still work.

## Local storage and your Bottega folder

- Keep Chat, Base, Project, App, and attachment data under durable local ownership, with interrupted-operation recovery and explicit retention rules.
- Keep readable content in one Bottega folder chosen during setup: Chat transcripts, original attachments, saved artifacts, Chat Home files, Project details, Base records, App source, and Skills. Account settings, encryption keys, device permissions, and execution records stay in each computer's application data directory.
- Back up by quitting Bottega and copying the whole folder; a copy made while it is running is a best-effort recovery source that reports its gaps. File-synchronization folders such as iCloud Drive and Dropbox are unsupported.
- Rebuild conversations from the folder when the local Chat database cannot be opened, while the previous database is preserved.
- Move the folder from Settings › General, including to another disk, with every saved path following it; or erase all of Bottega's data on this computer while cloud data stays in your account.
- Keep a Bottega folder with the computer that published it: the same computer takes it back after a reinstall, a cleared data folder, or a new profile with nothing to confirm, and another computer is refused by name. A folder that has never synchronized opens anywhere.
- Back up the Bottega folder and complete application data before changing versions. 0.2.0 retains existing cloud content and requires protocol 14; see the [upgrade guide](../getting-started/README.md#upgrading-to-020), including historical migration notes if you are upgrading from an older release.

## Bundled runtime and Agent boundaries

- Run Bottega's own tools — the built-in MCP server, the App interface compiler, the Agent adapters, and Apps' Node scripts — on a Node 24 runtime shipped inside the app, never on a Node from your PATH. App commands that use npm, pnpm, or yarn, and MCP servers you start with npx, still use your own Node.
- Keep the GitHub CLI's configuration folder out of every Agent turn; each Agent CLI keeps its own sign-in.
- Never raise an Agent's permissions when a plan is reviewed, and let browser tools read only the Chat's own tabs and the tab you selected.
- Refuse unsafe locations for the Bottega folder, such as your home folder or the root of a volume.

## Product foundations

These areas share the same design rules: local CLI credential sovereignty, capability-bounded file access, durable main-process ownership, explicit archive and deletion flows, and honest degradation when a backend cannot support a feature.
