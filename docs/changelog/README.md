# Changelog

[Documentation](../README.md) · [简体中文](./README.zh-CN.md)

This file records product milestones, not internal implementation iterations. Dates describe when each capability reached its first coherent product form.

## 2026-08-29 — Scoped tools, Extensions, and Design Canvas source preview

- Published the current production source as a normal child commit of the clean public history, while keeping tests, development automation, and internal evidence in Bottega-Dev.
- Added exact-Project overrides for built-in tools and manual MCP servers. Each turn now freezes its effective tool plan, scoped revisions, runtime support, and sealed MCP configuration before side effects begin.
- Unified Extensions under `global | exact Project` ownership across management, Skills, App requirements, sessions, retained data, and deletion recovery. Exact empty v2-v5 Extension registries and terminal legacy MCP-plan ledgers migrate forward; any legacy state carrying live or ambiguous authority remains fail closed.
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
