/**
 * [INPUT]: Nothing.
 * [OUTPUT]: queryError and BaseGuiQueryError: every Base GUI data refusal as an HTTP-like status, a stable code and the commit outcome, the shape
 *           the desktop GUI API maps and the Web surface dispatcher translates.
 * [POS]: Schema-free leaf of bases/query. The kernel, cursor and rows reader import it instead of contract.ts, so a worker that only executes
 *        queries never evaluates the zod schemas (their zod features would otherwise join a chunk shared with the crypto worker).
 */
export type BaseGuiQueryError = Error & { status: number; code: string; outcome: "not-committed" | "unknown" };
/** Every Query V1 refusal: an HTTP-like status and a stable code; a 5xx never claims anything was committed or not. */
export function queryError(status: number, code: string, message: string): BaseGuiQueryError {
  return Object.assign(new Error(message), { status, code, outcome: status >= 500 ? "unknown" as const : "not-committed" as const });
}
