# Bottega features

[Documentation](../README.md) · [简体中文](./README.zh-CN.md)

Bottega treats an Agent conversation as the control surface for a durable local workspace. Four capability areas define the product.

## Multi-agent

- Connect Codex, Claude Code, Kimi Code, and OpenCode through one backend-neutral ACP transport.
- Keep each task bound to a stable Agent session while preserving the provider's own authentication and quota model.
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
- Bind Apps to Chats and Projects while keeping use, editing, and authorization separate.
- Expose an App GUI next to its structured data surface through a constrained product SDK.
- Grant read, insert, patch, delete, and attachment access independently for an exact App generation.
- Package and share reusable workflows without copying local credentials or private workspace state.

## Memory

- Keep long-term Memory off by default and require explicit consent before recall or capture.
- Choose a managed local OpenViking or EverOS backend.
- Scope recall to one Chat, one Project group, or the user's personal workspace.
- Separate trusted product instructions from recalled, untrusted facts before sending context to an Agent.
- Show delivery, rebuild, source, version, and attention state instead of collapsing “unavailable” into “empty.”

## Product foundations

These four areas share the same design rules: local CLI credential sovereignty, capability-bounded file access, durable main-process ownership, explicit archive and deletion flows, and honest degradation when a backend cannot support a feature.
