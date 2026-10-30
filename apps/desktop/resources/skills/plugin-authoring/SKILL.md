---
name: plugin-authoring
description: Create or improve a composer plugin or Dock Widget in its current source Chat, then validate and iterate through the host's sandboxed candidate loop.
requires: "tools: plugins:mutate"
---

<!--
[INPUT]: The current source Chat workspace, composer/Dock manifest and scoped authoring tools.
[OUTPUT]: Validated editable plugin source; Dock candidates require separate user preview and application.
[POS]: Product-owned authoring workflow for built-in and local UI plugins.
-->

# Plugin authoring

Work inside this Chat's workspace. Install a plugin only when the user's request
includes creating or changing a plugin. Do not change other Chats, publish a
package, or modify the Bottega application source.

## Create and install

First read the existing `plugin.json`. A Dock Widget has `dock` and no `composer`
or `source` declaration. For that target, follow [Dock Widgets](dock-widgets.md).
Keep the target and stable identity unchanged. Do not add composer fields to a
Widget, reuse its grants for another instance, or call activation tools to apply
a Dock version. The fixed source Chat controls own preview and confirmation.

Start with `plugin.json`, `gui/src/main.tsx` and `gui/src/styles.css`. The manifest
declares the plugin identity and version, composer item, source format and readable
versions, fixed GUI compiler preset, and exact operations it needs. Every manifest
for a composer plugin must include `plugin.open` and `plugin.heartbeat`; the SDK owns the readonly
heartbeat and fatal-error cleanup. Do not implement a second heartbeat loop. Copy the host's
current scaffold rather than guessing additional manifest fields. Export one React
component from the entry and import the product API from `@bottega/plugin-react`.

Call `install_plugin` with the folder's workspace-relative path. The host freezes
and validates source, compiles it in an OS sandbox, seals the artifact, and watches
the folder. It owns activation and reports the actual active generation. Do not run
a development server or connect to localhost to imitate this path.

## Edit and verify

Change source in the installed folder. The host rebuilds it and retains the current
running generation if compilation fails. Dock builds produce candidates and never
apply them automatically. Call `validate_plugin` after a coherent change;
read its diagnostics, repair the stated source location, and check `plugin_versions`
for the active generation. A saved file alone is not evidence of successful activation.

Verify the requested behavior in the real plugin surface. Include keyboard and
touch interaction, denied capability, unavailable host and a failed rebuild when
they affect the change. Report which checks ran; a substituted model or narrow
browser viewport does not prove a real Agent or physical phone completed the flow.

For a composer plugin, to undo a working but unwanted change, call `plugin_versions`, then
`activate_plugin_version` with the retained target and the returned current
generation as `expectedActiveGenerationId`. For a Dock Widget, use the host version
review and explicit Apply controls instead. A conflict requires reading history
again. Do not overwrite a newer activation or restore a revoked grant.

## Output and recovery

- The host API submits a PNG and its editable source atomically to the current
  draft. Never read or write draft storage directly or accept a Chat id from code.
- Preserve opaque source with its format version and producing generation. Decode
  only supported versions. On an unsupported source, retain it unchanged and let
  the host keep sending the already rendered image.
- Checkpoint unfinished edits through the host before claiming they are saved.
  Checkpoints live on the current device, survive surface replacement and authority
  loss, and disappear when the account's local data is cleared.
- Use the SDK's bounded source/attachment transfer helpers for large data. Individual
  RPC messages are limited to 1 MiB; PNGs to 8 MiB and editable sources to 16 MiB.
- Heavy Sketch erasure uses the declared `sketch.coverage/v1` host computation
  capability. Plugin frames cannot start arbitrary Workers, processes or network
  requests. A new shape must also work with the declared compute version.

Finish with the active generation, changed behavior and observed verification.
Keep build failure and rollback evidence when demonstrating self-iteration.
