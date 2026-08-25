/**
 * [INPUT]: Depends on Codex agent Path/threadName
 * [OUTPUT]: Provides displaySubagentName, which encloses internal paths/identifiers for human-readable headings
 * [POS]: Share the name of the Subagent displayed as pure function, main input and renderer historical projection shared consumption
 */

export function displaySubagentName(value: string) {
  const trimmed = value.trim();
  const leaf = trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
  const readable = leaf.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!readable) return "Subagent";
  return `${readable[0].toUpperCase()}${readable.slice(1)}`;
}
