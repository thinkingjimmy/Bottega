/**
 * [INPUT]: Trusted main-window registrar, team snapshots and feature service.
 * [OUTPUT]: Team list/detail/task/stop/navigation actions and exact revision notifications.
 * [POS]: Native team panel boundary; member process execution remains behind the service host port.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { PLUGIN_TEAM_CHANNEL as C } from "@bottega/contracts/plugins/team";
import { pluginIdentitySchema as id } from "@bottega/contracts/plugins/platform";
import { rendererIpc } from "../../registration/ipc-registrar";
import type { PluginTeamService } from "./service";
export function registerPluginTeams(service: PluginTeamService, window: BrowserWindow, rendererUrl: string) {
  rendererIpc(rendererUrl, "Teams are available to the main window only").roles("main")
    .handle(C.list, input => service.list(z.object({ leadChatId: id.optional() }).strict().parse(input ?? {})))
    .handle(C.get, input => service.get(z.object({ teamId: id }).strict().parse(input).teamId))
    .handle(C.createTask, input => service.createTask(z.object({ teamId: id, title: z.string().min(1).max(300),
      description: z.string().max(16_384).optional(), ownerMemberId: id.nullable().optional(), dependencies: z.array(id).max(256).optional() }).strict().parse(input)))
    .handle(C.stopMember, input => service.stopMember(z.object({ teamId: id, memberId: id }).strict().parse(input)))
    .handle(C.openMember, input => service.openMember(z.object({ teamId: id, memberId: id }).strict().parse(input)));
  const release = service.onChanged(event => { if (!window.isDestroyed()) window.webContents.send(C.changed, event); });
  window.once("closed", release); return release;
}
