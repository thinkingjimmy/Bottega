/**
 * [INPUT]: Depends on the built-in Provider descriptors (builtin.ts), and on the public host-package manifest and Provider descriptor file names (@bottega/contracts).
 * [OUTPUT]: Provides BUNDLED_BRIDGE_ENTRY, bundledProviderDirectory, bundledProviderManifest and bundledProviderPackageFiles: each built-in Provider as a Provider package (manifest and descriptor text; the build adds the bridge module).
 * [POS]: The one definition of what a built-in Provider package contains (TASK-11 d3). The build evaluates it to write `providers/<id>/` beside the main bundle; main's bundled admission (extensions/host/bundled-providers.ts) reads the same names back.
 */
import { HOST_PACKAGE_MANIFEST, type HostPackageManifest } from "@bottega/contracts/host/manifest";
import { PROVIDER_DESCRIPTOR_FILE } from "@bottega/contracts/host/provider-package";
import type { ProviderDescriptor } from "@ai-chat/cloud-protocol/contracts/provider";
import { BUILTIN_PROVIDER_DESCRIPTORS } from "./builtin";

/** The bridge module's file inside a bundled package: the pinned, self-contained build of `providers/bridge/modules/<id>.ts`. */
export const BUNDLED_BRIDGE_ENTRY = "bridge.js";
/** Where a built-in package sits, relative to the main bundle's directory (inside the signed app.asar when packaged). */
export const bundledProviderDirectory = (providerId: string) => `providers/${providerId}`;

/** A built-in Provider's manifest, generated from its descriptor so the two can never disagree. */
export function bundledProviderManifest(descriptor: ProviderDescriptor, packageVersion: string): HostPackageManifest {
  return {
    schema: "bottega.host-package/v1", packageId: descriptor.packageId, packageVersion, family: "host-package", presentation: "plugin",
    displayName: descriptor.displayName, entries: { bridge: BUNDLED_BRIDGE_ENTRY }, uiDelivery: "none",
    provides: [{ contract: `bottega.provider.${descriptor.providerId}/v1`, actions: [] }], requires: [],
    permissions: { executionTrust: "explicitly-trusted-code", requestedCapabilities: [] },
    provider: { id: descriptor.providerId, protocol: "acp", remoteLogin: descriptor.auth.login.remote },
  };
}

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Every built-in's manifest and descriptor, as the text the build writes; the bridge module is added by the build. */
export function bundledProviderPackageFiles(packageVersion: string): Record<string, Record<string, string>> {
  return Object.fromEntries(BUILTIN_PROVIDER_DESCRIPTORS.map(descriptor => [descriptor.providerId, {
    [HOST_PACKAGE_MANIFEST]: text(bundledProviderManifest(descriptor, packageVersion)),
    [PROVIDER_DESCRIPTOR_FILE]: text(descriptor),
  }]));
}
