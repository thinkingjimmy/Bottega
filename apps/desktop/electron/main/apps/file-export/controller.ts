/**
 * [INPUT]: Depends on live GUI bindings, Electron save dialogs, FileExportManager custody, and generation-fenced side-effect permits
 * [OUTPUT]: Provides renderer-facing begin/write/finalize/cancel operations with active-surface and file.export grant enforcement
 * [POS]: Trusted main-process adapter between Apps IPC and native file-export custody
 */

import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import type {
  BeginFileExportInputV1,
  CompleteFileExportInputV1,
  WriteFileExportChunkInputV1,
} from "../../../../shared/app-gui/file-export";
import type { BaseGuiLiveBinding } from "../../../../shared/apps-ipc";
import { GuiSideEffectRegistry } from "../gui-cutover/side-effects";
import { FileExportManager } from "./manager";

type BindingResolver = (input: BeginFileExportInputV1["surface"]) => BaseGuiLiveBinding | null;

export class AppFileExportController {
  private readonly effects = new Map<string, GuiSideEffectRegistry>();
  private readonly manager: FileExportManager;

  constructor(
    userData: string,
    private readonly bindingFor: BindingResolver,
    windowFor: () => BrowserWindow | null
  ) {
    this.manager = new FileExportManager(userData, {
      chooseDestination: async ({ suggestedName, mediaType }) => {
        const window = windowFor();
        const extension = suggestedName.includes(".")
          ? suggestedName.slice(suggestedName.lastIndexOf(".") + 1)
          : "";
        const options = {
          defaultPath: suggestedName,
          filters: [{ name: exportLabel(mediaType), extensions: extension ? [extension] : [] }],
        };
        const result = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options);
        return result.canceled ? null : result.filePath;
      },
      startPermit: (permit) => this.effectsFor(permit.appId).start(permit),
      completePermit: (permit, result) => {
        const effects = this.effectsFor(permit.appId);
        effects.complete(permit, result);
        effects.deliver(permit);
      },
      audit: (event) => console.info("[app-gui:file-export]", JSON.stringify(event)),
    });
  }

  initialize() {
    return this.manager.initialize();
  }

  closeAndFlush() {
    return this.manager.closeAndFlush();
  }

  artifactRoots() {
    return this.manager.artifactRoots();
  }

  async begin(input: BeginFileExportInputV1) {
    const binding = this.requireBinding(input.surface);
    const surfaceLeaseId = binding.appSurfaceLeaseId;
    const decisionId = binding.capabilityDecisionId;
    if (!surfaceLeaseId || !decisionId) {
      throw Object.assign(new Error("FILE_EXPORT_SURFACE_INVALID"), { status: 401 });
    }
    const effects = this.effectsFor(binding.appId);
    const permit = effects.issue({
      appId: binding.appId,
      generationId: binding.generationId,
      surfaceId: binding.surfaceId,
      kind: "file-export",
      ttlMs: 60_000,
    });
    try {
      const result = await this.manager.begin({
        request: input.request,
        binding: {
          appId: binding.appId,
          generationId: binding.generationId,
          surfaceLeaseId,
          runtimeSurfaceId: binding.surfaceId,
          decisionId,
          cutoverRevision: binding.lifecycleRevision,
        },
        permit,
        granted: binding.hostActions.includes("file.export"),
        trustedGestureAt: input.trustedGestureAt,
      });
      if (result.status !== "accepted") effects.cancel(permit);
      return result;
    } catch (cause) {
      effects.cancel(permit);
      throw cause;
    }
  }

  write(input: WriteFileExportChunkInputV1) {
    const binding = this.requireBinding(input.surface);
    return this.manager.write(input.header, input.bytes, binding.surfaceId);
  }

  finalize(input: CompleteFileExportInputV1) {
    const binding = this.requireBinding(input.surface);
    return this.manager.finalize(input.exportId, binding.surfaceId);
  }

  cancel(input: CompleteFileExportInputV1) {
    const binding = this.requireBinding(input.surface);
    return this.manager.cancel(input.exportId, "cancelled", binding.surfaceId);
  }

  closeSurface(surfaceId: string) {
    for (const effects of this.effects.values()) effects.cancelSurface(surfaceId);
    return this.manager.closeSurface(surfaceId);
  }

  async closeApp(appId: string) {
    await this.manager.closeApp(appId);
    this.effects.delete(appId);
  }

  closeAdmission(appId: string) {
    this.effectsFor(appId).closeAdmission();
  }

  drain(appId: string, generationId: string, deadlineMs: number) {
    return this.effectsFor(appId).drain(generationId, deadlineMs);
  }

  reopenAdmission(appId: string) {
    this.effectsFor(appId).reopenWithNewOwner();
  }

  private requireBinding(surface: BeginFileExportInputV1["surface"]) {
    const binding = this.bindingFor(surface);
    if (
      !binding ||
      binding.appId !== surface.appId ||
      binding.surfaceId !== surface.surfaceId ||
      binding.appSurfaceLeaseId !== surface.appSurfaceLeaseId ||
      !binding.capabilityDecisionId
    ) {
      throw Object.assign(new Error("FILE_EXPORT_SURFACE_INVALID"), { status: 401 });
    }
    return binding;
  }

  private effectsFor(appId: string) {
    const current = this.effects.get(appId);
    if (current) return current;
    const created = new GuiSideEffectRegistry();
    this.effects.set(appId, created);
    return created;
  }
}

function exportLabel(mediaType: string) {
  if (mediaType === "application/json") return "JSON";
  if (mediaType.startsWith("image/")) return "Image";
  if (mediaType.startsWith("text/csv")) return "CSV";
  return "Text";
}
