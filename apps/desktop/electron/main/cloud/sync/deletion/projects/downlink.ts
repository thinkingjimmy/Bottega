/**
 * [INPUT]: Depends on the admitted encrypted-space deletion feed and the original scoped ProjectStore association.
 * [OUTPUT]: Stops Project metadata replay before acknowledging each independent Project deletion cursor.
 * [POS]: Project tombstone consumer; native content stays local and App custody remains with App retirement.
 */
import { sameScope } from "../../../../../../shared/local-storage/contracts";
import type { ProjectStore } from "../../../../projects/store/project-store";
import { pullDeletionPage, type DeletionFeedPorts, type DeletionHead } from "../feed";
export class DesktopProjectDeletions {
  constructor(private ports: DeletionFeedPorts & { projects: ProjectStore; changed(): void }) {}
  pull(shared?: DeletionHead) {
    return pullDeletionPage(this.ports, "projectDeletions", async marker => {
      if (marker.entityKind !== "project") return;
      this.ports.current(); const project = this.ports.projects.get(marker.entityId);
      if (!project || project.sync && !sameScope(project.sync.scope, this.ports.scope) || project.role === "base-custody" || project.workspaceBinding.kind === "app" || project.sync?.confirmed?.appId) return;
      await this.ports.projects.portable.acceptDeletion(this.ports.scope, project.id); this.ports.current(); this.ports.changed();
    }, shared);
  }
}
