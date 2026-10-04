/**
 * [INPUT]: Product window identities, human window titles and bounded draft-flush outcomes.
 * [OUTPUT]: Aggregates unconfirmed saves into DraftSettlementError before any App window is reclaimed.
 * [POS]: Quit persistence barrier used by SurfaceWindowController and native quit feedback.
 */
import type { ProductWindowRecord } from "../window-registry";

export type UnconfirmedDraftWindow = { windowId: string; title: string; cause: unknown };
export class DraftSettlementError extends Error {
  constructor(readonly windows: readonly UnconfirmedDraftWindow[]) {
    super("WINDOW_DRAFTS_UNCONFIRMED", { cause: new AggregateError(windows.map(window => window.cause)) });
    this.name = "DraftSettlementError";
  }
}

export async function settleWindowDrafts(windows: readonly ProductWindowRecord[], flush: (windowId: string) => Promise<unknown>) {
  // Capture titles while the windows are still available, including a renderer lost during the wait.
  const titles = windows.map(record => {
    try { return record.window.getTitle?.().trim() || record.appId || "Bottega"; }
    catch { return record.appId || "Bottega"; }
  });
  const results = await Promise.allSettled(windows.map(record => flush(record.windowId)));
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [{ windowId: windows[index]!.windowId, title: titles[index]!, cause: result.reason }] : []);
  if (failures.length) throw new DraftSettlementError(failures);
}
