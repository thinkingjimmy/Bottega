/**
 * [INPUT]: Canonical folder admission, identity/publisher readers, machine identity and the birth-qualified folder lock.
 * [OUTPUT]: acquireLibraryAccess validates an existing or explicitly new folder and returns its held lock and identity.
 * [POS]: Shared opening boundary used by normal startup and recovery; it never commits profile settings or relocation.
 */
import { mkdir, lstat, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { isErrnoCode } from "../../persistence/durable-json";
import { LibraryError } from "../errors";
import { openLibraryIdentity, readLibraryIdentity } from "../identity";
import { acquireLibraryLock } from "../lock";
import { readPublisher } from "../publisher";
import { assertAdmissibleLibraryRoot } from "./admission";

export async function acquireLibraryAccess(input: { root: string; installationId: string; userData?: string;
  expectedId?: string | null; machineIdHash?: () => Promise<string | null>; create?: boolean; requireIdentity?: boolean; signal?: AbortSignal }) {
  const check = () => input.signal?.throwIfAborted();
  check();
  if (input.create) await mkdir(input.root, { recursive:true, mode:0o700 });
  const present = await stat(input.root).catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
  check();
  if (!present?.isDirectory()) throw new LibraryError("missing");
  const root = await realpath(input.root);
  await assertAdmissibleLibraryRoot(root);
  const control = join(root, ".bottega");
  const existing = await lstat(control).catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new LibraryError("control-invalid");
  const identity = existing ? await readLibraryIdentity(root) : null;
  if ((input.requireIdentity || input.expectedId) && !identity) throw new LibraryError("control-invalid");
  if (input.expectedId && identity?.libraryId !== input.expectedId) throw new LibraryError("identity-changed");
  const machine = await input.machineIdHash?.();
  const publisher = await readPublisher(root);
  if (machine && publisher && publisher.machineIdHash !== machine) throw new LibraryError("owned-elsewhere", `LIBRARY_OWNED_ELSEWHERE: ${publisher.host}`, publisher.host);
  check();
  if (!existing) await mkdir(control, { mode:0o700 });
  const lock = await acquireLibraryLock(control, input.installationId, { userData:input.userData });
  try {
    check();
    // Read again under the lock: a chooser/discovery result is never authority to open a replaced folder.
    const opened = await openLibraryIdentity(control);
    if (input.expectedId && opened.libraryId !== input.expectedId) throw new LibraryError("identity-changed");
    check();
    return { root, identity:opened, lock };
  } catch (error) { await lock.close(); throw error; }
}
