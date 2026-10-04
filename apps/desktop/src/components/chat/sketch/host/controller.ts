/**
 * [INPUT]: Depends on renderer composer owners, source pins, current locale catalogs, modal keyboard ownership, and stable invocation focus anchors.
 * [OUTPUT]: Provides one route-independent Sketch session and deterministic close/focus behavior.
 * [POS]: Stable host controller; never imports the editor, Konva, or worker runtime.
 */
import {
  assertComposerOwner,
  captureComposerOwner,
  type ComposerOwner,
} from "@/lib/chat/state/composer/chat-composer-store";
import {
  pinSketchEditor,

  releaseSketchEditor,
} from "@/lib/chat-composer/sketch";
import type {PluginComposerEntry} from '@ai-chat/chat-ui/plugins/host/contracts';
import type {PluginSource} from '@bottega/contracts/plugins/surface/source';
import {readComposerPluginSource} from '@/lib/chat-composer/plugin/attachment';
import {pluginSourceEditable} from '@bottega/contracts/plugins/surface/source';
import { acquireModalKeyboardScope } from "@/lib/modal-keyboard/scope";
import { effectiveLocale } from "@/lib/appearance/i18n-locale";
import { translate } from "../../../../../shared/i18n/runtime";
import {
  createDocument,

  type SketchDocument,
} from "@ai-chat/chat-ui/sketch/model/document";
export type SketchSession = Readonly<{
  id: string;
  owner: ComposerOwner;
  document: SketchDocument;
  entry: PluginComposerEntry;
  source: PluginSource | null;
  ownerDeviceId:string;
  attachmentId?: string;
  returnFocus: HTMLElement | null;
  focusComposer(): boolean;
}>;
let session: SketchSession | null = null;
let releaseKeyboard: (() => void) | undefined;
const listeners = new Set<() => void>();
export const readSketchSession = () => session;
export const subscribeSketchSession = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function openSketch(
  chatId: string,
  attachmentId?: string,
  focusComposer: () => boolean = () => false,
  returnFocus: HTMLElement | null =
    globalThis.document?.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null,
  entry: PluginComposerEntry = {id:"sketch",name:translate(effectiveLocale(),"sketch.title"),enabled:true,error:null,generationId:null,composer:{id:"sketch",title:translate(effectiveLocale(),"sketch.title"),icon:"pencil"},sourceFormat:{id:"bottega.sketch",version:1,readableVersions:[1]}},
  ownerDeviceId = "local",
) {
  if (session) throw new Error("SKETCH_EDITOR_ACTIVE");
  const owner = captureComposerOwner(chatId);
  assertComposerOwner(owner);
  const source = attachmentId ? readComposerPluginSource(owner, attachmentId) : null;
  if (attachmentId && (!source || !pluginSourceEditable(source, {pluginId:entry.id,format:entry.sourceFormat}))) throw new Error("PLUGIN_SOURCE_VERSION_REQUIRED");
  const document = createDocument();
  const id = crypto.randomUUID();
  pinSketchEditor(owner, id, attachmentId);
  releaseKeyboard = acquireModalKeyboardScope();
  session = {
    id,
    owner,
    document,
    entry,
    source,
    ownerDeviceId,
    attachmentId,
    returnFocus,
    focusComposer,
  };
  for (const listener of listeners) listener();
}
export function closeSketch(id: string, saved = false) {
  const previous = session;
  if (!previous || previous.id !== id) return;
  session = null;
  releaseSketchEditor(previous.owner, previous.id);
  releaseKeyboard?.();
  releaseKeyboard = undefined;
  for (const listener of listeners) listener();
  queueMicrotask(() => {
    if (saved && previous.focusComposer()) return;
    if (previous.returnFocus?.isConnected) {
      previous.returnFocus.focus({ preventScroll: true });
      return;
    }
    const root = globalThis.document?.querySelector<HTMLElement>(
      "main, [data-slot=sidebar-inset], #root",
    );
    if (root) {
      if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
      root.focus({ preventScroll: true });
    }
  });
}
