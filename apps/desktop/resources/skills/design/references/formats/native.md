<!--
  [INPUT]: Native Canvas v3 source validation, maintained DC grammar and current Chat document journal
  [OUTPUT]: Native source authoring and check/commit/render guidance without converting source or replacing the editor
  [POS]: Current Canvas creation and editing reference
-->

# Native Canvas source

For a new editable Canvas, use a complete directory at design/<documentId>, with canvas.json
version 3 and one or more .dc.html boards. The host reports contentFormat canvas-dc/v3; do not
write its projected schemaVersion:1 manifest over the native source. Preserve an existing
native index, pages, board files, notes and unknown native fields when making local changes.

For a new design without another requested font, call design_fonts and request its fixed
fontId. Copy the verified OFL font and license with the issued local file tools into this
source, then declare the actual relative font path in @font-face and use its family. The
fixed Noto Sans SC font supports normal weights100..900. Do not copy a host cache path into
source, install system fonts or silently replace an existing family's appearance.

A minimal index for design/launch-page is:

```json
{"v":3,"title":"Launch page","launch":{"view":"canvas"},"pages":[],"boards":{"Main.dc.html":{"x":0,"y":0,"w":1200,"h":800}},"order":["Main.dc.html"],"notes":{},"designSystems":[]}
```

Order must contain every board exactly once. There are at most 16 boards and 16 pages.
Board width and height are integer CSS pixels from 40 to 8000; x and y are finite positions.
A declared page uses {id,name}; a board or note's page value names one of those IDs.
The host supplies an implicit page when pages is empty. Do not replace native page/file IDs
with projected host board/page hashes.

Main.dc.html can contain:

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Launch page</title>
<script src="./support.js"></script></head><body>
<x-dc><div style="width:1200px;min-height:800px;box-sizing:border-box;padding:64px;background:#f5f3ed;color:#202823;font-family:Arial,sans-serif">
<h1 style="margin:0;font-size:56px">Launch page</h1><p>{{summary}}</p>
</div></x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1200,"height":800}}'>
class Component extends DCLogic { renderVals() { return { summary: "A clear next step." }; } }
</script></body></html>
```

The host supplies support.js at render time. Do not copy a compiled editor/runtime bundle into
the document. Keep local images/fonts/scripts in the same complete source closure. External
URLs, live workspace paths, symlinks and node_modules cannot supply a saved dependency.
The complete directory remains bounded to 64 files and 32 MiB; canvas.json is at most 64 KiB.
Resource paths follow the shared four-segment/240-character document path contract.

For a fixed design system, use the issued design_system_bind tool. It copies and records the
selected immutable system closure in bottegaSystems. Do not invent a binding or link a live
system directory. A DC component needs its separate target:dc build; a standalone React19
bundle is not a native DC dependency. Read the sibling design-system reference for that target.

## Save and continue editing

Read the current source and finish all file writes. Call design_check for design/<documentId>,
then design_commit with its exact expectedRevision/readSetDigest and a fresh requestId.
Inspect the returned fixed document/revision with design_render_check. A native current head
is sufficient; obtaining all historical revisions is not a prerequisite for a new edit.

Manual native saves retain the mounted editor's Undo/Redo. An accepted AI candidate may reload
the editor; its separate latest AI rollback restores the complete prior source set. Later source
changes can make that rollback unavailable. Do not promise one merged manual/AI undo stack.

Native comments live in comments.json version 1. Read its thread IDs, messages, status and
advisory file/snapshot locations before applying a requested comment. Keep other opinions,
authors, IDs and timestamps; do not resolve a thread merely because a proposal was generated,
accepted or discarded. An unknown comment/save result is checked through its original operation,
with no extra model request. The host retains unfinished compose/reply/instruction input.

For a comment-driven isolated edit, follow [candidate purpose](../review/candidates.md).
Slides uses a distinct deck model and editor; it is not converted into this Canvas format.
