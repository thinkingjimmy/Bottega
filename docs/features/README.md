# Bottega features

[Documentation](../README.md) · [简体中文](./README.zh-CN.md)

Bottega treats an Agent conversation as the control surface for a durable local workspace. The following capability areas define the product.

## Multi-agent

- Connect Codex through its native App Server; Claude Code, Kimi Code and OpenCode use their existing local CLI connections. Codex requires CLI 0.163.0-alpha.10.2 exactly. The conversation layout stays the same.
- Switch the next Agent in an idle chat while preserving its transcript, per-reply authors, and bounded history handoff. Each provider keeps its own authentication and quota model.
- See runtime and authentication availability in the composer, with scoped installation, sign-in, and retry actions.
- Read available Codex, Claude Code, Kimi, and OpenCode Go quota windows, remaining amounts, and reset times in Settings and the Agent selector, including rolling, weekly, and monthly periods.
- Choose a title-capable Agent and model in Settings › General › Title generation. This version's Codex connection does not support the required restricted, tool-free title execution. If Codex is selected, titles use the first message, the selected Agent and model stay saved, and the existing Settings row explains the fallback. You can select a supported Agent yourself; Bottega never switches Providers automatically.
- Use Plan mode, live steering, queued messages, and visible tool activity without hiding backend differences.
- Create Sections and Subagents for parallel work, inspect their progress, pass bounded context between them, and promote useful results into durable Sections.
- Search and adopt supported local CLI histories without silently rewriting their original records.
- Import Project history explicitly from Settings. Only installed Agents are included; reopening a Project does not scan again.
- Continue an imported conversation with the ordinary composer, whatever the profile it is opened in and whether or not its Project has a folder. One divider marks where the imported history ends.

### Codex command permissions

Codex uses its own sandbox and approval system. **Ask for approval** sends requests for additional command permissions to you. **Approve for me** sends them to Codex's automatic reviewer, which can approve or refuse them. A refusal does not switch the chat to Full access.

Both modes allow network access and ordinary reads outside the workspace. Writes are allowed in the workspace, declared extra directories and temporary directories; approved operations can receive additional access. **Full access** removes the workspace sandbox and does not ask for boundary approval. Operating-system and managed restrictions can still apply.

Bottega no longer adds its previous credential-path denials, protected internal paths or read-only subtrees to Codex commands. This includes the GitHub CLI configuration folder. Those files can be read, and approved operations or Full access can modify them. Tool grants and disabled Skills do not create a separate filesystem fence for commands.

Plan uses the selected permission mode; it does not make the filesystem read-only. Tasks that require strict read-only access, no network, no tools or Skill file isolation are unavailable through this Codex integration. Bottega explains the unsupported requirement before execution instead of silently relaxing it or switching a task fixed to Codex to another Provider.

Command output stays in the original command details. Background services show their command name, status and independent Stop above the Chat input. A failed Stop keeps its retry action, and other services continue running. Bottega continues to check tool access, Chat ownership and process lifecycle.

## Sketch

- Open **+ → Sketch** in the composer to draw, add text or eight kinds of shapes, and erase selected parts of strokes or shapes.
- Use undo/redo, color, and stroke-width controls on a responsive square canvas with floating tools.
- Reopen sketches from drafts and restored queues to keep editing; send the final white-background PNG through the normal image attachment flow.
- Manage Sketch as a built-in plugin, edit a copy through an Agent conversation, and move between saved versions. A failed build keeps the working version available; confirmed sketch source remains recoverable across restarts.

## Artifacts

- Open multiple Artifacts in the third-column tabs alongside other previews. Reopening activates the existing tab. Switching or closing waits for saving; failed saves keep the current tab and input.
- Select artboard elements without reloading live previews or losing form input. Compact Canvas controls share one floating toolbar and wrap to the available width.
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
- Planning and review require a Provider that can enforce their read-only and tool restrictions. Codex does not qualify for these strict roles in this release. Each step checks the selected Provider's capabilities; unsupported configurations stay unavailable with the reason, and a CLI version change triggers a fresh check.
- A change to a configuration or to the workflow applies only to runs that start afterwards.

## Agent configurations

- Keep reusable configurations in Settings › Agent configs. Start from Blank, Planner, Developer, or Reviewer, then choose the Provider and model, write the instructions and purpose, and request permissions (Ask for approval, Approve for me, or Full access), workspace access (Can change files or Read-only), and network access. A setting can be used only when the selected Provider can enforce it; unsupported combinations state why.
- Offer a configuration in all Projects or only in some.
- Choose models and reasoning levels from the same dropdowns as the composer. Loading failures offer Retry while keeping the list and unsaved edits.
- Select Skills and MCP tools and see the actual scope a run receives. Planning and review start only with a Provider that can enforce their read-only restrictions and exclusion of external MCP tools. Skills selection alone does not restrict Codex commands from reading files.
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
- Manage the Memory plugin entry separately from service authorization in Long-term Memory. Turning off the plugin retains your backend choice and data.
- Scope recall to one Chat, one Project group, or the user's personal workspace.
- Separate trusted product instructions from recalled, untrusted facts before sending context to an Agent.
- Show delivery, rebuild, source, version, and attention state instead of collapsing “unavailable” into “empty.”
- Pause or resume a computer's Memory from Web settings; an offline request stays pending until that computer applies it.
- Memory data stays local, but extraction may use your configured model service and incur its charges. Rebuilding existing history requires separate consent; a separately authorized rebuild can continue while ordinary capture is paused.

## Background activity

- Enable background operation with one setting; launch at login remains a separate option. Both default to off.
- Show or hide the menu-bar icon from Settings › General. Background tasks and the Dock have separate settings.
- Add the Tasks widget to Bottega Dock to follow running work and pending requests, use keyboard navigation and return to the related Chat. Privacy mode hides task content and counts.
- Reopen or quit Bottega through the available background entry.
- Download updates from the sidebar without leaving your current page. The sidebar and Settings share progress and a percentage. When a download finishes, choose Restart and update; an idle workspace does not trigger a restart.

## Bottega Dock

- Pin an available Bottega App from its menu and open or focus it in a separate window with its session and draft. Dock and sidebar pins are independent. Drag to reorder or drag out to unpin; menus open beside the selected icon.

**Alpha · macOS 27 · Apple silicon**

Dock remains **Alpha**. Replacement, recovery across logout or restart, and display/fullscreen combinations are still being validated. The plugin requires macOS 27.x and Apple silicon; the main application's requirements stay unchanged.

- On macOS 27.x with Apple silicon, keep the Apps you build in Bottega, your other Apps, Finder, Downloads, the Trash, and an AI-limits ring per Agent in one Dock. This requirement applies to the entire Dock plugin; the main application's requirements stay unchanged.
- Enable it from Settings › Plugins › Dock. Choose coexistence, or replacement after the installed app, native helper, recovery executable and bundled background-service configuration pass verification. Development and unsigned builds offer coexistence.
- Choose a mode and layout, then confirm the impact before replacement registers a background item or changes the system Dock. Existing coexistence settings and layouts are retained.
- If background approval is needed, open System Settings from Dock settings. Returning refreshes the status without automatic registration or takeover. If macOS cannot find the recovery registration, it may not have been created yet. After replacement consent, use Continue enabling to retry when installation verification passes and pending recovery is resolved.
- Replacement becomes active only after the recovery handshake, Dock entry and preference writes are confirmed. During preparation or active replacement, an unexpected native-bridge exit starts system Dock restoration and pauses replacement until explicit Resume. Failed restoration retains its record and Retry action. Independent recovery checks an interrupted restoration again after its short grace period instead of leaving it skipped indefinitely.
- Choose the primary display, prefer an external display, or select a specific display, then place the Dock on the left, bottom, or right edge. Display and edge preferences stay on this computer.
- Use the native glass appearance where supported, with a fallback background when it is unavailable. Turning the plugin off preserves your layout.
- Keep the same end-to-end encrypted Dock layout on every computer in your account; simultaneous changes merge, and real conflicts ask you.

- Keep new Dock preferences pinned on screen, or select auto-hide. Apps and widgets, other running Apps, and Downloads and Trash use separate groups.
- Return to Bottega from its own Dock icon, even when other open Apps are hidden. Quit a running native App through its normal save and cancel prompts.
- Browse Downloads by time with native thumbnails and file icons. Enlarge previews, return with Escape, and reveal files in Finder. Privacy masking also hides thumbnails.

### Custom Widgets

Create a Widget from Dock settings and continue editing in its source Chat. Preview and install with separate consent. Each instance has independent settings and Base/API grants. API credentials stay encrypted on this computer. Use standard or isolated details, approved actions and manual refresh. Receiving a private compiled package never grants execution or local data access automatically.

## Cloud Sync

- Keep synchronization optional: Bottega works without an account, setup never asks about one, and signing in uploads nothing until you confirm the first sync.
- Sign in through your system browser with Google, approve the request there by choosing the code Bottega shows on that computer, and let the desktop app pick the session up. Bottega never asks for that password.
- Unlock synced content with a separate sync password. A new one needs at least 12 characters with a letter and a number, at least 5 different characters, no long runs of repeated or sequential characters, and nothing from your email name, `bottega`, or the most common passwords; the form ticks each rule as you type. The content key is derived on your own device with Argon2id, and content is sealed with XChaCha20-Poly1305 before upload.
- Accept that there is no recovery: no recovery key, no approval from another device, no password reset, and no sync reset. A device that still holds the encryption key can continue to decrypt its content. The risk is stated and confirmed before the encrypted workspace is created.
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
- When sync is not connected, the remote composer explains how to sign in and finish sync on the computer.
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
- Back up the Bottega folder and complete application data before changing versions. 0.2.11 retains existing content and uses protocol 22; see the [upgrade guide](../getting-started/README.md#upgrading-to-0211), including historical migration notes for older releases.

## Bundled runtime and Agent boundaries

- Run Bottega's own tools — the built-in MCP server, the App interface compiler, the Agent adapters, and Apps' Node scripts — on a Node 24 runtime shipped inside the app, never on a Node from your PATH. App commands that use npm, pnpm, or yarn, and MCP servers you start with npx, still use your own Node.
- Each Agent CLI keeps its own sign-in. Codex command permissions can allow access to local credential files, including the GitHub CLI configuration folder; see [Codex command permissions](#codex-command-permissions).
- Reviewing a plan does not change the selected execution mode. Codex can still request additional command permissions under that mode. Browser tools read only the Chat's own tabs and the tab you selected.
- Refuse unsafe locations for the Bottega folder, such as your home folder or the root of a volume.

## Product foundations

These areas share the same design rules: local CLI authentication, capability checks for product tools, Provider-specific command permissions, durable main-process ownership, and explicit archive and deletion flows. Unsupported requirements are reported before execution.
