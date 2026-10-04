/**
 * [INPUT]: Depends on plugin catalog and record lease bridge contracts as types.
 * [OUTPUT]: Provides pluginsBridge and main-window global typings for catalog and record operations.
 * [POS]: apps/desktop/src/lib/apps; Renderer plugin bridge boundary; package frames receive only declared host messages.
 */
import type { PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import type { PluginSurfacesBridge, GuiGenerationsBridge } from "@bottega/contracts/plugins/surface/native";
import type { RecordPluginsBridge } from "@bottega/contracts/plugins/records/native";
declare global { interface Window { recordPlugins?: RecordPluginsBridge } }
declare global { interface Window { plugins?: PluginsBridge; pluginSurfaces?: PluginSurfacesBridge; guiGenerations?:GuiGenerationsBridge } }
export const pluginsBridge = (): PluginsBridge | null => window.plugins ?? null;
