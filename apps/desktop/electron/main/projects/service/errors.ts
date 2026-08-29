/**
 * [INPUT]: Depends only on standard Error cause and structural status metadata
 * [OUTPUT]: Provides statusError for Projects domain failures crossing IPC/service boundaries
 * [POS]: Projects/service shared error constructor; keeps transport metadata uniform without bloating ProjectsService
 */

export function statusError(status: number, message: string, cause?: unknown) {
  return Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { status }
  );
}
