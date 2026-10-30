/**
 * [INPUT]: Depends on canonical turns, retained activity receipts, Chat events, coordinator preparations, update state, product windows, and trusted IPC.
 * [OUTPUT]: Provides cross-platform background presence, independent menu bar IPC, readonly Dock tasks, guarded destinations across Main readiness waits, a shared native recovery menu and main-authorized unread receipts.
 * [POS]: Presence composition beneath the desktop root; auxiliary renderers never receive product capabilities.
 */

import { app, shell } from "electron";
import { devRendererUrl } from "../window/security/frame-guard";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { SettingsStore } from "../settings/settings-store";
import type { ChatsService } from "../chats/service/chats-service";
import type { UpdateService } from "../update/service";
import { turns, activity } from "../agent/bridge/agent-bridge";
import { windowRegistry } from "../window/surfaces/window-registry";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import { WINDOW_SURFACES_CHANNEL, chatSurface, type SurfaceMigrationCommand } from "../../../shared/ipc/settings/window-surfaces-ipc";
import { PRESENCE_CHANNEL, type TaskReference } from "../../../shared/ipc/agent/presence-ipc";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { rendererIpc } from "../registration/ipc-registrar";
import { presenceCapabilities } from "./platform/capabilities";
import type { LoginItemPort } from "./platform/login-item";
import { ActivityProjection } from "./activity-projection";
import { PresenceService } from "./service";
import { PresenceTray } from "./tray";
import { UnreadConsumption } from "./lifecycle/unread";
import type { WindowRetention } from "./lifecycle/window-retention";

export function createPresenceRuntime(ports: { mainDirectory: string; settings: SettingsStore; chats: ChatsService;
  update: UpdateService; coordinator: ConversationCoordinator; login: LoginItemPort; retention: WindowRetention; locale(): AppLocale; quit(): void; quitting(): boolean;
  dockMenu?(): Electron.MenuItemConstructorOptions | null }) {
  const capabilities = presenceCapabilities(process.platform);
  const resourcesPath = app.isPackaged ? process.resourcesPath : join(ports.mainDirectory, "../../resources");
  const rendererUrl = devRendererUrl(app.isPackaged) ?? pathToFileURL(join(ports.mainDirectory, "../renderer/index.html")).href;
  const projection = new ActivityProjection({ turns, activity, chats: ports.chats, pending: () => ports.coordinator.pendingStopOperations(), onPendingChanged: (listener) => ports.coordinator.onPendingChanged(listener) });
  const send = async (command: SurfaceMigrationCommand, current:()=>boolean=()=>true) => {
    if(!current())throw new Error('DESTINATION_UNAVAILABLE');
    const main = await ports.retention.ensureMain();
    if(!current())throw new Error('DESTINATION_UNAVAILABLE');
    main.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, command); ports.retention.open();
  };
  const openTask = async (raw: TaskReference, current:()=>boolean=()=>true) => {
    if(!current())throw new Error('TASK_UNAVAILABLE');
    if (!raw || typeof raw.chatId !== "string" || typeof raw.incarnationId !== "string" || raw.chatId.length > 128 || raw.incarnationId.length > 128) throw new Error("TASK_REFERENCE_INVALID");
    const chat = ports.chats.store.getChatRef(raw.chatId);
    if (!chat || chat.incarnationId !== raw.incarnationId) throw new Error("TASK_UNAVAILABLE");
    const ownerId = surfaceWindowController.residence.get(chatSurface(chat.id, chat.incarnationId)).windowId;
    const owner = ownerId ? windowRegistry.get(ownerId) : undefined;
    if (owner?.role === "app-window" && current() && windowRegistry.focus(owner.windowId)) return;
    await send({ type: "navigate", route: `/chat/${encodeURIComponent(chat.id)}` },()=>current()&&ports.chats.store.getChatRef(raw.chatId)?.incarnationId===raw.incarnationId);
  };
  const tray = new PresenceTray({ resources: resourcesPath, quitting: ports.quitting, locale: ports.locale, activities: () => projection.snapshot(),
    update: () => ports.update.snapshot(), open: () => ports.retention.open(), pending: () => { void send({ type: "presence-destination", destination: "activity" }); },
    failed: () => { void service.refresh(); }, quit: ports.quit, install: (candidateId) => { void ports.update.installNow(candidateId); }, dock: ports.dockMenu });
  const service = new PresenceService({ settings: ports.settings, quitting: ports.quitting, supported: capabilities.background, login: ports.login, tray,
    restoreMain: () => { if (!windowRegistry.main()?.window.isVisible?.()) ports.retention.open(); } });
  const unread = new UnreadConsumption({ windows: windowRegistry,
    incarnation: (chatId) => ports.chats.store.getIncarnationId(chatId), consume: (receipt) => activity.consume(receipt),
    assertScope: (context, chatId) => surfaceWindowController.assertConversationMutation(context, chatId) });
  const stop = [ports.settings.onChanged(() => tray.refresh()), projection.onChanged(() => tray.refresh()), ports.update.onChanged(() => tray.refresh()),
    service.onChanged((value) => { windowRegistry.publish(PRESENCE_CHANNEL.changed, value, (record) => record.role === "main"); tray.refresh(); })];
  rendererIpc(rendererUrl, "Rejected untrusted presence request")
    .handle(PRESENCE_CHANNEL.snapshot, () => service.snapshot())
    .handle(PRESENCE_CHANNEL.refresh, () => service.refresh())
    .handle(PRESENCE_CHANNEL.observe, () => service.observe())
    .handle(PRESENCE_CHANNEL.setLaunchAtLogin, (value) => service.setLaunchAtLogin(value as boolean))
    .handle(PRESENCE_CHANNEL.setWindowRetention, (value) => service.setWindowRetention(value as boolean))
    .handle(PRESENCE_CHANNEL.setMenuBar, (value) => service.setMenuBar(value as boolean))
    .handle(PRESENCE_CHANNEL.openSystemSettings, () => { if (process.platform === "darwin") return shell.openExternal("x-apple.systempreferences:com.apple.LoginItems-Settings.extension"); })
    .roles("main", "app-window").handleWithContext(PRESENCE_CHANNEL.presented, (context, value) => unread.presented(context, value));
  return { service, send, tasks: { snapshot: () => projection.snapshot(), subscribe: (listener: () => void) => projection.onChanged(listener), open: openTask }, refreshMenu: () => tray.refresh(), initialize: () => service.initialize(), close() { stop.forEach((stop) => stop()); service.close(); projection.close(); } };
}
