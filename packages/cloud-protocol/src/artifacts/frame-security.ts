/**
 * [INPUT]: Host-observed frame identity, user activation and bounded postMessage payloads.
 * [OUTPUT]: Exact frame checks, rate-limited follow-up admission and multiline draft deduplication.
 * [POS]: Trusted artifact host boundary; untrusted frame assertions never grant activation.
 */
export function artifactMessageSource(event: { source: unknown; origin: string }, frame: unknown, origin: string) {
  return frame != null && event.source === frame && event.origin === origin;
}
export function artifactFollowUpBlock(draft: string, value: { prompt: string; title?: string }): string | null {
  const text = draft.replace(/\r\n?/g, "\n"), prompt = value.prompt.replace(/\r\n?/g, "\n").trim();
  if (!prompt || `\n${text}\n`.includes(`\n${prompt}\n`)) return null;
  return [value.title?.trim(), prompt].filter(Boolean).join("\n");
}
export class ArtifactFollowUpGuard {
  private accepted: number[] = [];
  accept(payload: unknown, activated: boolean, now = Date.now()): { prompt: string; title?: string } | null {
    if (!activated || !payload || typeof payload !== "object") return null;
    const value = payload as Record<string, unknown>;
    if (Object.keys(value).some(key => !["prompt", "title"].includes(key)) || typeof value.prompt !== "string" || !value.prompt.trim() ||
      new TextEncoder().encode(value.prompt).length > 4096 || (value.title !== undefined && (typeof value.title !== "string" || value.title.length > 250))) return null;
    this.accepted = this.accepted.filter(time => time > now - 60_000);
    if (this.accepted.length >= 5) return null;
    this.accepted.push(now);
    return { prompt: value.prompt.trim(), ...(typeof value.title === "string" && value.title.trim() ? { title: value.title.trim() } : {}) };
  }
}
