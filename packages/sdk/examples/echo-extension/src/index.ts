/**
 * [INPUT]: The public SDK extension entry contract and settings.get host port.
 * [OUTPUT]: activate with echo handlers and per-call settings.
 * [POS]: Minimal extension example exercising the public host contract.
 */
/**
 * The package entry the host loads (bottega.extension.json → entries.bridge → dist/index.js). The host calls `activate` once
 * with its HostApi and then invokes the returned handlers by name.
 */
import { defineExtension } from "@bottega/sdk";

type Settings = { prefix: string; uppercase: boolean };
const DEFAULTS: Settings = { prefix: "", uppercase: false };

export const activate = defineExtension(async (api) => {
  /** This package's own settings (declared in bottega.extension.json), read fresh each call so a change applies at once. A host
   *  without the settings port answers nothing, and the defaults behave exactly like an echo with no settings. */
  const settings = async (): Promise<Settings> => ({ ...DEFAULTS, ...(await api.call("settings.get", {}, []).catch(() => ({})) as Partial<Settings>) });
  return {
    /** Answers with exactly what it was given; a `text` also comes back shaped by the settings. */
    echo: async (params) => {
      const text = (params as { text?: unknown } | null)?.text;
      if (typeof text !== "string") return { echoed: params, host: api.hostId };
      const { prefix, uppercase } = await settings();
      return { echoed: params, host: api.hostId, text: `${prefix}${uppercase ? text.toUpperCase() : text}` };
    },
    /**
     * Asks the host to run one operation on this call's behalf. The first ref names the principal the host issued for the
     * call; a package never makes one up.
     */
    ask: async (params, refs) => {
      const { operation, input } = params as { operation: string; input: unknown };
      return { answer: await api.call(operation, input, refs) };
    },
  };
});
