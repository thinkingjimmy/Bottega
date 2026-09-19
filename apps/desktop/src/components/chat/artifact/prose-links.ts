/**
 * [INPUT]: Trusted top-renderer window.open calls and visible Chat handlers.
 * [OUTPUT]: Scoped Claude prose-link routing with original browser behavior restored after disposal.
 * [POS]: Deferred native Markdown integration; isolated child frames have their own untouched globals.
 */
import { isClaudeArtifactUrl } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
export { openArtifactBrowser } from "./browser";
type Handler = (url: string) => boolean;
const handlers = new Set<Handler>();
let restore: (() => void) | undefined;
export function registerArtifactProseLinks(open: (url: string) => void, visible: () => boolean = () => true, signal?: AbortSignal) {
  if (signal?.aborted) return () => {};
  const handler: Handler = url => { if (!visible()) return false; open(url); return true; };
  handlers.add(handler);
  if (!restore) {
    const original = window.open;
    const route = (url: string) => isClaudeArtifactUrl(url) && [...handlers].some(accept => accept(url));
    const intercept: typeof window.open = (url, target, features) => {
      if (url && route(String(url))) return null;
      return original.call(window, url, target, features);
    };
    window.open = intercept;
    restore = () => { if (window.open === intercept) window.open = original; };
  }
  const stop = () => { signal?.removeEventListener("abort", stop); handlers.delete(handler); if (!handlers.size) { restore?.(); restore = undefined; } };
  signal?.addEventListener("abort", stop, { once: true });
  return stop;
}
