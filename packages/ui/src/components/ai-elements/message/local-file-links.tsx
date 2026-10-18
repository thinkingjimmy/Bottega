/**
 * [INPUT]: React context, host-owned file opening and Markdown anchor nodes before sanitization.
 * [OUTPUT]: Opt-in local text-file links encoded as inert fragments and handled inside their host surface.
 * [POS]: Message rendering adapter; filesystem paths never become browser navigation authority.
 */
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";

const PREFIX = "#bottega-local-file=";
const Context = createContext(false);
export const useMessageFileLinks = () => useContext(Context);

function localTextFile(href: string) {
  try {
    let path = href;
    if (/^file:/i.test(path)) {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost" || url.search) return false;
      path = url.pathname;
    } else if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(path)) return false;
    path = decodeURIComponent(path).split("#")[0]!.replace(/:\d+(?::\d+)?$/, "");
    const invalid = [...path].some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127 || char === "\\");
    return !invalid && /\.(?:txt|md|markdown|json)$/i.test(path);
  } catch { return false; }
}

type Node = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };
export const preserveMessageFileLinks = () => (tree: Node) => {
  const walk = (node: Node) => {
    if (node.type === "element" && node.tagName === "a") {
      const href = node.properties?.href;
      if (typeof href === "string" && localTextFile(href)) {
        node.properties = { ...node.properties, href: PREFIX + encodeURIComponent(href), title: href };
      }
    }
    node.children?.forEach(walk);
  };
  walk(tree);
};

export function MessageFileLinkProvider({ onOpen, children }: { onOpen?: (href: string) => void; children: ReactNode }) {
  const open = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    const href = anchor?.getAttribute("href");
    if (!onOpen || !href?.startsWith(PREFIX)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const path = decodeURIComponent(href.slice(PREFIX.length));
      if (localTextFile(path)) onOpen(path);
    } catch { /* Malformed fragments cannot become native file requests. */ }
  };
  return <Context.Provider value={Boolean(onOpen)}><div className="contents" onClickCapture={open} onAuxClickCapture={open}>{children}</div></Context.Provider>;
}
