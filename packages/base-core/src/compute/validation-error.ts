/**
 * [INPUT]: Depends only on the standard Error object and structured Base failure details.
 * [OUTPUT]: Provides shared Base validation failures with status, code and commit outcome.
 * [POS]: Pure validation error boundary, independent of platform transports.
 */
export function statusError(status: number, message: string, extra: { code?: string; outcome?: "not-committed"; detail?: { columns: string[] } } = {}) {
  return Object.assign(new Error(message), { status }, extra);
}
