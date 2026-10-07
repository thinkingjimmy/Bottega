/**
 * [INPUT]: Immutable command entries and an exact interaction matcher.
 * [OUTPUT]: actionPending for composer cancellation and interaction submission.
 * [POS]: Pure receipt state shared by lazy interaction views and their lightweight host.
 */
import type { RemoteCommandInput } from "../../../platform/remote/contracts";
import type { RemoteEntry } from "../../../platform/remote/commands/session";
const finished = new Set(["done", "cancelled", "error", "expired", "rejected"]);
export function actionPending(entries: RemoteEntry[], matches: (payload: RemoteCommandInput["payload"]) => boolean) {
  return entries.some(entry => matches(entry.input.payload) && (entry.busy || !entry.rejected && (entry.uncertain || !entry.receipt || !finished.has(entry.receipt.state))));
}
