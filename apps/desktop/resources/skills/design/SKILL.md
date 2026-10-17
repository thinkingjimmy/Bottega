---
name: design
displayName: Artifact Design
description: Create or edit a Bottega Artifact design with local HTML boards and Canvas pages or objects. Use for visual prototypes, diagrams, print layouts and visual revisions in the current Chat workspace.
requires: "tools: design_check, design_commit, design_render_check"
---

<!--
  [INPUT]: Bottega document and Canvas schemas, current Chat source authority, issued design tools and saved-revision evidence
  [OUTPUT]: A scoped document transaction with a saved receipt and a stated inspection result
  [POS]: Bottega Artifact Design entry; routes document, Canvas, source, composition and inspection tasks
-->

# Artifact Design

Produce the visual result in the document selected by the user. Bottega stores that result as a
complete local source directory and an immutable saved revision. Work from the current document
record, its source files and the actual tools issued for this turn.

## Select the work path

Load the reference for the operation you need. These paths are relative to this entry.

| Operation | Contract |
| --- | --- |
| Author files or save a source revision | [Document transaction](references/formats/document.md) |
| Add pages, boards or objects; change model geometry or resources | [Canvas model](references/formats/canvas.md) |
| Edit a selected element or region | [Target evidence](references/review/anchors.md) |
| Recover input, navigate history, export or hand off review | [Workspace state](references/review/workspace.md) |
| Inspect a saved board or diagnose capture | [Render evidence](references/review/visual-check.md) |
| Use product source or a fixed system | [Source facts](references/authoring/code-grounding.md), then [components](references/authoring/components.md) if needed |
| Decide a composition | [Brief decisions](references/authoring/direction.md), [diagrams](references/authoring/diagrams.md) or [print](references/authoring/print.md) as applicable |
| Check presentation before delivery | [Visual checks](references/authoring/visual-craft.md) |
| Deliver only one HTML file when explicitly requested | [Single-file contract](references/formats/single-html.md) |

The separately attributed craft directories provide optional advice on
[interaction](references/craft/interaction/), [foundations](references/craft/foundations/) and
[composition](references/craft/composition/). Load an individual page for a concrete issue.

## Establish the document state

For a new document, choose a valid slug and documentId once. For an existing document, retain
its directory, documentId, board IDs and saved Canvas identities. A different title does not
create a different document.

A Page groups boards and objects. A board contains HTML at a declared viewport. A revision
identifies a complete saved source set. The recovery checkpoint holds view state and unfinished
input. A Page switch or camera move therefore does not save a new source revision.
Canvas notes are document objects; review opinions belong to the separate review/handoff state.

Read the selected source before writing. Preserve model-owned object layers when editing board
HTML. Workspace creation actions allocate their own IDs; do not add caller IDs to their commands.
A preview anchor or historical card supplies evidence, not permission to edit a foreign Chat,
change execution computer or use a stale lifecycle generation.

## Complete one source transaction

Use the current workspace's authorized file tools for authored HTML/CSS/resources. Finish every
writer before requesting a source check. The saving sequence is:

1. Call `design_check` for the selected `design/<slug>` directory.
2. Use its ready result's `expectedRevision` and `readSetDigest` with a fresh `requestId`
   in `design_commit`.
3. Keep the returned document/revision/snapshot identity. Inspect the saved board with
   `design_render_check`, using that documentId and revision rather than a live source path.

The document reference defines refusal, retry and prepared-operation recovery. If a response
is unknown, retain the original request and parameters. A second request cannot determine what
the first one did. Do not increase expectedRevision to make a refusal disappear.

Canvas direct edits are workspace actions admitted by the host. They share this document
journal, CAS and semantic Undo/Redo. The three tools named in this entry do not create a
general-purpose Canvas command tool. Use only actions that the current host actually exposes;
otherwise make an authorized source revision or report the missing capability.

## Deliver a verifiable result

Identify what was saved and what was inspected. A valid manifest proves structure. A JPEG proves
only the visible captured state after you view it. Interaction, native focus, touch input,
encrypted remote transfer and Provider quality require their own observed evidence.

Retain unfinished input when a capability, resource, CAS or capture is refused. Give the user
the concrete limitation and the saved result that still exists. Export only a selected saved
range; a live camera or unsaved proposal is not the export source.

Current instructions describe Bottega's own host contracts.
[Source records and retained licenses](references/PROVENANCE.md) distinguish this writing pass
from the historical adaptation and the separately licensed craft material.
