<!--
  [INPUT]: Bottega fixed design references, bounded board anchors and main-issued Canvas target capabilities
  [OUTPUT]: A verified target for a finite edit or a stated reason to request new evidence
  [POS]: Bottega source-target reference; DOM hints remain separate from mutation authority
-->

# Resolve a review target

A design reference names artifactId, documentId, revision, readSetDigest and generation.
Its optional numbered anchors associate user opinions with targets in that saved result.
Retain that association when reading feedback; numbering is not a selector.

An anchor has one selector or one normalized region, plus boardId and boardDigest.
Text, bounds, computed properties, file and sourceLine are bounded evidence. They do not grant
filesystem or execution permissions. Read the named board and its actual current source.

| Target evidence | Permitted conclusion |
| --- | --- |
| Unique element, matching source identity/text | Inspect the main-issued capability for a finite edit |
| Old digest but one unambiguous same-board element | Revalidate the target from current source; retain why it was relocated |
| Ambiguous selector or conflicting text/context | Request a fresh target; do not choose an arbitrary match |
| Region | Identify an area for authoring feedback, not a DOM write span |
| Standalone Page object opinion | Treat as document-level feedback; do not fabricate a board anchor |

Direct Canvas editing supports only the properties and text/link/list/geometry flags returned
by the owner for that target. A false editable flag or reason is a result to respect.
Model-owned objects must change through their model operation, not by altering generated markup.

For ordinary HTML, finite source editing needs a unique stable ID and compatible literal source.
Scripted/template/component targets, rich text and unsupported geometry can be refused even if
the preview looks editable. Use an authorized file-based revision for the requested change when
that is appropriate, without claiming the property panel can perform it.

Historical/retained references remain read-only until the user selects an authorized current
document operation. Source-line hints, another computer's archive and an old generation cannot
establish that current authority. [Workspace state](workspace.md) defines retained input and
recovery when an admitted edit is refused.
