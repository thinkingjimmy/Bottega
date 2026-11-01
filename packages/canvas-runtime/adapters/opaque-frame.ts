/**
 * [INPUT]: Host-owned iframe identities and early private preview MessagePorts established before authored code.
 * [OUTPUT]: Source-bound frame connectivity and bounded find-key facts; no parent DOM access or fabricated trusted events.
 * [POS]: Maintained Canvas fork adapter shared by the editor and injected preview bootstrap.
 */
export type OpaqueFindKey = Readonly<{
  key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean;
  isComposing: boolean; editing: boolean;
}>;
const frames = new WeakMap<Window, HTMLIFrameElement>();
const fields = ["key", "metaKey", "ctrlKey", "altKey", "shiftKey", "isComposing", "editing"] as const;
export function rememberFrameWindow(frame: HTMLIFrameElement): Window | null {
  const target = frame.contentWindow;
  if (target) frames.set(target, frame);
  return target;
}
export function knownFrameConnected(target: Window): boolean | undefined {
  return frames.get(target)?.isConnected;
}
export function subscribeOpaqueFindKeys(port: MessagePort, accept: (key: OpaqueFindKey) => void): () => void {
  let lastAt = 0;
  const listener = (event: MessageEvent) => {
    const key = event.data?.__bottega_find_key;
    if (!key || typeof key !== "object" || Array.isArray(key) || Object.keys(key).length !== fields.length ||
      !["f", "g", "F3"].includes(key.key) || fields.slice(1).some(field => typeof key[field] !== "boolean")) return;
    const now = performance.now();
    if (now - lastAt < 20) return;
    lastAt = now;
    accept(key);
  };
  port.addEventListener("message", listener); port.start();
  return () => port.removeEventListener("message", listener);
}
export function installOpaqueFindKeys(send: (value: unknown) => void): void {
  const add = EventTarget.prototype.addEventListener;
  const apply = Reflect.apply;
  const handler = (event: KeyboardEvent) => {
    if (!event.isTrusted || event.repeat || event.altKey) return;
    const key = event.key === "F3" ? "F3" : event.key.toLowerCase();
    const modifier = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
    if (key !== "F3" && (!modifier || !["f", "g"].includes(key)) || key === "f" && event.shiftKey) return;
    const target = event.target;
    const editing = target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"],[data-dc-editor-editing]'));
    if (key !== "f" && editing) return;
    event.preventDefault();
    if (event.isComposing) return;
    send({ __bottega_find_key: { key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey,
      shiftKey: event.shiftKey, isComposing: event.isComposing, editing } });
  };
  apply(add, window, ["keydown", handler, true]);
}
