<!--
  [INPUT]: Bottega closed system/token/source/component schemas and system file projection
  [OUTPUT]: Saved file fields, bounded inventory and the one-way CSS/mount evidence contract
  [POS]: Bottega system data reference; records are local parts of one Artifact revision
-->

# System data

The system directory is `design-systems/<systemId>`; its documentId equals systemId.
Its canvas.json uses schemaVersion 1, format bottega-design-system, title, boards and launchBoard,
plus system pointers to the four local JSON records below. The host creates overview.html and
tokens.css. README.md holds usage guidance; an existing user README is retained.

| File | Required record |
| --- | --- |
| tokens.json | schemaVersion, themes, tokens, fonts |
| aliases.json | schemaVersion, aliases |
| sources.json | schemaVersion, files, baseline, unsynced; optional requestDigest |
| components.json | schemaVersion, components |

The common document limits remain 16 boards, 64 files, 64 KiB manifest, 8 MiB per HTML,
32 MiB source and a 50,000,000-byte archive/resource closure. Source capture has its own smaller
limits described in [source operations](from-code.md). Stored paths use the common relative
four-segment/240-character contract; no link, hidden path or node_modules is a captured resource.

## Tokens and derived CSS

There are 1–8 themes, at most 512 tokens and 32 font records. Each theme has id and name.
A token records name, kind, theme-keyed values, usage, sourceId/sourceKey and per-theme origins.
An origin has sourceId/sourceKey. override is optional evidence of a user value.

Supported kinds are color, font-family, font-size, line-height, font-weight, letter-spacing,
spacing, radius and shadow. Names use the system-name contract:
`[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`. Theme IDs are at most 32 characters.
A value is a literal string of at most 1000 characters. The first theme supplies fallback
when a later theme has no value. Unsupported source expressions remain data with diagnostics.

Up to 512 aliases record name, target, theme, usage and sourceId/sourceKey, with optional
override. Resolve against the recorded theme/fallback rules. Missing targets, cycles and
overlong chains are invalid; do not replace unresolved relationships with guessed literals.

A font record includes family, file, sourceId, definitionSourceId, sourceKey, weight and style.
It identifies both the captured font bytes and the source declaration. A name or remote URL
does not establish a usable local face.

tokens.css is generated from token/alias records and local font definitions. Safe emitted
values become CSS variables; not every source string can be emitted as CSS. Correct values
through the finite override/source-update operation, not by editing the projection separately.

## Source and component evidence

A source file record has id, path, capturedPath, digest, bytes and version. Version is either
`{kind:"git",commit,workingTree}` or `{kind:"digest",digest}`. The full commit records the actual
repository state; workingTree identifies bytes that differ. Captured digest is the actual byte
identity even when a Git commit is known. retained may identify a source chosen for preservation.

baseline contains prior source tokens, aliases and components. It is distinct from current user
values and drives the next three-way comparison. unsynced records have path, kind, optional
name and reason. Its kinds are token, component, font, asset, source and usage, with at most
1024 records. Do not remove an omission merely to make an inventory appear complete.

Up to 128 components record name, exportName, sourceId, entry, sourceDigest, closureDigest,
closure paths, mode and reason. The closure contains 1–52 captured paths.
A static record is an inventory. To claim a verified mount, inspect preview, bundle, bundleDigest
and evidence with file/digest/styleDigest, dimensions and the actual locked runtime/compiler.
The current mount contract records react@19.2.4 and esbuild@0.28.1; it does not install them.

Generated style changes invalidate a prior mount whose styleDigest no longer matches. The
projection retains source and records that mount as static/unsynced until it is mounted again.
A failed later attempt can retain an earlier valid preview; it cannot prove the failed attempt.

## Consumer records

A design's systems array binds documentId, positive revision, snapshotRef and copied files.
The binding action selects a same-Chat saved system revision and copies its bounded closure
under `systems/<systemId>/`. Consumer board links point to that local copy.

A system update does not rewrite consumers. An explicit new bind saves a consumer revision.
The reader validates that copied files match the identified fixed system. The Canvas font
selector uses system families and supported fonts from the standard fixed tokens.json binding;
arbitrary provenance JSON or CSS-only family names are not additional font sources.
