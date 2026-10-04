/**
 * [INPUT]: Depends on confirmed Project associations, a main-owned App availability check and this installation's device id.
 * [OUTPUT]: Provides a display-only source device, whether this computer still owes the Project a folder, and whether another installation published it.
 * [POS]: Project renderer projection; never creates a workspace capability, App role or grant.
 */

/**
 * Two questions, two fields. "This computer has no folder for it" and "another installation published it" are
 * independent — a restored profile is the first without being the second — and one boolean answering both is what
 * hid the "Choose folder…" entry behind a chip naming the computer the person was sitting at.
 */
export function projectCloudDisplay(project: import("../store/project-store").StoredProject,
  appAvailable: (appId: string) => boolean, localDeviceId: string | null) {
  if (!project.sync) return {};
  const binding = project.workspaceBinding, sourceDeviceId = project.sync.confirmed?.sourceDeviceId ?? null;
  return { cloud: { sourceDeviceId,
    needsLocalFolder: binding.kind === "none" || binding.kind === "unbound" || binding.kind === "app" && !appAvailable(binding.appId),
    /* A badge naming another computer is a claim; an installation that cannot name itself makes none. */
    foreignSource: Boolean(sourceDeviceId && localDeviceId && sourceDeviceId !== localDeviceId) } };
}
