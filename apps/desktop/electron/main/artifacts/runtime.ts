/**
 * [INPUT]: The startup-owned artifact service lifetime.
 * [OUTPUT]: Optional domain wiring for turn, Fork and deletion integration; reconciliation stays a separate post-window step.
 * [POS]: Main-process composition cell; tests without artifact custody keep their existing ports.
 */
import { ArtifactService } from "./service";
let runtime: ArtifactService | undefined;
export const artifactRuntime = () => runtime;
export function configureArtifactRuntime(service: ArtifactService | undefined) { runtime = service; }

export async function initializeArtifacts(root: string, chats: ConstructorParameters<typeof ArtifactService>[1], libraryRoot: () => string | null) {
  const service = new ArtifactService(root, chats, libraryRoot); await service.initialize(); configureArtifactRuntime(service);
}
