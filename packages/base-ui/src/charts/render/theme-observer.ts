/**
 * [INPUT]: Depends on the document theme attributes and MutationObserver.
 * [OUTPUT]: Provides an external store for host theme changes that affect computed chart colors.
 * [POS]: Shared chart appearance boundary; contains no application settings or persistence.
 */
const getSnapshot = () => typeof document === "undefined" ? "" :
  document.documentElement.getAttributeNames().map(name => `${name}=${document.documentElement.getAttribute(name)}`).join(";");
export const resolvedThemeStore = {
  getSnapshot,
  subscribe(listener: () => void) {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => undefined;
    const observer = new MutationObserver(listener);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  },
};
