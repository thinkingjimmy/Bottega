<!--
  [INPUT]: Bottega source capture, inventory/difference pagination and exact system tool parameter schemas
  [OUTPUT]: Complete source review and one digest/CAS-bound extraction, update, override or compilation request
  [POS]: Bottega system operation reference; source is captured as data and mutations use the existing journal
-->

# Capture and update source

Use explicit current workspace-relative source selections. The host accepts 1–32 unique paths;
it captures supported local files and dependencies without following links or executing source.
Capture limits are 52 files, 8 MiB per file, 24 MiB total and 256 inspected nodes.
Missing, external, unsupported or unusable items appear as omissions or a concrete refusal.

## Read an inventory

Call `design_system_extract` with systemId and sources. Omit save, or set it false.
Select inventory pages with value JSON `{section,cursor}`. Sections are tokens, aliases,
components, sources and unsynced. Follow nextCursor until null for each relevant section.
Counts describe the complete inventory; a page contains at most eight bounded rows.

Keep sourceDigest consistent across pages. If it changes, source was captured differently:
restart the review rather than combine pages from different source sets. Truncated rows are
summaries; use the captured/original authorized files to read exact values.
Read every unsynced item before claiming coverage.

A new system save adds save:true, one new requestId and expectedRevision:0 to the extraction.
The same systemId/sources and original request identify recovery. An existing system must use
an update, not another initial extraction save.

## Review a source difference

For an existing current system Artifact, call `design_system_diff` with artifactId and explicit
sources. Its value JSON can contain cursor and unsyncedCursor. Read both nextCursor and
nextUnsyncedCursor streams. Retain the returned sourceDigest and the exact change keys.

The comparison has three inputs: prior source baseline, current saved user values and newly
captured source. Required conflict/removal decisions must come from the user's selected intent.
Do not assume that source precedence or deletion was authorized merely because new files exist.

Apply through `design_system_update` with the current artifactId, requestId, expectedRevision,
readSetDigest, the same sources, reviewed sourceDigest and decisions keyed to that difference.
The host captures the source again and refuses if the digest or choices no longer match.

| Decision | Meaning |
| --- | --- |
| keep | Preserve the current value or removed entry |
| source | Use an available incoming value |
| delete | Remove an entry that disappeared from source |

Unknown keys, missing required choices and delete for a still-existing source entry are invalid.
Source/font/resource omissions stay visible. Captured font faces are retained; a changed face
with the same family/weight/style is reported as unsynced rather than silently replaced.

## Make a literal override or controlled mount

For one user token/alias edit, call design_system_update with the same four mutation identity
fields and value JSON `{token,theme,value,usage?}`, without sources. The host validates the
existing theme/name and literal value, records the override and regenerates CSS together.
Do not maintain tokens.css as another authority.

For a captured component, design_system_compile uses those identity fields, entry and value
JSON `{component,props?}`. Read the source API first. Compilation can produce mount evidence,
a static reason, or retain a prior valid result with an unsynced failed attempt. Check the actual
saved record; see [system review](craft.md).

These operations use the [document transaction and recovery](../../design/references/formats/document.md).
The host supplies Chat/incarnation/generation from the issued turn lease. A retained reference,
stored repository path or mutation-shaped JSON cannot grant a missing capability.
