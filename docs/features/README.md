# Bottega features

[Documentation](../README.md) · [简体中文](./README.zh-CN.md)

Bottega treats an Agent conversation as the control surface for a durable local workspace. The following capability areas define the product.

This guide describes **0.4.2/protocol 27** source behavior. Installer availability and actual acceptance scope come from the [latest stable Release](https://github.com/thinkingjimmy/Bottega/releases/latest).

## Multi-agent

- Connect Codex through its native App Server; Claude Code, Kimi Code and OpenCode use their existing local CLI connections. Ordinary Codex Chat checks actual native protocol and required capabilities rather than one exact CLI version. Generated native titles and isolated editor tasks retain separate CLI qualification. The conversation layout stays the same.
- Switch the next Agent in an idle chat while preserving its transcript, per-reply authors, and bounded history handoff. Each provider keeps its own authentication and quota model.
- See runtime and authentication availability in the composer, with scoped installation, sign-in, and retry actions.
- Read available Codex, Claude Code, Kimi and OpenCode Go quota windows, remaining amounts and reset times in Settings and the Agent selector. Codex quota reads and optional update notices are independent of ordinary Chat version admission; unavailable limits are not invented.
- Choose a title-capable Agent and model in Settings › General › Title generation. Qualified Codex titles use the selected model in a separate ephemeral, read-only task with no tools or workspace instructions. If title execution is unavailable, Bottega keeps the selected Agent and model and uses the first message; it never switches Providers automatically.
- Use Plan mode, live steering, queued messages and visible tool activity without hiding backend differences. Queued first messages continue when the runtime becomes available; long histories load in small batches and keep the reading position, while code highlighting runs in a shared worker.
- Create Sections and native Provider subagents for parallel work, inspect their progress, pass bounded context between them, and promote useful results into durable Sections. Provider settings and ordinary Chat forks remain available.
- Search and adopt supported local CLI histories without silently rewriting their original records.
- Import Project history explicitly from Settings. Only installed Agents are included; reopening a Project does not scan again.
- Continue an imported conversation with the ordinary composer, whatever the profile it is opened in and whether or not its Project has a folder. One divider marks where the imported history ends.

### Codex command permissions

Codex uses its own sandbox and approval system. **Ask for approval** sends requests for additional command permissions to you. **Approve for me** sends them to Codex's automatic reviewer, which can approve or refuse them. A refusal does not switch the chat to Full access.

Both modes allow network access and ordinary reads outside the workspace. Writes are allowed in the workspace, declared extra directories and temporary directories; approved operations can receive additional access. **Full access** removes the workspace sandbox and does not ask for boundary approval. Operating-system and managed restrictions can still apply.

Bottega no longer adds its previous credential-path denials, protected internal paths or read-only subtrees to Codex commands. This includes the GitHub CLI configuration folder. Those files can be read, and approved operations or Full access can modify them. Tool grants and disabled Skills do not create a separate filesystem fence for commands.

Plan uses the selected permission mode; it does not make the filesystem read-only. Ordinary Codex Chat does not provide generic strict read-only, network-off, no-tool or Skill-isolation roles. Qualified title generation and isolated editor tasks use their own purpose-specific restricted execution. Other unsupported requirements are explained before execution, without silently relaxing them or switching a task fixed to Codex to another Provider.

Command output stays in the original command details. Background services show their command name, status and independent Stop above the Chat input. A failed Stop keeps its retry action, and other services continue running. Bottega continues to check tool access, Chat ownership and process lifecycle.

## Sketch

- Open **+ → Sketch** in the composer to draw, add text or eight kinds of shapes, and erase selected parts of strokes or shapes.
- Use undo/redo, color, and stroke-width controls on a responsive square canvas with floating tools.
- Reopen sketches from drafts and restored queues to keep editing; send the final white-background PNG through the normal image attachment flow.
- Manage Sketch as a built-in plugin, edit a copy through an Agent conversation, and move between saved versions. A failed build keeps the working version available; confirmed sketch source remains recoverable across restarts.

## Artifacts

- Open native Canvas v3, Slides v4, Design System and Dashboard work in dedicated editors. Dashboard uses fixed CSV, TSV or JSON sources. Authored pages and component examples remain isolated from host write access.
- Keep multiple works in third-column tabs alongside other previews. Reopening activates the existing tab. Switching or closing waits for saving; a failed save keeps the tab and unsent input.
- Add element, region or whole-work instructions to the original Chat draft while keeping its text and attachments. Send normally. Sent comments retain exact instructions and target versions, and applied results link back to saved versions in the same Chat.
- Use supported isolated editing with separate CLI qualification and explicit result confirmation. Unknown saves recover their original operation without another model call. Unsupported execution stays unavailable with a reason.
- Browse fixed read-only History previews, authors and changes. Restore selected changes or a complete version while preserving unrelated current work. Resume a paused restore under the original operation.
- Export complete project ZIPs with source, resources, comments and full supported history. Open them in the fixed original tool or import them into a new Bottega workspace with fresh permissions.
- Use independent dataviz guidance and palette validation without opening an editor. Warnings and failures retain their original rule results.
- Keep retired-format files and snapshots unchanged. Unsupported cards do not open an editor or restore write access.
- Render Agent visualizations inline, expand them or open them in the side panel. Preview, save, reveal or Quick Look produced files; worksheet imports into Base require row-merge confirmation.
- Open Claude artifacts in the built-in browser with its existing persistent partition. Sandboxed previews receive no host write capability; invalid or oversized inputs report their reason.
- Read synchronized work on another device once its owning computer has published the required bytes. Encrypted browser views retain unsent input and explicit conflict choices.

## Base

- Give a Chat or Project a structured, row-backed data store beside the conversation.
- Present the same data through Table, List, Kanban, Map, Chart, and Gallery views.
- Support formulas, relations, filtering, sorting, attachments, row history, and CSV/JSON/XLSX exchange.
- Let Agents read and mutate Base data through explicit built-in tools and revision checks.
- Keep App writes capability-scoped so a GUI cannot silently gain unrestricted data access.
- Edit former Workflow Stage and Acceptance criteria columns as ordinary fields. Their IDs, options, values and view references remain.

## Plugins

- Browse official features, existing Apps, personal plugins and external Host Packages in one catalog. Read capabilities, dependencies, source and runtime status; external adapters keep their original settings and data owners.
- Combine pages, Widgets, composer extensions, tools, services and Chat modes in one package. Ordinary use does not create a source Project. First authoring creates or reuses its Library Project; multiple Chats can work in that source.
- Install dependencies with bundled Node and pnpm. Dependency scripts stay off by default and need explicit approval when required. Valid builds update local instances automatically; failed builds keep usable code. Recover code versions without reverting current data.
- Choose a Chat mode before the first message. The mode then stays fixed; Agent and model selection keep their existing behavior.
- Share explicitly to enable encrypted source/runtime delivery for one plugin and account. Later versions use that consent. Receiving computers review and accept complete packages without installing dependencies or compiling them.
- Backend plugins run trusted local code and can use host credentials. Plugin switches control Bottega contributions; they do not disable a Provider's own native tools. Arbitrary native modules and remote scripts are outside the supported compatibility scope.
- Turning a plugin off keeps content and settings. Missing dependencies suspend affected contributions and explain why. Code recovery, plugin removal and data deletion retain their separate owners.
- Third-party Provider modules are not enabled in this release. The four built-in Providers remain the available production choices; no public plugin marketplace or SDK publication is included.

## App

- Install static, server, or Base-backed Apps from immutable Git revisions.
- Use React interfaces across the bundled Expense Tracker and Fitness Log, with shared interface conventions.
- Check each App's minimum Bottega version before installation, rebuilding, authorization, or activation; return to the original candidate after upgrading. Both bundled Apps require Bottega 0.1.3 or newer.
- Rename an App without rebuilding its active version or changing its data and permissions.
- Turn an App off or back on from the desktop or Web. Turning it off explains the running work it will stop, retains queued work, and keeps its Base data editable. Destructive actions have their own confirmation.
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

Controlled-version checks cover macOS 26.4.1 and 27.0.0 on a macOS 27 Apple silicon host. Physical macOS 26, exact signed Dock replacement, approval, restoration, login/reboot and display combinations retain separate acceptance.

- Pin an available Bottega App from its menu and open or focus it in a separate window with its session and draft. Dock and sidebar pins are independent. Drag to reorder or drag out to unpin; menus open beside the selected icon.

**Alpha · macOS 26 or 27 · Apple silicon**

Dock remains **Alpha**. Replacement, recovery across logout or restart, and display/fullscreen combinations are still being validated. The plugin requires macOS 26.x or 27.x and Apple silicon; the main application's requirements stay unchanged.

- On macOS 26.x or 27.x with Apple silicon, keep the Apps you build in Bottega, your other Apps, Finder, Downloads, the Trash, and an AI-limits ring per Agent in one Dock. This requirement applies to the entire Dock plugin; the main application's requirements stay unchanged.
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

Create a Widget from Dock settings and continue editing in its plugin source Project. Previewing remains optional. Valid local builds update installed instances automatically; failed builds keep the working version. Each instance has independent settings and Base/API grants. API credentials stay encrypted on this computer. Use standard or isolated details, approved actions and manual refresh. Share explicitly before enabling delivery to your account; receiving a compiled package never grants execution or local data access automatically.

### Weather

Weather is preinstalled. Add it from Settings or Dock Add, choose current location or search for a city, and keep independent instances for different places. No Agent, account or API key is required. View temperature, conditions, feels-like temperature, humidity, observation time and data source. Refresh manually or every 15 minutes while visible. Hiding or disabling it stops requests; failed reads keep marked last-good data for the same place. Current-location coordinates stay local. City selection is available when system location is off. Successful native location authorization retains its separate acceptance scope.

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
- Confirm plugin requests that require a computer on that computer.
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
- Back up the Bottega folder and complete application data before changing versions. 0.4.2 uses protocol 27 and retires Workflow, standalone Agent configurations and Bottega Team. Read the [removal and upgrade scope](../getting-started/README.md#upgrading-to-042), including the data that release maintenance removes.

## Bundled runtime and Agent boundaries

- Run Bottega's own tools — the built-in MCP server, the App interface compiler, the Agent adapters, and Apps' Node scripts — on a Node 24 runtime shipped inside the app, never on a Node from your PATH. App commands that use npm, pnpm, or yarn, and MCP servers you start with npx, still use your own Node.
- Plugin dependency installs and builds use bundled Node and pnpm; they do not require a package manager on your PATH. This does not change the Node used by external App commands or MCP servers.
- Each Agent CLI keeps its own sign-in. Codex command permissions can allow access to local credential files, including the GitHub CLI configuration folder; see [Codex command permissions](#codex-command-permissions).
- Reviewing a plan does not change the selected execution mode. Codex can still request additional command permissions under that mode. Browser tools read only the Chat's own tabs and the tab you selected.
- Refuse unsafe locations for the Bottega folder, such as your home folder or the root of a volume.

## Product foundations

These areas share the same design rules: local CLI authentication, capability checks for product tools, Provider-specific command permissions, durable main-process ownership, and explicit archive and deletion flows. Unsupported requirements are reported before execution.

See the [component licenses](../README.md#component-licenses) for the Canvas, Slides and Design System Community License terms and other bundled notices.
