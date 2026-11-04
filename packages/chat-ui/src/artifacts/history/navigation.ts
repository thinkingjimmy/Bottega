/**
 * [INPUT]: Current host scope, document identity and an explicit fixed-version navigation request.
 * [OUTPUT]: One mounted History navigation receiver with a bounded, short-lived pending UI intent.
 * [POS]: Navigation only; document versions, source authority and restoration remain with the existing host.
 */
type Request = { revision: number; nonce: string };
const receivers = new Map<string, (request: Request) => void>(), pending = new Map<string, { request: Request; expiresAt: number }>();
const key = (scope: string, documentId: string) => JSON.stringify([scope, documentId]);
export function requestNativeHistory(scope: string, documentId: string, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) return;
  const id = key(scope, documentId), request = { revision, nonce: crypto.randomUUID() }, receive = receivers.get(id);
  if (receive) { receive(request); return; }
  for (const [key, value] of pending) if (value.expiresAt <= Date.now()) pending.delete(key);
  if (pending.size >= 32) pending.delete(pending.keys().next().value!);
  pending.set(id, { request, expiresAt: Date.now() + 30000 });
}
export function registerHistoryNavigation(scope: string, documentId: string, receive: (request: Request) => void) {
  const id = key(scope, documentId); receivers.set(id, receive);
  const value = pending.get(id); pending.delete(id);
  if (value && value.expiresAt > Date.now()) receive(value.request);
  return () => { if (receivers.get(id) === receive) receivers.delete(id); };
}
