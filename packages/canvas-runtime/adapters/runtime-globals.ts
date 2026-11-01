/**
 * [INPUT]: Trusted document boot marker and the runtime API created for one authored document.
 * [OUTPUT]: Marker consumption and duplicate-runtime protection for private __dc globals.
 * [POS]: Maintained DC bootstrap; preserves the 2.3 replacement contract without touching bundles.
 */
const REPLACED = "[dc] A second runtime tried to replace this document's editing functions. Remove its duplicate support script or import.";
export function consumeRuntimeMarker(target: object): boolean {
  const globals = target as Record<string, unknown>;
  const marked = globals.__dcHostRuntime === true;
  Reflect.deleteProperty(globals, "__dcHostRuntime");
  return marked;
}
export function installRuntimeGlobals(target: object, values: Record<string, unknown>, protect: boolean, canReplace: () => boolean) {
  for (const [name, value] of Object.entries(values)) {
    if (protect && name.startsWith("__dc")) {
      let current = value;
      const get = () => current;
      try {
        Object.defineProperty(target, name, { configurable: false, enumerable: true, get, set(next: unknown) {
          if (!canReplace()) throw new TypeError(REPLACED);
          current = next;
        } });
      } catch { /* An existing protected runtime must retain its own API. */ }
      if (Object.getOwnPropertyDescriptor(target, name)?.get === get) continue;
    }
    Object.assign(target, { [name]: value });
  }
}
