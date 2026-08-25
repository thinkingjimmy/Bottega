/**
 * [INPUT]: Depends on the browser Document; Receiving untrustworthy Base label/url and controlled turn on the callback
 * [OUTPUT]: Provides only Map popup nodes built with the textContent/DOM API
 * [POS]: The popup XSS boundary of lib/bases; The internal HTML/set HTML is banned, and URLs are ultimately still subject to main HTTPS-only output decisions
 */

export function createBaseMapPopup(
  owner: Document,
  label: string,
  url: string,
  open: (url: string) => void
) {
  const root = owner.createElement("div");
  const title = owner.createElement("strong");
  title.textContent = label || "Location";
  root.append(title);
  if (url) {
    const button = owner.createElement("button");
    button.type = "button";
    button.textContent = "Open link";
    button.className = "map-base-link";
    button.addEventListener("click", () => open(url));
    root.append(owner.createElement("br"), button);
  }
  return root;
}
