/**
 * [INPUT]: Receives App roots, fixed identities and installed records from the sole App writer.
 * [OUTPUT]: Derives source paths separately from portable app.json and validates exact local residence.
 * [POS]: App folder path boundary; staging and compiled artifacts remain profile-local.
 */
import { isAbsolute, join, normalize } from "node:path";
import { libraryObjectId } from "../../../library/paths";
import type { AppRecord } from "../../../../../shared/apps-ipc";
import { statusError } from "../../../errors";
export function appSourceDirectory(root: string, appId: string, portable: boolean) {
  return join(root, libraryObjectId(appId), ...(portable ? ["source"] : []));
}
export function assertAppResidence(records: AppRecord[], root: string, portable: boolean) {
  for (const record of records) if (!isAbsolute(record.dir) || normalize(record.dir) !== normalize(appSourceDirectory(root, record.id, portable)))
    throw new Error(`App ${record.id} source directory is outside its owned folder`);
}
export function assertResidenceFenceStable(previous: AppRecord | undefined, next: AppRecord) {
  if (!previous?.activeUseSwitch) return;
  const bindingChanged = previous.generationBinding.bindingRevision !== next.generationBinding.bindingRevision ||
    (previous.generationBinding.active?.generationId ?? null) !== (next.generationBinding.active?.generationId ?? null);
  if (previous.state !== next.state || previous.lifecycleRevision !== next.lifecycleRevision || bindingChanged) {
    throw statusError(409, "APP_USE_RESIDENCE_MUTATION_BUSY");
  }
}
