/**
 * [INPUT]: Canonical plugin identity, interface locale and the shared lazy authoring draft entry.
 * [OUTPUT]: openPluginAuthoring selects Create mode and plugin source without allocating a Project or sending a message.
 * [POS]: Source entry shared by New plugin and Edit source; first-send submission owns source preparation.
 */
import type { WorkbenchCopy } from '@ai-chat/ui/lib/workbench-copy';
import { pluginAuthoringDraft } from '@/lib/plugin-platform/authoring';
import { effectiveLocale } from '@/lib/appearance/i18n-locale';
export async function openPluginAuthoring(_copy:WorkbenchCopy['guiHistory'],pluginId?:string){
  return pluginAuthoringDraft({pluginId},effectiveLocale());
}
