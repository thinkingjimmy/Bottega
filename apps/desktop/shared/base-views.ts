/**
 * [INPUT]: Depends on shared bases-ipc type of BaseView
 * [OUTPUT]: Provides renumberViews, in a stable order, to be grouped into a continuous array subset
 * [POS]: The Base view is a true source of the pure function of the main/renderer cross-section of the base view sequence; Eliminating the special case of duplication
 */

import type { BaseView } from "./bases-ipc";

export function renumberViews(views: readonly BaseView[]) {
  return [...views]
    .sort((left, right) => left.order - right.order)
    .map((view, order) => ({ ...view, order }));
}
