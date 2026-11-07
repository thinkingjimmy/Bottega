/**
 * [INPUT]: Plugin, team, Surface and record channel contracts plus trusted role-filtered IPC helpers.
 * [OUTPUT]: Main-only unified plugin catalog/source/Surface actions, team actions, original plugin settings, initialization retry and record lease/result bridges, with resident-window surface and generation bridges.
 * [POS]: Native preload registration; isolated package frames receive no bridge.
 */
import { contextBridge, ipcRenderer } from "electron";
import { PLUGIN_TEAM_CHANNEL as TEAM, type PluginTeamBridge } from "@bottega/contracts/plugins/team/bridge";
import { PLUGIN_PLATFORM_CHANNEL as PLATFORM, type UnifiedPluginBridge } from "@bottega/contracts/plugins/platform/bridge/index";
import { PLUGINS_CHANNEL } from "@ai-chat/cloud-protocol/contracts/plugins/channel";
import type { PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { PLUGIN_SURFACES_CHANNEL as SURFACE, GUI_GENERATIONS_CHANNEL as HISTORY } from "@bottega/contracts/plugins/surface/native";
import type { PluginSurfacesBridge, GuiGenerationsBridge } from "@bottega/contracts/plugins/surface/native";
import { RECORD_PLUGINS_CHANNEL as RECORD, type RecordPluginsBridge } from "@bottega/contracts/plugins/records/native";

export function installPluginsBridge(subscribe: <T>(channel: string) => (callback: (value: T) => void) => () => void) {
  contextBridge.exposeInMainWorld("recordPlugins", Object.fromEntries(Object.entries(RECORD).map(([method, channel]) =>
    [method, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])) as unknown as RecordPluginsBridge);
  const teamChanged = subscribe<{ teamId: string; revision: number }>(TEAM.changed);
  contextBridge.exposeInMainWorld("pluginTeams", {
    ...Object.fromEntries(Object.entries(TEAM).filter(([method]) => method !== "changed").map(([method, channel]) =>
      [method, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])), onChanged: teamChanged,
  } as PluginTeamBridge);
  const platformChanged = subscribe<{ revision: number }>(PLATFORM.changed);
  contextBridge.exposeInMainWorld("pluginPlatform", {
    ...Object.fromEntries(Object.entries(PLATFORM).filter(([method]) => method !== "changed").map(([method, channel]) =>
      [method, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])),
    onChanged: platformChanged,
  } as UnifiedPluginBridge);
  const changed = subscribe<void>(PLUGINS_CHANNEL.changed);
  contextBridge.exposeInMainWorld("plugins", {
    list: () => ipcRenderer.invoke(PLUGINS_CHANNEL.list),
    detail: (pluginId) => ipcRenderer.invoke(PLUGINS_CHANNEL.detail, pluginId),
    settings: (pluginId) => ipcRenderer.invoke(PLUGINS_CHANNEL.settings, pluginId),
    setSettings: (pluginId, patch, confirmation) => ipcRenderer.invoke(PLUGINS_CHANNEL.setSettings, pluginId, patch, confirmation),
    setEnabled: (pluginId, enabled) => ipcRenderer.invoke(PLUGINS_CHANNEL.setEnabled, pluginId, enabled),
    disableImpact: (installIdentity) => ipcRenderer.invoke(PLUGINS_CHANNEL.disableImpact, installIdentity),
    onChanged: (listener) => changed(() => listener()),
  } satisfies PluginsBridge);
}

export function installPluginSurfacesBridge(subscribe: <T>(channel: string) => (callback: (value: T) => void) => () => void) {
  const surfaceChanged = subscribe<void>(SURFACE.changed);
  contextBridge.exposeInMainWorld("pluginSurfaces", {
    list: () => ipcRenderer.invoke(SURFACE.list),
    open: (id, owner) => ipcRenderer.invoke(SURFACE.open, id, owner),
    openRemote: (id, ownerDeviceId, owner) => ipcRenderer.invoke(SURFACE.openRemote, id, ownerDeviceId, owner),
    validate: id => ipcRenderer.invoke(SURFACE.validate, id),
    release: id => ipcRenderer.invoke(SURFACE.release, id),
    onChanged: listener => surfaceChanged(listener),
    history: id => ipcRenderer.invoke(SURFACE.history, id),
    retryInitialization: id => ipcRenderer.invoke(SURFACE.retryInitialization, id),
    activate: (id, generationId, expected) => ipcRenderer.invoke(SURFACE.activate, id, generationId, expected),
    recovery: {
      read: scope => ipcRenderer.invoke(SURFACE.recoveryRead, scope),
      write: (scope, source) => ipcRenderer.invoke(SURFACE.recoveryWrite, scope, source),
      remove: scope => ipcRenderer.invoke(SURFACE.recoveryRemove, scope),
    },
  } satisfies PluginSurfacesBridge);
  contextBridge.exposeInMainWorld("guiGenerations", {
    history: owner => ipcRenderer.invoke(HISTORY.history, owner),
    activate: (owner, generationId, expected) => ipcRenderer.invoke(HISTORY.activate, owner, generationId, expected),
  } satisfies GuiGenerationsBridge);
}
