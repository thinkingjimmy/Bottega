/**
 * [INPUT]: Private ACP tool inputs and location hints.
 * [OUTPUT]: Bounded artifact discovery metadata kept outside shared tool DTOs.
 * [POS]: ACP-to-artifact discovery adapter; absolute locations never enter the transcript.
 */

type Metadata = { locations?: string[]; title?: string };
const metadata = new WeakMap<object, Map<string, Metadata>>();
export function artifactMetadata(state: object, update: { toolCallId: string; locations?: { path: string }[] | null; rawInput?: unknown }) {
  const title = (update.rawInput as { title?: unknown } | null)?.title;
  let tools = metadata.get(state);
  if (!tools) { tools = new Map(); metadata.set(state, tools); }
  const value = { ...tools.get(update.toolCallId), ...(update.locations ? { locations: update.locations.slice(0, 200).map(value => value.path) } : {}),
    ...(typeof title === "string" ? { title: title.slice(0, 250) } : {}) };
  tools.set(update.toolCallId, value); return value;
}
