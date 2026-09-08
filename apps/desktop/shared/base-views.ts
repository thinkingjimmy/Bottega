/**
 * [INPUT]: Depends on shared bases-ipc type of BaseView
 * [OUTPUT]: Provides renumberViews, sorting views by their current order and reassigning a stable, contiguous 0-based order
 * [POS]: Shared pure function for Base view ordering; the single implementation main and renderer both use, eliminating divergent renumbering logic
 */

import type { BaseView } from "./bases-ipc";

export function renumberViews(views: readonly BaseView[]) {
  return [...views]
    .sort((left, right) => left.order - right.order)
    .map((view, order) => ({ ...view, order }));
}
