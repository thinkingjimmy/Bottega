/**
 * [INPUT]: Depends on retained compiled Widget generations and the selected Library identity.
 * [OUTPUT]: Provides DockSourceGenerations for read-only definition metadata and sealed candidate/version preview.
 * [POS]: Retained execution adapter; new source Projects, Chats, builds and copies belong only to the unified platform.
 */
import type { WidgetDefinitionView } from "../../../../../shared/system-dock/widgets/authoring";
import type { DockItem } from "../../../../../shared/system-dock/layout";
import type { PluginSurfaceRuntime } from "../service";
export class DockSourceGenerations {
  private closed = true;
  constructor(private readonly ports: { libraryId(): string | null; runtime: PluginSurfaceRuntime }) {}
  async initialize() { this.closed = false; }
  definitions(): WidgetDefinitionView[] {
    if (this.closed || !this.ports.libraryId()) return [];
    return this.ports.runtime.list().flatMap(record => {
      const manifest = record.authoringManifest ?? record.generations.find(generation => generation.generationId === record.activeGenerationId)?.manifest;
      return manifest && "dock" in manifest ? [{ id: record.pluginId, name: manifest.name, description: manifest.summary, chatId: "",
        activeGenerationId: record.activeGenerationId, candidateGenerationId: record.candidateGenerationId, instanceCount: 0, error: record.error }] : [];
    });
  }
  replacement(_id: string): { item: Extract<DockItem, { kind: "widget" }>; name: string } | null { return null; }
  preview(id: string) { if (this.closed) throw new Error("DOCK_SOURCE_CLOSED"); return this.ports.runtime.dockPreview(id); }
  retainedReferences(): string[] { return []; }
  async close() { this.closed = true; }
}
