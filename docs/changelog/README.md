# Changelog

[Documentation](../README.md) · [简体中文](./README.zh-CN.md)

This file records product milestones, not internal implementation iterations. Dates describe when each capability reached its first coherent product form.

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
