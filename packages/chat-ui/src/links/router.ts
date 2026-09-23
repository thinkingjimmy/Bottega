/**
 * [INPUT]: Rendered anchors in the trusted page and scoped owners holding a LinkPort.
 * [OUTPUT]: registerProseLinks, routing plain cross-origin http(s) link clicks inside an owner's subtree to its port while modifier clicks, other schemes, downloads and same-origin in-app navigation stay native.
 * [POS]: Shared click interception behind the link port; one capture listener serves every owner and leaves the document untouched once the registry empties.
 */
import { linkPurposeOf, type LinkPort } from "./port";
type Owner = { within: (node: Node) => boolean; port: LinkPort };
const owners = new Set<Owner>();
let restore: (() => void) | undefined;
/* Non-primary and modifier clicks stay native: they are the escape hatch to the system browser. */
function route(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  /* A download is never a navigation, whatever its scheme. */
  if (anchor.hasAttribute("download")) return;
  let url: URL;
  try { url = new URL(anchor.href); } catch { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  /* The page also holds in-app navigation — router links and in-document anchors — and in dev those resolve against the
     page's own http origin. Only a cross-origin destination is a link leaving the app; the app owns its own origin. */
  if (url.origin === window.location.origin) return;
  for (const owner of owners) {
    if (!owner.within(anchor)) continue;
    event.preventDefault();
    /* Called inside the click: a browser only lets a user gesture open a new tab synchronously. */
    try { void Promise.resolve(owner.port.open(url.href, linkPurposeOf(url.href))).catch(console.warn); } catch (error) { console.warn(error); }
    return;
  }
}
export function registerProseLinks(within: (node: Node) => boolean, port: LinkPort, signal?: AbortSignal) {
  if (signal?.aborted) return () => {};
  const owner: Owner = { within, port };
  owners.add(owner);
  if (!restore) {
    const listener = (event: Event) => route(event as MouseEvent);
    document.addEventListener("click", listener, true);
    restore = () => document.removeEventListener("click", listener, true);
  }
  const stop = () => { signal?.removeEventListener("abort", stop); owners.delete(owner); if (!owners.size) { restore?.(); restore = undefined; } };
  signal?.addEventListener("abort", stop, { once: true });
  return stop;
}
