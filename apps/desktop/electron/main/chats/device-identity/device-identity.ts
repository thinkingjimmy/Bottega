/**
 * [INPUT]: Depends on Node crypto/fs/path and one userData root
 * [OUTPUT]: Provides the sole installation-scoped deviceId load-or-create authority with 0600 atomic persistence and fail-closed parsing
 * [POS]: Chat execution identity boundary; the SQLite database may reference this id but never owns or carries it
 */

import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

const FILE_NAME = "device-identity.json";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class DeviceIdentityCorruptError extends Error {
  override name = "DeviceIdentityCorruptError";
}

type DeviceIdentity = Readonly<{
  version: 1;
  deviceId: string;
}>;

const parseIdentity = (raw: string): DeviceIdentity => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DeviceIdentityCorruptError("device identity is not valid JSON");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== "deviceId,version" ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { deviceId?: unknown }).deviceId !== "string" ||
    !UUID_PATTERN.test((value as { deviceId: string }).deviceId)
  ) {
    throw new DeviceIdentityCorruptError("device identity has an invalid shape");
  }
  return value as DeviceIdentity;
};

async function fsyncDirectory(path: string) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function assertPrivateRegularFile(path: string) {
  const value = await lstat(path);
  if (!value.isFile() || value.isSymbolicLink()) {
    throw new DeviceIdentityCorruptError(
      "device identity must be a regular file"
    );
  }
  if (process.platform !== "win32" && (value.mode & 0o077) !== 0) {
    await chmod(path, 0o600);
  }
}

export class DeviceIdentityStore {
  readonly path: string;

  constructor(userData: string) {
    this.path = join(userData, FILE_NAME);
  }

  async loadOrCreate(): Promise<string> {
    try {
      await assertPrivateRegularFile(this.path);
      return parseIdentity(await readFile(this.path, "utf8")).deviceId;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }

    const identity: DeviceIdentity = { version: 1, deviceId: randomUUID() };
    const temporary = `${this.path}.tmp-${randomUUID()}`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(identity)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      // POSIX rename overwrites the winner. link gives create-if-absent semantics,
      // so concurrent first launches converge on exactly one installation id.
      await link(temporary, this.path);
      await fsyncDirectory(dirname(this.path));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    await assertPrivateRegularFile(this.path);
    return parseIdentity(await readFile(this.path, "utf8")).deviceId;
  }
}
