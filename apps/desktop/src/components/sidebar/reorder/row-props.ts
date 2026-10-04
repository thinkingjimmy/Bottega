/**
 * [INPUT]: Depends on nothing; plain callback-ref and handler shapes.
 * [OUTPUT]: Provides the ChatRowReorderProps contract that reorderable rows receive and the DropEdge vocabulary.
 * [POS]: Type-only seam between reorder/ and the row components in chat/ and cloud/, so neither imports the other at runtime.
 */
/** Which gap of the hovered row the insertion line marks. */
export type DropEdge = "before" | "after";

/* One prop object rather than five loose ones: a row is either inside a reorder list or it is not,
   and the visual states (ghost, indicator, hover suppression) only make sense together. */
export type ChatRowReorderProps = {
  /** dnd-kit draggable + droppable node: the row's `<li>`. Callback refs only, so one ref fits both hosts. */
  itemRef: (element: HTMLLIElement | null) => void;
  /** The link/button host that starts a drag; absent for rows that only define a slot (cloud mirrors). */
  hostRef?: (element: HTMLElement | null) => void;
  /** PointerSensor activator listeners; spread on the host, never on the `<li>`, so row actions cannot start a drag. */
  listeners?: Record<string, unknown>;
  /** This row is the one being dragged: it stays in place as a dimmed ghost while the overlay follows the pointer. */
  dragging: boolean;
  /** Draw the insertion line at this edge of the row. */
  dropEdge: DropEdge | null;
  /** A drag is active somewhere in this list: hover feedback and row actions must not react. */
  suppressed: boolean;
};

export type ChatRowDropProps = Pick<ChatRowReorderProps, "itemRef" | "dropEdge" | "suppressed">;
