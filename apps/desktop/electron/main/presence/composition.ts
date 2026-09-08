/**
 * [INPUT]: Depends on canonical turns, retained activity receipts, Chat events, coordinator preparations, update state, product windows, and trusted IPC.
 * [OUTPUT]: Provides process-owned presence, shared shortcut bindings, manual panel intents, task destinations, a shared native recovery menu, and main-authorized unread receipts.
 * [POS]: Presence composition beneath the desktop root; auxiliary renderers never receive product capabilities.
 */

import { app, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { SettingsStore } from "../settings-store";
import type { ChatsService } from "../chats/chats-service";
import type { UpdateService } from "../update/service";
import { turns, activity } from "../agent-bridge";
import { windowRegistry } from "../window/surfaces/window-registry";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import { WINDOW_SURFACES_CHANNEL, chatSurface, type SurfaceMigrationCommand } from "../../../shared/window-surfaces-ipc";
import { PRESENCE_CHANNEL, type TaskPanelIntent, type TaskReference } from "../../../shared/presence-ipc";
import type { AppLocale } from "../../../shared/i18n/locale";
import { rendererIpc } from "../ipc-registrar";
import { supportsPresence } from "./platform/macos";
import type { LoginItemPort } from "./platform/login-item";
import { ActivityProjection } from "./activity-projection";
import { PresenceService } from "./service";
import { PresenceTray } from "./tray";
import { resolvePanelBinding } from "../../../shared/shortcuts/bindings";
import { TaskPanelController } from "./notch/controller";
import { UnreadConsumption } from "./lifecycle/unread";
import type { WindowRetention } from "./lifecycle/window-retention";

export function createPresenceRuntime(ports: { mainDirectory: string; settings: SettingsStore; chats: ChatsService;
  update: UpdateService; coordinator: ConversationCoordinator; login: LoginItemPort; retention: WindowRetention; locale(): AppLocale; quit(): void; quitting(): boolean }) {
  const resourcesPath = app.isPackaged ? process.resourcesPath : join(ports.mainDirectory, "../../resources");
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(ports.mainDirectory, "../renderer/index.html")).href;
  const projection = new ActivityProjection({ turns, activity, chats: ports.chats, pending: () => ports.coordinator.pendingStopOperations(), onPendingChanged: (listener) => ports.coordinator.onPendingChanged(listener) });
  const send = async (command: SurfaceMigrationCommand) => {
    const main = await ports.retention.ensureMain(); main.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, command); ports.retention.open();
  };
  const openTask = async (raw: TaskReference) => {
    if (!raw || typeof raw.chatId !== "string" || typeof raw.incarnationId !== "string" || raw.chatId.length > 128 || raw.incarnationId.length > 128) throw new Error("TASK_REFERENCE_INVALID");
    const chat = ports.chats.store.getChatRef(raw.chatId);
    if (!chat || chat.incarnationId !== raw.incarnationId) throw new Error("TASK_UNAVAILABLE");
    const ownerId = surfaceWindowController.residence.get(chatSurface(chat.id, chat.incarnationId)).windowId;
    const owner = ownerId ? windowRegistry.get(ownerId) : undefined;
    if (owner?.role === "app-window" && windowRegistry.focus(owner.windowId)) return;
    await send({ type: "navigate", route: `/chat/${encodeURIComponent(chat.id)}` });
  };
  const action = async (intent: TaskPanelIntent) => {
    if (intent.kind === "open-task") return openTask(intent.task);
    if (intent.kind === "open-settings") return send({ type: "presence-destination", destination: "general" });
    ports.retention.open();
  };
  const tray = new PresenceTray({ resources: resourcesPath, quitting: ports.quitting, locale: ports.locale, activities: () => projection.snapshot(),
    update: () => ports.update.snapshot(), open: () => ports.retention.open(), pending: () => { void send({ type: "presence-destination", destination: "activity" }); },
    failed: () => { void service.refresh(); }, quit: ports.quit, install: (candidateId) => { void ports.update.installNow(candidateId); } });
  const panel = new TaskPanelController({ mainDirectory: ports.mainDirectory, resourcesPath, nativePath: app.isPackaged ? undefined : join(ports.mainDirectory, "../presence/bin/screen-bridge"), rendererUrl: process.env.ELECTRON_RENDERER_URL,
    locale: ports.locale, action, menu: (window) => tray.popup(window), failed: () => service.panelFailed(), changed: () => service.notifyLifecycle(),
    binding: () => resolvePanelBinding(ports.settings.get().keyboardShortcuts), mainFocused: () => windowRegistry.main()?.window.isFocused?.() ?? false });
  const service = new PresenceService({ settings: ports.settings, quitting: ports.quitting, supported: supportsPresence, login: ports.login, tray, panel,
    restoreMain: () => { if (!windowRegistry.main()?.window.isVisible?.()) ports.retention.open(); } });
  const unread = new UnreadConsumption({ windows: windowRegistry,
    incarnation: (chatId) => ports.chats.store.getIncarnationId(chatId), consume: (receipt) => activity.consume(receipt),
    assertScope: (context, chatId) => surfaceWindowController.assertConversationMutation(context, chatId) });
  const stop = [ports.settings.onChanged(() => panel.refreshShortcut()), projection.onChanged((value) => { tray.refresh(); panel.update(value); }), ports.update.onChanged(() => tray.refresh()),
    service.onChanged((value) => { windowRegistry.publish(PRESENCE_CHANNEL.changed, value, (record) => record.role === "main"); tray.refresh(); })];
  panel.update(projection.snapshot());
  rendererIpc(rendererUrl, "Rejected untrusted presence request")
    .handle(PRESENCE_CHANNEL.snapshot, () => service.snapshot())
    .handle(PRESENCE_CHANNEL.refresh, () => service.refresh())
    .handle(PRESENCE_CHANNEL.openPanel, () => { if (!ports.quitting()) return panel.open(); })
    .handle(PRESENCE_CHANNEL.togglePanel, () => { if (!ports.quitting()) return panel.toggle(); })
    .handle(PRESENCE_CHANNEL.observe, () => service.observe())
    .handle(PRESENCE_CHANNEL.setLaunchAtLogin, (value) => service.setLaunchAtLogin(value as boolean))
    .handle(PRESENCE_CHANNEL.setWindowRetention, (value) => service.setWindowRetention(value as boolean))
    .handle(PRESENCE_CHANNEL.openSystemSettings, () => { if (supportsPresence) return shell.openExternal("x-apple.systempreferences:com.apple.LoginItems-Settings.extension"); })
    .roles("main", "app-window").handleWithContext(PRESENCE_CHANNEL.presented, (context, value) => unread.presented(context, value));
  return { service, initialize: () => service.initialize(), close() { stop.forEach((stop) => stop()); service.close(); projection.close(); } };
}
