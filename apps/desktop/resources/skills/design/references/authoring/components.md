<!--
  [INPUT]: Bottega captured system components, fixed bindings, compile parameters and actual mount evidence
  [OUTPUT]: A bounded choice between a captured mount and an explicitly described static representation
  [POS]: Bottega component consumption reference; uses the existing system and document tools
-->

# Use a captured component

Begin with one system revision and one inventoried component. Read its exportName, entry,
sourceDigest, closureDigest, closure paths and current mode. Read the captured source types
for required props, providers and styles. The component name alone is insufficient evidence.

If a controlled mount is required and the tool is issued, call `design_system_compile` with:

- The current system artifactId, requestId, expectedRevision and readSetDigest.
- `entry` equal to that component's original relative entry.
- `value` containing JSON `{component,props?}` for that inventoried name.

Compilation reads captured files and the host's locked React/esbuild runtime. It is not an
instruction to run the source repository's scripts or install missing packages. Out-of-closure
imports and remote resources cannot become dependencies of this mount.

Inspect the resulting component record and saved revision. A mounted record includes local
preview/bundle identities and image evidence for the recorded styles. View that evidence.
A failed attempt may leave a prior valid mount or a static inventory with unsynced reasons;
neither result proves that the attempted new props worked.

Bind the chosen saved system revision into the consumer with `design_system_bind`.
The consumer receives a copied local closure and its exact system binding. Reference that
local copy from the board. Do not use a path into the system's live source directory.

Token/style changes can invalidate prior mount evidence. Check the component's current mode
and styleDigest again after such a change. A screenshot of one state does not verify keyboard,
focus, error or other interactive states.

If mounting is unavailable, use an authorized static board representation when it serves the
brief. Describe it as static and retain the missing dependency/capability. The design can still
be saved through its [document transaction](../formats/document.md).
