<!--
  [INPUT]: Bottega fixed Artifact references, original-Chat handoff and source/update/binding identities
  [OUTPUT]: Task-specific follow-up text and an explicit fixed system consumer operation
  [POS]: Bottega system task handoff reference; no automatic message or connector invocation
-->

# Prepare the next system task

Use a follow-up only when the user requests it. Fill in actual saved identities and source
scope; do not forward a private preview URL as authority. These work orders describe Bottega
operations, not another Agent's permissions.

| Requested task | Facts to include |
| --- | --- |
| Capture source | Chosen systemId, explicit current source paths, desired inventory scope |
| Review an update | Current system Artifact/revision/readSetDigest, source selection and reviewed sourceDigest |
| Apply choices | Exact difference keys and the selected keep/source/delete decisions |
| Mount a component | Current system, inventoried entry/export, intended props/state and remaining checks |
| Bind a design | Current consumer Artifact/CAS plus systemId and targetRevision |

For example, a source-review request can state:

> Review the selected local source paths for this saved system. Return all difference and
> unsynced pages for one sourceDigest. Keep the saved revision until the listed update choices
> have been selected. Report unsupported source/resource items.

A consumer-binding request can state:

> Bind the current design to the selected saved system revision. Use its current Artifact
> identity and read-set CAS. Keep the copied resource closure and report the new consumer
> revision. Inspect affected boards when an issued render/image tool is available.

These requests need the actual identities from the current task; they are not executable
parameter objects. Do not convert a review request into an automatic mutation or Send action.

The binding tool itself accepts the consumer artifactId, requestId, expectedRevision,
readSetDigest, systemId and targetRevision. It uses the existing document journal and retains
the fixed copy. See [system data](format.md) and
[document recovery](../../design/references/formats/document.md).

Draft transfer and Send remain explicit original-Chat actions. A failed transfer keeps input;
an unknown send keeps and queries its original request. Stored source paths do not authorize
fetching a repository, installing a connector, changing computer or retargeting the task.
