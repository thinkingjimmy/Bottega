/**
 * [INPUT]: Read-only picker admission, identity/ownership and shared opening/relocation APIs.
 * [OUTPUT]: Classifies an existing or new destination and adopts it only after normal admission and explicit new-folder consent.
 * [POS]: Recovery filesystem boundary; cancelled selection never creates a directory or changes settings.
 */
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { LibraryError } from "../../../library/errors";
import { readLibraryIdentity } from "../../../library/identity";
import { resolveLibraryChoice } from "../../../library/safety/admission";
import { acquireLibraryAccess } from "../../../library/safety/open";
import { clearRelocation, writeRelocation } from "../../../library/relocation/journal";
import { machineIdFor } from "../../../machine/machine-id";
import type { StartupRecoveryLibrary } from "../interface";

export type FolderSelection = { kind:"existing" | "new"; path:string; picked:string };

async function checkControl(root: string) {
  const control = await lstat(join(root, ".bottega")).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (control && (!control.isDirectory() || control.isSymbolicLink() || !await readLibraryIdentity(root))) throw new LibraryError("control-invalid");
}

export async function classifyFolder(picked: string): Promise<FolderSelection> {
  const canonical = await realpath(picked);
  await checkControl(canonical);
  const choice = await resolveLibraryChoice(canonical);
  await checkControl(choice.root);
  return { kind:await readLibraryIdentity(choice.root) ? "existing" : "new", path:choice.root, picked:canonical };
}

export async function adoptFolder(input: { selection:FolderSelection; library:StartupRecoveryLibrary; userData:string; installationId:string; signal:AbortSignal }) {
  const { selection, library, signal } = input;
  signal.throwIfAborted();
  if (selection.kind === "new") {
    const fresh = await classifyFolder(selection.picked);
    if (fresh.kind !== "new" || fresh.path !== selection.path) throw new LibraryError("identity-changed");
  }
  const previous = library.settings.get();
  const access = await acquireLibraryAccess({ root:selection.path, installationId:input.installationId, userData:input.userData,
    machineIdHash:machineIdFor("cloud"), expectedId:selection.kind === "existing" ? previous.libraryId : null,
    requireIdentity:selection.kind === "existing", create:selection.kind === "new", signal });
  try {
    signal.throwIfAborted();
    if (selection.kind === "existing" && previous.libraryRoot && previous.libraryRoot !== access.root) {
      await writeRelocation(input.userData, { kind:"adopt", from:previous.libraryRoot, to:access.root, libraryId:access.identity.libraryId });
    } else {
      if (selection.kind === "new") await clearRelocation(input.userData);
      await library.settings.setTrusted({ libraryRoot:access.root, chatHomesRoot:access.root, libraryId:access.identity.libraryId });
    }
  } finally { await access.lock.close(); }
  signal.throwIfAborted();
  await library.retry();
}
