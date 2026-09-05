/**
 * [INPUT]: Depends on the trusted SDK request port, AbortSignal, and an abortable clock
 * [OUTPUT]: Provides the consistent, cursor-complete Base snapshot reader embedded in the React SDK
 * [POS]: Product SDK data leaf; app-react embeds these bytes in its signed runtime source
 */

export const BASE_SNAPSHOT_RUNTIME_SOURCE = `
function snapshotError(message) {
  return Object.assign(new Error(message), { code: "read_failed", outcome: "not-committed" });
}
function snapshotChanged() {
  return Object.assign(new Error("Base changed while reading the snapshot"), {
    status: 409, code: "revision_conflict", outcome: "not-committed",
  });
}
function snapshotSleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
async function readSnapshotOnce(request, signal) {
  signal?.throwIfAborted();
  const start = await request("base.meta", null, signal);
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(start?.revision) || typeof start?.baseInstanceId !== "string") throw snapshotError("Invalid Base metadata");
  const rows = [];
  const cursors = new Set();
  let cursor = "";
  do {
    const page = await request("base.rows", { limit: 500, cursor }, signal);
    signal?.throwIfAborted();
    if (page?.revision !== start.revision) throw snapshotChanged();
    if (!Array.isArray(page.rows)) throw snapshotError("Invalid Base rows");
    rows.push(...page.rows);
    cursor = page.nextCursor ?? "";
    if (typeof cursor !== "string" || (cursor && cursors.has(cursor))) throw snapshotError("Invalid Base cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const end = await request("base.meta", null, signal);
  signal?.throwIfAborted();
  if (end.revision !== start.revision || end.baseInstanceId !== start.baseInstanceId) throw snapshotChanged();
  return { meta: end, rows };
}
async function readBaseSnapshot(request, signal, sleep = snapshotSleep) {
  const delays = [250, 500, 1000];
  for (let attempt = 0; ; attempt += 1) {
    try { return await readSnapshotOnce(request, signal); }
    catch (error) {
      signal?.throwIfAborted();
      if (error?.status !== 409 || attempt === delays.length) throw error;
      await sleep(delays[attempt], signal);
    }
  }
}
`;
