<!--
  [INPUT]: Bottega manifest/path schemas, complete-source checker, DesignDocuments journal and issued check/commit/render specs
  [OUTPUT]: Authoring fields and the source transaction/recovery contract for saved Artifact designs
  [POS]: Bottega file-based design contract; Canvas workspace edits and system documents share its journal
-->

# Document transaction

The save unit is the complete directory `design/<documentId>`. Select that document before
editing. Every captured file, including unused local files, contributes to its read-set digest.
The host saves that read set as one immutable archive; saving one board does not omit its peers.

Use [Native Canvas](native.md) for Canvas v3/DC or [Native Slides](slides.md) for deck v4.
The host rejects retired schemaVersion:1 design source. Do not convert old source automatically.
Design systems have their own source definition under `design-systems/<systemId>`.

Use complete UTF-8 HTML for Canvas boards and native section source for Slides. Resolve every
resource within the captured document. The host manifest is metadata; never write it over a
native source index. A fixed system binding names an exact system revision and copied closure.

Relative stored paths have at most four segments and 240 characters. A segment starts with an
ASCII letter, digit or underscore; subsequent characters may include dots, spaces or hyphens.
Hidden segments, node_modules and symbolic links are invalid. Resource references may traverse
between directories only if their resolved target stays inside the same document.

| Complete-source budget | Maximum |
| --- | --- |
| Files | Canvas: 64; Slides: 512 |
| canvas.json | 64 KiB |
| One HTML file | 8 MiB |
| All source bytes | 32 MiB |
| Archive/generated resource bytes | 50,000,000 |

Keep the complete closure within those limits. Truncation changes the delivered design and is
not a valid way to report success.

## Bind a save to checked bytes

Wait for each writer's actual completion result. `design_check({path})` samples for one second
of quiet at 500 ms intervals, with a ten-second maximum. It returns issues, file/digest inventory,
expectedRevision and readSetDigest. It does not create a version or prove runtime behavior.

Use a ready check result to construct `design_commit` with exactly these fields:
`path`, a new `requestId`, `expectedRevision` and `readSetDigest`.
A first source save expects revision 0. A later save expects the revision returned for that
document; do not infer it from the board being viewed. Retain the successful receipt's identities.

## Decide from the result

| Observed result | Next action |
| --- | --- |
| NOT_READY or invalid check | Retain source and the prior saved result; finish writers or correct the listed structural issue before a new check |
| SOURCE_CHANGED before a new commit is prepared | Reconcile the changed source, check again, and use a new request ID; the tool permits at most two additional attempts after 1s and 2s |
| REVISION_CONFLICT | Read the current version and preserve the user's input; a higher expectedRevision alone is not a merge |
| PATH_DENIED, BUDGET_EXCEEDED or ARTIFACT_DISABLED | Correct the specific scope/resource/capability condition or report it; do not retry blindly |
| Unknown response or pending receipt | Replay the original request with identical parameters, at most three times 500ms apart as the tool contract allows; then retain operationRef and report pending recovery |
| REQUEST_MISMATCH | Stop using that ID for the changed parameters; determine the original operation's result |

A prepared edit can also return sourceConflict. If no file effect could have started, that conflict
is terminal and a new checked edit is possible. If started/applied effects are possible, use the
host's explicit keep-current-source resolution before another save. Resolution writes no source,
version or card. Unknown results must first be identified; do not resolve or replace them by guess.

The host's storage/delivery recovery has six attempts per cycle: the initial attempt and delays
of 250ms, 500ms, 1s, 2s and 4s. Use the returned status and original resume arguments. Caller
polling is not another recovery budget. A blocked authority needs the original Chat/workspace;
prepared recovery retains captured bytes even while Artifact is off.

## Inspect the saved result

Render with documentId/revision from the receipt and an optional saved boardId/viewport.
The renderer reads that archive, not newer workspace files. Native work cards open current head
metadata directly and expose no permanent history list; fixed snapshot references remain readable.

Native source saves and system changes share the same journal and compare-and-swap boundary.
Manual Undo/Redo stays in the mounted native editor; the latest AI rollback is separate.
Read [workspace state](../review/workspace.md) for checkpoint, review and export operations.
