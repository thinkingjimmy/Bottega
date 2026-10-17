<!--
  [INPUT]: The requested relationships, Bottega Page/board/object fields and ordinary offline HTML/SVG
  [OUTPUT]: A diagram whose grouping, geometry and labels fit the saved Artifact document
  [POS]: Bottega diagram composition reference; no external renderer or graph runtime is assumed
-->

# Put relationships in the document

Start by listing the actual nodes and relationships requested. Select a representation that
fits the intended later edit:

| Representation | Use when |
| --- | --- |
| Canvas objects | Text, rectangles/ellipses and explicit line/arrow geometry are sufficient |
| HTML/SVG board | The diagram needs custom paths, richer labels or layout beyond finite object controls |
| Several boards on Pages | Separate scenarios need their own viewport or comparison surface |

A Page is a group in the design, not a node or a saved version. Keep scenario titles separate
from node labels. Canvas objects can belong to the Page directly or to a board; their coordinates
then use page space or board-local space respectively.

For Canvas lines/arrows, preserve direction with the supported two normalized endpoint points.
A drawing has 2–256 normalized points. Bounds must remain positive and within the model limits.
The object model has no relationship engine: moving a node does not imply automatic connector
routing or a graph database update. Save geometry as one bounded semantic batch when exposed.

For an HTML/SVG diagram, give important source targets stable IDs and accessible labels. Direct
editing still depends on the host's returned capability; an SVG ID is not a promise that every
path/transform can be changed through the property panel.

Check labels, connector endpoints and content extent in the saved board image. A Page export
is a static composition of board images and Page objects. Use a board/document HTML export if
the user needs a board prototype, and separately verify its interactions. The
[Canvas contract](../formats/canvas.md) defines budgets and range limits.
