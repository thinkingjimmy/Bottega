/**
 * [INPUT]: Depends on node Buffer only; its limit and wording equal shared/builtin-tools/platform's backstop (pinned by a test), without importing it.
 * [OUTPUT]: Provides USER_DATA_SOCKETS (every socket main places under userData), userDataSocketHeadroom, UserDataSocketBudgetError and assertUserDataSocketBudget.
 * [POS]: Main-only socket budget: startup checks userData once before any custody or tool socket exists, and dev profiles check a name before creating it; kept out of platform.ts so the provider bridge bundle does not carry it.
 */
/* Not imported from shared/builtin-tools/platform: that module also loads in the provider bridge, and a main-only importer
   splits it into its own shared chunk (about +570 B on the bridge). The wording is pinned equal to the backstop's by a test. */
const UNIX_SOCKET_PATH_BYTE_LIMIT = 104;
export const unixSocketPathMessage = (path: string) =>
  `Unix socket path is ${Buffer.byteLength(path, "utf8")} bytes (limit ${UNIX_SOCKET_PATH_BYTE_LIMIT - 1}): ${path}`;

/** Every Unix socket main places under userData (relative, "/"-separated); the longest decides how long userData may be. */
export const USER_DATA_SOCKETS = [
  "agent-custody/guardian.sock",
  "host-custody/guardian.sock",
  "app-custody/guardian.sock",
  "builtin-tools/bridge.sock",
] as const;
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const LONGEST = USER_DATA_SOCKETS.reduce((a, b) => bytes(b) > bytes(a) ? b : a);

/** Bytes to spare before the longest userData socket reaches the limit; negative means some socket cannot exist. */
export function userDataSocketHeadroom(userData: string) {
  return UNIX_SOCKET_PATH_BYTE_LIMIT - 1 - (bytes(userData) + 1 + bytes(LONGEST));
}

/** userData leaves its longest socket too long: the person cannot fix this, so startup shows its own honest dialog. */
export class UserDataSocketBudgetError extends Error {
  constructor(readonly path: string, readonly over: number) { super(unixSocketPathMessage(path)); this.name = "UserDataSocketBudgetError"; }
}

/** Startup's early check, run right after userData is fixed; returns userData when every socket fits. */
export function assertUserDataSocketBudget(userData: string) {
  const headroom = userDataSocketHeadroom(userData);
  if (headroom >= 0) return userData;
  throw new UserDataSocketBudgetError(`${userData}/${LONGEST}`, -headroom);
}
