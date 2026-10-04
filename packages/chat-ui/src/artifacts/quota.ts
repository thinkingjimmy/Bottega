/**
 * [INPUT]: Visible artifact requests and explicit expanded-preview priority.
 * [OUTPUT]: A three-frame quota with FIFO admission, preview preemption and idempotent release.
 * [POS]: Shared artifact resource governor; suspended cards retain their last reported height.
 */
type Request = { activate(): void; deactivate(): void; priority: number };
const active = new Map<symbol, Request>(), waiting = new Map<symbol, Request>();
function drain() {
  for (const [id, request] of [...waiting].sort((a, b) => b[1].priority - a[1].priority)) { if (active.size >= 3) break; waiting.delete(id); active.set(id, request); request.activate(); }
}
export function requestArtifactFrame(activate: () => void, deactivate = () => {}, priority: number | boolean = 1) {
  const rank = typeof priority === "boolean" ? priority ? 2 : 1 : priority;
  const key = Symbol(), request = { activate, deactivate, priority: rank };
  if (rank > 0 && active.size >= 3) {
    const victim = [...active].sort((a, b) => a[1].priority - b[1].priority).find(([, value]) => value.priority < rank);
    if (victim) { active.delete(victim[0]); waiting.set(...victim); victim[1].deactivate(); }
  }
  if (rank > 0 && active.size < 3) { active.set(key, request); activate(); }
  else { waiting.set(key, request); drain(); }
  return () => { waiting.delete(key); active.delete(key); deactivate(); drain(); };
}
export const artifactFrameCount = () => active.size;
