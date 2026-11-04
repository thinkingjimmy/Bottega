<!--
  [INPUT]: Current native/system source, checkpoints, exact original requests and immutable exports
  [OUTPUT]: Save, recovery, Undo/Redo, export and original-Chat handoff guidance
  [POS]: Current workspace reference independent of the retired Canvas model
-->

# Workspace operations

Native Canvas v3 and Slides v4 keep their own source and manual Undo/Redo in the mounted editor.
Source-backed comments live in comments.json. Checkpoints retain unfinished native instructions
or design-system forms; they do not provide another permanent history or object model.

Source saves and system changes share the original document journal and revision/read-set CAS.
Keep the original request after an unknown outcome. Query that operation and resume only its
original parameters. Possible partial file writes require the explicit keep-current-source
resolution. A zero-effect source conflict permits a new checked save.

Artifact disable stops new admission after mounted views persist their input. Prepared current
operations retain their original identity. Re-enable rotates the generation. No old view can
renew its write authority. Unsupported formats and retired commands are never resumed.

Use the original native editor's export controls for Canvas/Slides. They export fixed saved
source with explicit resource and font choices. Exporting never creates a source revision.
Design-system exports support a saved board or complete document as HTML, PNG, fixed-page PDF
or flow PDF. PNG requires one board. Flow PDF uses A4 or Letter paper.

Manual native Undo/Redo and the latest AI rollback are separate. The AI rollback restores the
complete source set from the accepted operation's exact baseline; it does not create arbitrary
historical restoration or a permanent version browser.

Review handoff is an explicit user action in the original Chat. Keep that Chat, document and
execution computer. Preserve input after a refusal and never replace unrelated draft content.
See [the source transaction](../formats/document.md) and [candidate purpose](candidates.md).
