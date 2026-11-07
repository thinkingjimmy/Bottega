/**
 * [INPUT]: Trusted main-window IPC with its live captured webContents identity, strict schemas and the isolated gateway.
 * [OUTPUT]: Unified catalog/install/version/source/Surface actions and revision notifications.
 * [POS]: Renderer boundary; no filesystem path is used as an iframe URL or a process launch plan.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { PLUGIN_PLATFORM_CHANNEL as C, pluginIdentitySchema, pluginPrepareAuthoringInputSchema,
  unifiedPluginInstallInputSchema, unifiedPluginListQuerySchema, unifiedPluginRestoreInputSchema } from "@bottega/contracts/plugins/platform";
import { rendererIpc } from "../../registration/ipc-registrar";
import type { UnifiedPluginPlatform } from "./service";
import type { PluginCloudPackages } from "../distribution/cloud";
import type { UnifiedPluginSurfaceGateway } from "./gateway";
const hostImpact = z.object({ revision: z.number().int().nonnegative(), digest: z.string().min(1).max(128) }).strict().optional();
const plugin = z.object({ pluginId: pluginIdentitySchema }).strict();
export function registerUnifiedPluginPlatform(platform: UnifiedPluginPlatform, window: BrowserWindow, rendererUrl: string,
  options: { gateway?: UnifiedPluginSurfaceGateway; packages?: PluginCloudPackages | (()=>Promise<PluginCloudPackages>) } = {}) {
  const webContentsId = window.webContents.id;
  const registrar = rendererIpc(rendererUrl, "Unified plugins are available to the main window only").roles("main");
  const packages = async () => { if (!options.packages) throw new Error("Plugin package delivery is unavailable"); return typeof options.packages==='function'?options.packages():options.packages; };
  registrar
    .handle(C.reviewUpdate, async input => (await packages()).review(input))
    .handle(C.acceptUpdate, async input => (await packages()).accept(input))
    .handle(C.dismissUpdate, async input => (await packages()).dismiss(z.object({ reviewId: z.string().uuid() }).strict().parse(input).reviewId))
    .handle(C.updateProgress, async input => (await packages()).progress(z.object({ operationId: pluginIdentitySchema }).strict().parse(input).operationId))
    .handle(C.cancelUpdate, async input => (await packages()).cancel(z.object({ operationId: pluginIdentitySchema }).strict().parse(input).operationId))
    .handle(C.sharingStatus, async input => (await packages()).sharingStatus(plugin.parse(input).pluginId))
    .handle(C.publishPlugin, async input => (await packages()).publish(plugin.parse(input).pluginId))
    .handle(C.list, query => platform.list(unifiedPluginListQuerySchema.parse(query ?? {})))
    .handle(C.get, id => platform.get(pluginIdentitySchema.parse(id)))
    .handle(C.install, input => platform.install(unifiedPluginInstallInputSchema.parse(input)))
    .handle(C.inspect, input => platform.inspect(z.object({ directory: z.string().min(1).max(32768) }).strict().parse(input)))
    .handle(C.setEnabled, input => platform.setEnabled(z.object({ pluginId: pluginIdentitySchema, enabled: z.boolean(), hostImpact }).strict().parse(input)))
    .handle(C.revisions, id => platform.revisions(pluginIdentitySchema.parse(id)))
    .handle(C.restore, input => platform.restore(unifiedPluginRestoreInputSchema.parse(input)))
    .handle(C.remove, input => platform.remove(z.object({ pluginId: pluginIdentitySchema, deleteData: z.boolean().optional(), hostImpact }).strict().parse(input)))
    .handle(C.modes, () => platform.modes())
    .handle(C.openFolder, async input => {
      if (!platform.options.openFolder) throw new Error("Plugin folder navigation is unavailable");
      await platform.options.openFolder(plugin.parse(input).pluginId);
    })
    .handle(C.prepareAuthoring, input => {
      if (!platform.options.prepareAuthoring) throw new Error("Plugin authoring is unavailable");
      return platform.options.prepareAuthoring(pluginPrepareAuthoringInputSchema.parse(input));
    })
    .handleWithContext(C.openSurface, (context, input) => {
      if (!options.gateway) throw new Error("Plugin interface hosting is unavailable");
      return options.gateway.open(z.object({ pluginId: pluginIdentitySchema, contributionId: pluginIdentitySchema, instanceId: pluginIdentitySchema.optional() }).strict().parse(input), context.webContentsId);
    })
    .handleWithContext(C.call, (context, input) => {
      if (!options.gateway) throw new Error("Plugin service is unavailable");
      return options.gateway.call(z.object({ leaseId: z.string().uuid(), method: z.string().min(1).max(128), input: z.unknown() }).strict().parse(input), context.webContentsId);
    })
    .handleBestEffortWithContext(C.releaseSurface, (context, input) => {
      options.gateway?.release(z.object({ leaseId: z.string().uuid() }).strict().parse(input).leaseId, context.webContentsId);
    });
  const release = platform.onChanged(event => { if (!window.isDestroyed()) window.webContents.send(C.changed, event); });
  window.once("closed", () => { release(); options.gateway?.releaseWindow(webContentsId); });
  return release;
}
