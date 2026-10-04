/**
 * [INPUT]: Depends on the public host contract, protocol and API types (@bottega/contracts/host/*).
 * [OUTPUT]: Provides defineExtension (a typed activate()) and re-exports HostApi, HostProcess, HostHandler, HostPackageManifest, hostPackageManifestSchema, HOST_LAUNCH_CONTRACT and HOST_GRAMMAR.
 * [POS]: The author-facing entry of @bottega/sdk; a package's entry module default-exports nothing and exports `activate`, which the host calls once with its HostApi.
 */
import type { HostApi, HostHandler } from "@bottega/contracts/host/api";

export type { HostApi, HostHandler, HostProcess } from "@bottega/contracts/host/api";
export { HOST_GRAMMAR, HOST_LAUNCH_CONTRACT } from "@bottega/contracts/host/contract";
export { hostPackageManifestSchema, HOST_PACKAGE_MANIFEST, type HostPackageManifest } from "@bottega/contracts/host/manifest";

/** Method name → handler over (params, refs). The host invokes them by name; refs are the capability refs of the call. */
export type ExtensionHandlers = Record<string, HostHandler>;

/**
 * Types a package's `activate`: `export const activate = defineExtension(async (api) => ({ ... }))`. It returns the function
 * unchanged; the host imports the entry module, calls `activate(api)` once and keeps the handlers it returns.
 */
export function defineExtension<T extends ExtensionHandlers>(activate: (api: HostApi) => T | Promise<T>): (api: HostApi) => T | Promise<T> {
  return activate;
}
