/**
 * [INPUT]: A retained command session, immutable request and caller lifetime.
 * [OUTPUT]: Awaitable private terminal results without turning an unknown outcome into a new command.
 * [POS]: Shared query/action bridge; timeout detaches the caller while original custody remains in the session.
 */
import type { RemoteCommandSession } from "./session";
import type { RemoteCommandInput, RemoteCommand } from "../contracts";
export function awaitRemoteResult(session: RemoteCommandSession, input: RemoteCommandInput, signal?: AbortSignal, timeoutMs = 65_000, admitted = false): Promise<RemoteCommand> {
  return new Promise((resolve, reject) => {
    let finished = false, submitted = false, stop = () => {};
    const finish = (receipt?: RemoteCommand, error?: unknown) => {
      if (finished) return;
      finished = true; clearTimeout(timer); stop(); signal?.removeEventListener("abort", abort);
      if (receipt) resolve(receipt); else reject(error ?? new Error("outcome-unknown"));
    };
    const abort = () => finish(undefined, signal?.reason ?? new Error("REMOTE_RESULT_CANCELLED"));
    const inspect = () => {
      const entry = session.snapshot().entries.find(value => value.input.commandId === input.commandId), receipt = entry?.receipt;
      if (entry?.rejected) finish(undefined, new Error(entry.rejected));
      else if (receipt && (admitted && receipt.admission !== null || ["done", "error", "rejected", "expired", "cancelled"].includes(receipt.state) || submitted && receipt.state === "outcome-unknown")) finish(receipt);
      else if (submitted && entry?.uncertain && !entry.busy) finish();
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    stop = session.subscribe(inspect); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    inspect();
    if (!finished) void session.submit(input, signal).then(() => { submitted = true; inspect(); }, error => finish(undefined, error));
  });
}
