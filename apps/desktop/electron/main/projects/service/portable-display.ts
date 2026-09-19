/**
 * [INPUT]: Depends on confirmed Project associations and a main-owned App availability check.
 * [OUTPUT]: Provides a display-only source device and unbound remote marker.
 * [POS]: Project renderer projection; never creates a workspace capability, App role or grant.
 */

/** Unbound portable Projects remain readable without implying an installed App. */
export function projectCloudDisplay(project: import("../store/project-store").StoredProject, appAvailable: (appId: string) => boolean) {
  if (!project.sync) return {};
  const binding = project.workspaceBinding;
  return { cloud: { sourceDeviceId: project.sync.confirmed?.sourceDeviceId ?? null,
    remote: binding.kind === "none" || binding.kind === "unbound" || binding.kind === "app" && !appAvailable(binding.appId) } };
}
