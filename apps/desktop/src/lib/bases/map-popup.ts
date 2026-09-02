/**
 * [INPUT]: Depends on a browser Document plus untrusted Base label/URL, localized fallback/action labels, and a controlled open callback
 * [OUTPUT]: Provides a Base Map popup node built only through textContent and DOM APIs
 * [POS]: Popup XSS and imperative-copy boundary for lib/bases; callers own locale selection and main remains the HTTPS-only navigation authority
 */

export function createBaseMapPopup(
  owner: Document,
  input: {
    label: string;
    url: string;
    fallbackLabel: string;
    openLinkLabel: string;
    onOpen(url: string): void;
  }
) {
  const root = owner.createElement("div");
  const title = owner.createElement("strong");
  title.textContent = input.label || input.fallbackLabel;
  root.append(title);
  if (input.url) {
    const button = owner.createElement("button");
    button.type = "button";
    button.textContent = input.openLinkLabel;
    button.className = "map-base-link";
    button.addEventListener("click", () => input.onOpen(input.url));
    root.append(owner.createElement("br"), button);
  }
  return root;
}
