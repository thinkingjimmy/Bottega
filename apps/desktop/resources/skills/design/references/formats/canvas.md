<!--
  [INPUT]: Closed Canvas manifest/command schemas, main source capabilities and the existing document journal
  [OUTPUT]: Page/object authoring boundaries, source edit limits, recovery and explicit export ranges
  [POS]: Artifact Design format reference; Canvas is part of the same document, not a second App or save log
-->
# Canvas pages and objects

Pages group boards and Canvas objects. They are not boards or saved versions. The editor keeps its
current page, tool, selection, preview mode and camera in the existing recovery checkpoint. Changing
those view settings does not publish a version. A document without pages has one implicit page;
reading it does not rewrite source or import old application records.

Optional manifest fields are `pages: [{id,title}]`, `boards[].pageId`, `boards[].position: {x,y}`,
and `objects`. An object has a stable host ID, pageId, optional boardId, bounds and kind-specific
literal data. Board children use board-local coordinates; other objects use page coordinates.
The host allocates IDs and renders canonical board layers. Preserve these layers and their model
when editing ordinary HTML. Do not use a DOM ID, caller path or arbitrary HTML as write authority.

Object kinds are text, note, rectangle, ellipse, line, arrow, drawing and image. Line/arrow may have
two normalized points, so reversed or vertical gestures retain their direction. Drawing has
2–256 normalized points. Text supports literal typography, document-local links and plain lists.
Canvas notes are saved document objects. Review opinions remain separate checkpoint notes and
enter the original Chat only through its explicit Add to draft or Send action.

Limits are 16 pages, 16 boards and 256 objects. At least one page and one board remain in a document;
an empty page is valid. Bounds have positive width/height up to 8000 CSS pixels and coordinates
from -100000 to 100000. Existing file, manifest, complete-source and generated-resource budgets
also apply. Images use admitted PNG/JPEG/GIF/WebP bytes with exact fixed digests: at most 2 MiB,
8000 pixels per axis, 128 frames and 16 million total decoded pixels. Repeated image projections
must fit the existing 50,000,000-byte generated-resource budget. Fonts use system families or
resources copied from an explicitly bound fixed design system. No downloads are implicit.

## Direct editing and saves

The workspace uses one closed `canvas` batch with an original request ID, generation, displayed
revision and complete-source digest. Each batch has at most 32 operations and 6 KiB of operations.
The complete serialized UTF-8 remote body, including routing scope, stays within the existing
8 KiB command allocation. A completed gesture is one semantic save. Pointer movement and
unsubmitted text remain bounded draft input. Do not publish a version for every pointer event.

Static source editing requires a unique stable ID and matching board digest/text. Supported CSS
properties use literal values and CSS names: color, background-color, font-family, font-size,
font-weight, font-style, text-decoration, text-align, line-height, letter-spacing, padding, gap,
width, height, left and top. Movement requires known positioned pixel axes without transformed
ancestors or unresolved stylesheet geometry. Scripts, components, directives, ambiguous targets
and rich nested text receive a concrete limitation. Use the original Agent for those targets.
Plain compatible text blocks/lists and links retain their source identity and typography on
round trips. External links are unavailable in the offline navigation model.

The host validates the complete in-memory batch before preparing the existing journal. It is
one atomic semantic action, not a filesystem rollback promise. CAS refusal retains input.
Unknown results query/resume the same original request. Deterministic zero-write source conflict
is terminal; possible started/applied effects require explicit keep-current-source resolution.
That resolution changes no source, card or version. Never silently overwrite or create a new
request to hide an unknown result.

Undo/redo, branch truncation, restart, restore and Fork reuse the existing journal and complete
immutable archive. Removing pages/boards/objects keeps historical versions and existing source
files; it is not permission to delete developer data. A new batch truncates redo in the same way
as other document edits. Old lifecycle generations and foreign Chat/computer scope remain refused.

## Export ranges

PNG exports one selected board or page; a multi-page document needs an explicit selection.
Board HTML preserves its offline prototype. Document HTML includes boards and separate page
object views with local board navigation. Document PDF keeps ordered board pages and adds sheets
for standalone objects/empty pages. Fixed and flow paper behavior remain distinct.

Page exports compose frozen board images and actual page objects. They are static compositions;
they do not preserve board prototype interaction or searchable board text. A large page scales
uniformly to at most 8000 pixels per axis. Its complete resources and fonts come from the fixed
archive. No live camera, unsaved source, newer system or another computer enters the export.
Native image/PDF rendering still requires actual scoped acceptance before delivery claims.
