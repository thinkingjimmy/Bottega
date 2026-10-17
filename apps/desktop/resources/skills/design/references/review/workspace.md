<!--
  [INPUT]: Bottega Canvas/review checkpoints, semantic document history, original-Chat handoff and normalized exports
  [OUTPUT]: Operation guidance that preserves input and distinguishes saved source from recovery/view state
  [POS]: Bottega workspace reference; all source mutations stay with the existing owner journal
-->

# Workspace operations

Identify the persistence owner before describing an action:

| State | Owner and effect |
| --- | --- |
| HTML, manifest, pages/objects and resources | Complete saved document revision |
| Current Page/tool/selection/camera/preview | Canvas recovery checkpoint; no source revision from viewing alone |
| Unsubmitted property/model input | Retained draft/checkpoint until explicit save or cancel |
| Review opinions and pending annotation | Review checkpoint with fixed target evidence |
| Unknown admitted mutation | Original request and durable journal state |
| Undo/Redo cursor | Semantic history derived by the journal owner |

Canvas notes are text-bearing document objects. They are not the review opinions that can be
added to the Chat draft. A selection change must not turn either kind into the other.

## Save or recover source

A finite property edit, Canvas batch, system change or restore uses the same document journal
and current revision/read-set CAS. A batch validates in memory before prepare, but durable file
effects do not promise filesystem rollback. Preserve raw invalid input and pending requests
when the host blocks navigation, close, disable or another mutation.

For unknown outcomes, query the original request's status and use its original resume operation.
Do not retarget it, edit its parameters or allocate a new ID to hide uncertainty.
A confirmed zero-effect source conflict is terminal. Possible started/applied effects require
the explicit keep-current-source resolution exposed by the owner. Resolution itself saves no
source, revision or card. See [the source transaction](../formats/document.md).

Undo/Redo follows the owner's displayed target revision and current CAS. It saves navigation
without adding a new edit step. A normal edit truncates redo. Opening an older card only views
its archive; it does not perform Undo or authorize editing that historical snapshot.
Removing a Page/board/object does not remove prior versions or physically delete retained files.

Artifact disable stops new admission. Saved archives and recovery input remain available;
prepared work retains its original recovery identity. Re-enable creates a new generation, so an
old view or reference cannot authorize a new write.

## Export a saved range

The host export action accepts html, png, pdf-fixed or pdf-flow. Select an explicit range:

| scope | Required target |
| --- | --- |
| board | A board in the fixed manifest; omission defaults to launchBoard |
| page | pageId in that fixed manifest |
| document | The saved document; unavailable for PNG |

If scope is omitted, PNG defaults to board and other formats default to document. Every supplied
Page/board ID is validated even if irrelevant to the chosen range. A Page/board in another
revision is invalid. The range, format and paper are normalized before cache or concurrent work.

Page export uses static board captures and actual standalone objects; it does not retain board
interaction or searchable board text. Document HTML retains board prototypes and local
navigation, with separate Page-object views. Document PDF includes boards and Page-only sheets.
Flow PDF uses A4/Letter paper; fixed PDF uses the prepared viewport. See
[print composition](../authoring/print.md) for the inspection boundary.

## Transfer review intentionally

Add to draft and Send are distinct explicit user actions in the original Chat. Keep the original
execution computer and document reference. A failed transfer retains notes; an unknown send
queries the same request. Do not send automatically, replace unrelated draft text, switch Agents
or use a private preview address/clipboard operation as a substitute for the host handoff.
