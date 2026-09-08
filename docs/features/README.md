# Bottega features

[Documentation](../README.md) · [简体中文](./README.zh-CN.md)

Bottega treats an Agent conversation as the control surface for a durable local workspace. The following capability areas define the product.

## Multi-agent

- Connect Codex, Claude Code, Kimi Code, and OpenCode through one backend-neutral ACP transport.
- Switch the next Agent in an idle chat while preserving its transcript, per-reply authors, and bounded history handoff. Each provider keeps its own authentication and quota model.
- See runtime and authentication availability in the composer, with scoped installation, sign-in, and retry actions.
- Use Plan mode, live steering, queued messages, and visible tool activity without hiding backend differences.
- Create Sections and Subagents for parallel work, inspect their progress, pass bounded context between them, and promote useful results into durable Sections.
- Search and adopt supported local CLI histories without silently rewriting their original records.

## Base

- Give a Chat or Project a structured, row-backed data store beside the conversation.
- Present the same data through Table, List, Kanban, Map, Chart, and Gallery views.
- Support formulas, relations, filtering, sorting, attachments, row history, and CSV/JSON/XLSX exchange.
- Let Agents read and mutate Base data through explicit built-in tools and revision checks.
- Keep App writes capability-scoped so a GUI cannot silently gain unrestricted data access.

## App

- Install static, server, or Base-backed Apps from immutable Git revisions.
- Check each App's minimum Bottega version before installation, rebuilding, authorization, or activation; return to the original candidate after upgrading. All four first-party Apps require Bottega 0.1.3 or newer.
- Rename an App without rebuilding its active version or changing its data and permissions.
- Use the bundled Bottega Design Canvas to create self-contained HTML directions, compare live and historical versions, and send numbered visual anchors back to the Agent without granting the preview network or storage access.
- Use the bundled Fitness Log to explore 72 exercises across 17 muscle regions, view animated demonstrations, and manage training plans in five languages through the host React interface.
- Read complete, revision-consistent Base snapshots through the App SDK, with recoverable loading and explicit retry states.
- Bind Apps to Chats and Projects while keeping use, editing, and authorization separate.
- Expose an App GUI next to its structured data surface through a constrained product SDK.
- Grant read, insert, patch, delete, and attachment access independently for an exact App generation.
- Package and share reusable workflows without copying local credentials or private workspace state.

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

## Background activity on macOS

- Independently opt into launch at login, keep running after closing the main window, and a floating task panel; all are off by default.
- Follow running tasks and pending requests from the top of the screen, navigate with the keyboard, and return to the related chat.
- Use the available menu-bar entry to reopen or quit Bottega while background activity is enabled.

## Product foundations

These areas share the same design rules: local CLI credential sovereignty, capability-bounded file access, durable main-process ownership, explicit archive and deletion flows, and honest degradation when a backend cannot support a feature.
