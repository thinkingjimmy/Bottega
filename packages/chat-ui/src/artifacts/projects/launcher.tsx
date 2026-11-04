/**
 * [INPUT]: Original Artifact host capability, optional immutable ZIP fence and user activation.
 * [OUTPUT]: A small Add-menu action or file-card button with a lazily mounted project import dialog.
 * [POS]: Composer/file entry; importing does not create a model submission or alter the current draft.
 */
import { lazy, Suspense, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { useArtifactHost } from "../context";
const ImportDialog = lazy(() => import("./import").then(module => ({ default: module.ProjectImportDialog })));
const label = (locale: string) => locale.startsWith("zh") ? "导入项目" : locale.startsWith("ja") ? "プロジェクトをインポート" : locale.startsWith("es") ? "Importar proyecto" : locale.startsWith("fr") ? "Importer un projet" : "Import project";
export function useProjectImportAction(fence?: ArtifactFence) {
  const host = useArtifactHost(), [open, setOpen] = useState<string | null>(null);
  return { action: host?.importProject ? { label: label(host.locale), run: () => setOpen(host.scope) } : undefined,
    dialog: open === host?.scope && host?.importProject ? <Suspense fallback={null}><ImportDialog key={host.scope} host={host} fence={fence} close={() => setOpen(null)} /></Suspense> : null };
}
export function ArtifactProjectImport({ fence }: { fence: ArtifactFence }) {
  const project = useProjectImportAction(fence);
  return project.action ? <><Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={project.action.run}>{project.action.label}</Button>{project.dialog}</> : null;
}
