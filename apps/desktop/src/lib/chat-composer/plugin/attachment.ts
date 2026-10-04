/**
 * [INPUT]: Captured composer ownership, attachment admission and opaque plugin source contracts.
 * [OUTPUT]: saveComposerPluginAttachment and readComposerPluginSource host-only adapters.
 * [POS]: Native atomic plugin publication; sources survive draft/queue swaps without format decoding.
 */
import { pluginSourceSchema, type PluginSource } from '@bottega/contracts/plugins/surface/source';
import { PLUGIN_IMAGE_BYTES } from '@bottega/contracts/plugins/surface/source';
import { ATTACHMENT_LIMIT } from "../../../../shared/ipc/agent/agent-ipc";
import { assertComposerOwner, atomicComposerUpdate, readComposer, subscribeComposer, type ComposerFile, type ComposerOwner } from "../../chat/state/composer/chat-composer-store";
export function saveComposerPluginAttachment(owner: ComposerOwner, image: File, value: PluginSource, replaceAttachmentId?: string): string {
  assertComposerOwner(owner);
  const source = pluginSourceSchema.parse(value);
  if (image.type !== 'image/png' || !image.size || image.size > PLUGIN_IMAGE_BYTES) throw new Error('PLUGIN_IMAGE_INVALID');
  const id = crypto.randomUUID(), url = URL.createObjectURL(image);
  let previous: ComposerFile | undefined;
  try {
    atomicComposerUpdate(owner, state => {
      const index = replaceAttachmentId ? state.draft.files.findIndex(file => file.id === replaceAttachmentId) : -1;
      if (replaceAttachmentId && (index < 0 || state.sketch.pluginSources?.get(replaceAttachmentId)?.pluginId !== source.pluginId)) throw new Error('PLUGIN_ATTACHMENT_CHANGED');
      if (state.draft.files.length + state.draft.richValue.filter(node => node.type === 'file').length + 1 - (replaceAttachmentId ? 1 : 0) > ATTACHMENT_LIMIT) throw new Error('SKETCH_ATTACHMENT_LIMIT');
      const file: ComposerFile = { id, type: 'file', filename: image.name, mediaType: image.type, nativeFile: image, url, pluginSource: source };
      const files = [...state.draft.files];
      if (index >= 0) { previous = files[index]; files[index] = file; } else files.push(file);
      return { ...state, draft: { ...state.draft, files }, sketch: { ...state.sketch,
        pluginSources: new Map(state.sketch.pluginSources).set(id, source),
        sketchAttachmentIds: new Set([...state.sketch.sketchAttachmentIds, id]) } };
    });
  } catch (error) { URL.revokeObjectURL(url); throw error; }
  if (previous?.url?.startsWith('blob:')) {
    const retired = previous;
    const referenced = () => readComposer(owner.chatId).sketch.sketchAttachmentIds.has(retired.id);
    if (!referenced()) URL.revokeObjectURL(retired.url);
    else {
      // A queue or an in-flight editor/send still owns this exact version.
      const stop = subscribeComposer(owner.chatId, () => {
        if (!referenced()) { stop(); URL.revokeObjectURL(retired.url); }
      });
    }
  }
  return id;
}
export const readComposerPluginSource = (owner: ComposerOwner, attachmentId: string) => {
  assertComposerOwner(owner);
  return readComposer(owner.chatId).sketch.pluginSources?.get(attachmentId) ?? null;
};
