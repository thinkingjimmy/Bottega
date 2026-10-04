/**
 * [INPUT]: Opaque plugin source envelopes and host draft checkpoint blob custody.
 * [OUTPUT]: Metadata-only draft checkpoints and digest-checked source hydration from bounded blob parts.
 * [POS]: Keeps a 16 MiB source outside the encrypted draft JSON record's 12 MiB ceiling.
 */
import { pluginSourceSchema, type PluginSource } from '@bottega/contracts/plugins/surface/source';
import type { CheckpointFile, DraftCheckpoint } from '../platform/remote/input/checkpoint-model';
import { verifyPluginSource } from './codec';
const PART_CHARACTERS = 4 * 1024 * 1024;
export function checkpointPluginSource(id: string, source: PluginSource, blobs: Map<string, Blob>): NonNullable<CheckpointFile['pluginSource']> {
  const { bytes, encoding: _encoding, ...metadata } = source, parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += PART_CHARACTERS) {
    const name = `${id}.plugin-source.${parts.length}`; parts.push(name);
    blobs.set(name, new Blob([bytes.slice(offset, offset + PART_CHARACTERS)], { type: 'text/plain' }));
  }
  return { ...metadata, encoding: 'chunks', parts };
}
export const hasStoredPluginSources = (checkpoint: DraftCheckpoint) => [...checkpoint.files, ...checkpoint.submitted.flatMap(value => value.files)]
  .some(file => file.pluginSource?.encoding === 'chunks');
export async function restorePluginSources(checkpoint: DraftCheckpoint, blobs: ReadonlyMap<string, Blob>): Promise<DraftCheckpoint> {
  const restore = async (file: CheckpointFile): Promise<CheckpointFile> => {
    const source = file.pluginSource;
    if (!source || source.encoding !== 'chunks') return file;
    try {
      let bytes = '';
      for (const [index, name] of source.parts.entries()) {
        if (name !== `${file.id}.plugin-source.${index}`) throw new Error('PLUGIN_SOURCE_IDENTITY');
        const part = blobs.get(name);
        if (!part || part.size > PART_CHARACTERS) throw new Error('PLUGIN_SOURCE_MISSING');
        bytes += await part.text();
      }
      const { parts: _parts, ...metadata } = source;
      const restored = pluginSourceSchema.parse({ ...metadata, encoding: 'base64', bytes });
      await verifyPluginSource(restored);
      return { ...file, pluginSource: restored };
    } catch {
      // A missing source must not discard a valid image or the rest of the draft.
      const { pluginSource: _source, ...image } = file; return image;
    }
  };
  const files: CheckpointFile[] = [];
  for (const file of checkpoint.files) files.push(await restore(file));
  const submitted: DraftCheckpoint['submitted'] = [];
  for (const item of checkpoint.submitted) {
    const restored: CheckpointFile[] = [];
    for (const file of item.files) restored.push(await restore(file));
    submitted.push({ ...item, files: restored });
  }
  return { ...checkpoint, files, submitted };
}
