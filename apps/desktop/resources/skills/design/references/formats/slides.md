<!--
  [INPUT]: Native deck v4/section grammar, original Slides compiler and shared source journal/candidate contracts
  [OUTPUT]: Native editable presentation authoring, fixed resources and current-head transaction guidance
  [POS]: Artifact Design presentation reference; preserves the original dedicated Slides editor and source model
-->

# Native Slides source

Use the dedicated native Slides format for a presentation. Create one directory at
design/<documentId> with deck.json v4, slides/<id>.html and captured local resources. The
host reports contentFormat slides/v4. Its projected host manifest is metadata; never write
that projection over deck.json. Preserve existing slide IDs, order, cover, sections, notes,
font faces, system bindings and unrelated resources.

For a new deck without another requested font, call design_fonts. The fixed OFL Noto Sans SC
family supports normal style and weights100 through900. Request its fontId to get verified
local font/license paths, then copy both with your issued file tools into this source, for
example fonts/NotoSansSC-VF.woff2 and fonts/NotoSansSC.LICENSE.txt. These are source assets,
not system-font installation. Declare that actual local file in faces and apply its family
explicitly to text. Do not copy a cache path into deck.json or substitute an existing font.

A deck contains title, a unique nonempty order, sections, faces and designSystems. Each
section has description and start, where start names an indexed slide. An optional cover
also names an indexed slide. Set lists to css for CSS lists. New file-based decks may retain
createdOnFiles with v:1 and a UTC ISO time at second precision. A face has family and exactly
one source. Before saving, capture the selected font CSS/bytes/license and use a local src;
a live Google Fonts href is not an immutable offline dependency.

Each slides/<id>.html contains exactly one section with the same id. It is a fragment, not
a complete HTML document. Native slide size is 1920 by 1080 CSS pixels. Use the original
supported HTML/style subset. Use position:absolute before left/top/width/height for pinned
objects. Resource paths such as assets/photo.png and fonts/Selected.woff2 are relative to
the deck root, including inside a stored slide; do not write ../assets paths. Reference
only files that are actually present in the complete source set.

Speaker notes are one final aside inside the section, at most 4000 characters. They do not
appear in the audience slide. Keep each indexed slide file; an unindexed page is an error.
The host retains all pages and resources. A bounded message fence includes up to16 preview
summaries plus the complete page count; that summary is not the editable deck.

Authored x-icon names use the original supported subset: Activity, Book, Chart, Chat, Check,
CheckCircle, Clock, Cloud, Code, Database, Globe, GraduationCap, Home, Key, Lightbulb,
Lightning, Link, Lock, PaperPlane, Play, Search, Settings, Star, ThumbsUp, Tool, Trust,
Users, Verified, Warning and Wrench. Editor UI icons have a separate licensed SVG mapping.
Do not assume an editor button's icon name is also an authored icon name.

Use x-embed only for a noninteractive graphic. It must be a direct section child, at most
eight per slide and16 KiB each. Its scripts stay in an opaque no-network frame. Do not use
it to open windows, access parent DOM, fetch dependencies or run a React application.
Fixed preview/output captures flatten its rendered graphic. Slides system consumption is
limited to fixed Token/font/image/Theme resources; do not insert DC/React components.

The current capacity is256 slides,512 source files,64 KiB deck.json,8 MiB per slide and32 MiB
complete source. The final archive/export also retains its existing byte budget. Reject
an over-budget request; do not drop pages, resources or notes to make it fit. Canvas keeps
its own16-board/64-file limits.

Finish all writers, call design_check, then design_commit with the returned exact
expectedRevision/readSetDigest and a fresh requestId. The original Slides compiler checks
unsupported syntax before publication. Fix the reported source position rather than
converting a rejected object to an unexplained placeholder. Inspect the saved documentId,
revision and slide board with design_render_check, including text, image and note facts.

Manual edits retain the original editor Undo/Redo. A comment instruction uses the isolated
[candidate purpose](../review/candidates.md), immutable candidate preview and explicit
acceptance. Keep comments and speaker notes as user data. Do not resolve a thread merely
because a candidate is ready. Accepted AI changes and one-step rollback use the same
current-source journal, including page/resource creation, deletion and renaming.

Export only the formats/options actually issued by the host. Bind output to its fixed
source/candidate, selected pages, captured fonts and normalized specification. A font file
being present does not prove loaded glyphs or editable PPTX embedding. Do not silently use
system fallback, change a font, claim every PPTX object is editable, report a canceled save
as saved, or describe an unpublished file as available on another device. Trusted
fullscreen/presenter windows are host operations; an authored graphic cannot request them.


Fixed native systems

Use design_system_bind with an exact current-Chat systemId/targetRevision. Binding installs the original native palettes under ds/, fixed font faces and captured images. Read systems/<systemId>/conversion.json for the source snapshot, conversion version, exact theme mappings and unsupported values. React components are not a Slides target.

Keep every unbound slide valid: native styles must contain literals, never var() expressions. To request deterministic conversion during an explicit bind, add data-theme="light" or the exact system theme ID and data-system-tokens="background=surface;font-family=font-family" on an element that already has a valid literal style. Use distinct supported property=token pairs. Add data-system-asset="original/source/image.svg" to an img with a valid local placeholder src to replace it with that exact captured system image. Binding writes native literal styles and fixed root-relative resource paths. Required unsupported or missing values refuse the bind. Keep the result source and binding metadata; a later system update does not change this deck.
