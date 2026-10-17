<!--
  [INPUT]: Bottega fixed/flow export formats, saved board/Page ranges and the requested paper composition
  [OUTPUT]: A saved print design with an explicit export range and an honest PDF inspection boundary
  [POS]: Bottega print authoring reference; PDF generation remains owned by the existing exporter
-->

# Prepare a print result

Choose the source range and paper behavior before adjusting the composition. The host accepts
`pdf-fixed` or `pdf-flow`, with `paper` set to `a4` or `letter`.
These are saved-revision export options, not an additional save or print command.
Paper selects the flow sheet size. Fixed PDF uses the prepared viewport instead of that paper size.

Use fixed board mode for a composition whose viewport defines the sheet. Use flow-oriented
HTML when content should paginate. Keep the same authored content and resource closure in the
document. Print CSS may express page breaks and margins, but only an actual PDF can establish
the resulting pagination.

| Range | What the exporter uses |
| --- | --- |
| board | One validated board in the fixed revision |
| page | Frozen board raster images plus standalone objects on that Page |
| document | Ordered board output plus sheets for standalone Page objects or empty Pages |

Page composition is static. It does not retain board prototype interaction or searchable board
text. A large Page scales uniformly to at most 8000 pixels on each axis. Do not call that a
vector recreation of the original boards.

For document output, confirm that board order and Page-only material match the requested scope.
PNG requires a selected board or Page and cannot export a whole document. The visible camera,
unsaved input and newer system version are outside every saved export.

Keep images/fonts local and within the [Canvas resource limits](../formats/canvas.md).
The fixed system binding supplies copied font bytes; a family name alone cannot supply a font.
Do not fetch remote print assets as part of export.

After export, inspect actual pages if a PDF viewer/rendering tool is available. Check clipping,
page breaks, text order and the intended resource appearance. Otherwise report the file receipt
and leave print layout unverified. [Workspace state](../review/workspace.md) defines the explicit
range and recovery contract.
