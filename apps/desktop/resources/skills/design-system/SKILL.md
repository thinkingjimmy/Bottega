---
name: design-system
displayName: Artifact Design System
description: Capture authorized local source into a versioned Bottega design system. Use for token and component inventories, explicit source updates, literal overrides, controlled component mounts and fixed bindings to Artifact designs.
requires: "tools: design_check, design_commit, design_system_extract, design_system_diff, design_system_update, design_system_bind, design_system_compile"
---

<!--
  [INPUT]: Bottega system schemas and issued extraction, update, compile and binding tools; explicitly selected current source
  [OUTPUT]: A saved system with exact source inventory, explicit update decisions and bounded fixed consumers
  [POS]: Bottega Artifact Design System entry; selects capture, review, mount and consumption operations
-->

# Artifact Design System

A Bottega system is an Artifact document under `design-systems/<systemId>`. Its tokens,
captured source, component inventory and overview share one saved revision. Use the system
named by the user; its existence does not grant access to the repository named in old metadata.

| Work item | Read |
| --- | --- |
| Understand saved files, limits or generated CSS | [System data](references/format.md) |
| Capture source, inspect inventory or apply a source update | [Source operations](references/from-code.md) |
| Explain coverage, theme values or component usability | [System review](references/craft.md) |
| Prepare an explicit follow-up or bind a consumer | [Task handoff](references/handoff.md) |

## Choose the operation from the current state

For source capture, supply the actual `systemId` and explicit workspace-relative `sources`.
An extraction without `save` returns inventory pages; read all required sections and cursors.
A new system can be saved by extraction with `save:true`, a fresh requestId and
`expectedRevision:0`. This cannot replace an existing system.

For an existing system, read the current Artifact identity and saved source set. A source update
starts with `design_system_diff`; a user literal override uses `design_system_update`'s finite
JSON value. These are different operations. Do not hide source conflicts by rebuilding the
directory or editing generated CSS.

A mutation carries the current artifactId, expectedRevision and readSetDigest plus one original
requestId. The host supplies Chat, incarnation and generation from the turn lease. Keep the
original parameters after an unknown result. Follow the document recovery contract linked from
the source operations reference; an unresolved file effect is not permission to overwrite.

## Separate inventory, mount and consumption

An inventoried component has captured source and a reason for its current mode. To attempt a
mount, use `design_system_compile` for that exact component and entry, with supported props.
The host uses its locked local toolchain. A static result remains static; a successful mount
still needs image inspection and separate interaction checks. Use `design_render_check` only
if it is actually issued, or inspect returned local evidence with an available image tool.

Bind a consumer through `design_system_bind` with its current design Artifact and the selected
systemId/targetRevision. That saves a new consumer revision with a copied closure. Later system
updates do not update that consumer. The Page or board currently in view is not a system version.

## Report the saved coverage

State the saved revision, source digest/version basis, captured inventory and unsynced items.
Keep unsupported literals and absent dependencies visible. A source font change, mounted image
or generated stylesheet must not be described as verified in every consumer.

The system uses the same Artifact authority, durable journal, CAS, semantic history and recovery
as a design. Retained/historical references do not authorize source mutation. Artifact refusal
must preserve the user's pending input; do not open another Chat or send a follow-up automatically.

[Source records and retained licenses](references/PROVENANCE.md) identify historical adaptations
and the current Bottega contract writing pass. They do not establish a commercial agreement or
clean-room history.
