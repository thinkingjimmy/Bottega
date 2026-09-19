/**
 * [INPUT]: Depends on the shared BaseView contract.
 * [OUTPUT]: Provides stable contiguous view ordering for metadata mutations.
 * [POS]: Canonical view ordering shared by the desktop writer and browser editor.
 */
import type { BaseView } from "./bases-ipc";
export function renumberViews(views: readonly BaseView[]) {
  return [...views].sort((left, right) => left.order - right.order).map((view, order) => ({ ...view, order }));
}
