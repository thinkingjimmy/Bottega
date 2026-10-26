/**
 * [INPUT]: Visible artifact requests and mutable expanded-preview priority.
 * [OUTPUT]: A three-frame quota with FIFO admission, priority updates without remounting and idempotent release.
 * [POS]: Shared artifact resource governor; suspended cards retain their last reported height.
 */
type Request = { activate(): void; deactivate(): void; priority: number };
const active = new Map<symbol, Request>(), waiting = new Map<symbol, Request>();
function drain() {
  for (const [id, request] of [...waiting].sort((a, b) => b[1].priority - a[1].priority)) {
    if (!waiting.has(id)) continue;
    if (active.size >= 3) {
      const victim = [...active].sort((a, b) => a[1].priority - b[1].priority).find(([, value]) => value.priority < request.priority);
      if (!victim) break;
      active.delete(victim[0]); waiting.set(...victim); victim[1].deactivate();
    }
    waiting.delete(id); active.set(id, request); request.activate();
  }
}
export function requestArtifactFrame(activate: () => void, deactivate = () => {}, priority: number | boolean = 1) {
  const key = Symbol(), request = { activate, deactivate, priority: typeof priority === "boolean" ? priority ? 2 : 1 : priority };
  let released = false;
  waiting.set(key, request); drain();
  const release = () => {
    if (released) return; released = true;
    waiting.delete(key); active.delete(key); deactivate(); drain();
  };
  return Object.assign(release, { setPriority(value: number) { if (!released && value !== request.priority) { request.priority = value; drain(); } } });
}
export const artifactFrameCount = () => active.size;
