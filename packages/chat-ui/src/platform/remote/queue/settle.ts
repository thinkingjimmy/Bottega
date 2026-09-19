/**
 * [INPUT]: A complete mixed queue snapshot, executor identity and live queue metadata.
 * [OUTPUT]: One coordinator revision after every original row enters the same dispatch authority.
 * [POS]: Queue transfer barrier; no partial server reorder is committed before the atomic coordinator edit.
 */
import type { AcceptedQueue, AwaitingQueue } from "@ai-chat/cloud-protocol/remote/queue";
import type { RemoteCommandPort } from "../contracts";
export function admittedQueue(snapshot: AwaitingQueue, original: AwaitingQueue, authority: { deviceId: string; executionEpoch: number }): AcceptedQueue | null {
  const initial = original.accepted;
  if (!initial || initial.deviceId !== authority.deviceId || initial.executionEpoch !== authority.executionEpoch ||
    original.items.some(item => item.targetDeviceId !== authority.deviceId)) throw new Error("executor-changed");
  const accepted = snapshot.accepted;
  if (!accepted) return null;
  if (accepted.deviceId !== authority.deviceId || accepted.executionEpoch !== authority.executionEpoch) throw new Error("executor-changed");
  const before = initial.items.map(item => item.intentId), ids = new Set([...before, ...original.items.map(item => item.intentId)]);
  const retained = accepted.items.filter(item => before.includes(item.intentId)).map(item => item.intentId);
  if (retained.length !== before.length) throw new Error("already-dispatched");
  if (retained.some((id, index) => id !== before[index]) || accepted.items.some(item => !ids.has(item.intentId)) ||
    snapshot.items.some(item => !ids.has(item.intentId))) throw new Error("queue-changed");
  const waiting = original.items.map(item => item.intentId).filter(id => !before.includes(id));
  const pendingOrder = [...accepted.items, ...snapshot.items].filter(item => waiting.includes(item.intentId)).map(item => item.intentId);
  if (pendingOrder.some((id, index) => id !== waiting.filter(value => pendingOrder.includes(value))[index])) throw new Error("queue-changed");
  return accepted.items.length === ids.size ? accepted : null;
}
export function awaitQueueAdmission(port: RemoteCommandPort, chatId: string, original: AwaitingQueue,
  authority: { deviceId: string; executionEpoch: number }, signal?: AbortSignal, timeoutMs = 60_000): Promise<AcceptedQueue> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined, settled = false;
    const lifetime = AbortSignal.any([...(signal ? [signal] : []), ...(port.lifetime ? [port.lifetime] : [])]);
    const finish = (value?: AcceptedQueue, error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); stop?.(); lifetime.removeEventListener("abort", abort);
      if (value) resolve(value); else reject(error);
    };
    const abort = () => finish(undefined, new Error("identity-changed"));
    const timer = setTimeout(() => finish(undefined, new Error("queue-changed")), timeoutMs);
    lifetime.addEventListener("abort", abort, { once: true });
    if (lifetime.aborted) { abort(); return; }
    if (!port.queue) { finish(undefined, new Error("input-unsupported")); return; }
    const changed = (value: AwaitingQueue) => {
      try { const result = admittedQueue(value, original, authority); if (result) finish(result); }
      catch (error) { finish(undefined, error); }
    };
    changed(original);
    if (!settled) stop = port.queue.watch(chatId, changed, error => finish(undefined, error));
    if (settled) stop?.();
  });
}
