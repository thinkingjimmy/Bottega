/**
 * [INPUT]: Depends on the public host-package manifest and Provider descriptor schemas and PROVIDER_DESCRIPTOR_FILE (@bottega/contracts).
 * [OUTPUT]: Provides standInProviderPackage: a consistent Provider package (manifest, descriptor and the files to write) for a Provider that is no built-in, to install and run against a host; and acpStubBridgeModule, its default bridge entry: the Provider bridge module shape a host evaluates from pinned bytes.
 * [POS]: Test fixture for authors and the host's own end-to-end proof of a fifth Provider; it passes checkProviderPackage unchanged.
 */
import { HOST_PACKAGE_MANIFEST, hostPackageManifestSchema, type HostPackageManifest } from "@bottega/contracts/host/manifest";
import { PROVIDER_DESCRIPTOR_FILE } from "@bottega/contracts/host/provider-package";
import { PROVIDER_CAPABILITIES, PROVIDER_PURPOSES, providerDescriptorSchema, type ProviderDescriptor } from "@bottega/contracts/model/provider";

export type StandInProviderPackage = { manifest: HostPackageManifest; descriptor: ProviderDescriptor; files: Record<string, string> };

/**
 * The bridge entry of an ACP Provider whose CLI is the ACP agent itself: `{ turnValues }` and nothing else. A host evaluates these bytes
 * as a CommonJS body with a `require` that admits nothing, so the source is self-contained data and pure functions: no import, no
 * require, no process, fs or network. Session ids up to 128 of [A-Za-z0-9._:-]; modes map to the agent's own `default` and `plan`,
 * and approve-for-me to `default` because a stand-in has no silent mode.
 */
export function acpStubBridgeModule(): string {
  return [
    '"use strict";',
    "const SESSION = /^[A-Za-z0-9._:-]{1,128}$/;",
    "module.exports = { turnValues: Object.freeze({",
    "  validateSessionId: (id) => typeof id === \"string\" && SESSION.test(id),",
    "  modeValues: Object.freeze({ default: \"default\", plan: \"plan\", approveForMe: \"default\" }),",
    "  resumeWithoutReplay: true,",
    "}) };",
    "",
  ].join("\n");
}

/** `id` names the Provider, its command and its hidden state root (`~/.<id>`); the bridge entry is `bridge`'s source. */
export function standInProviderPackage(id = "stand-in", bridge = acpStubBridgeModule()): StandInProviderPackage {
  const packageId = `example.provider.${id}`;
  const manifest = hostPackageManifestSchema.parse({
    schema: "bottega.host-package/v1", packageId, packageVersion: "1.0.0", family: "host-package", presentation: "plugin",
    displayName: `Stand-in ${id}`, entries: { bridge: "bridge.js" }, uiDelivery: "none",
    provides: [{ contract: `bottega.provider.${id}/v1`, actions: [] }], requires: [],
    permissions: { executionTrust: "explicitly-trusted-code", requestedCapabilities: [] },
    provider: { id, protocol: "acp", remoteLogin: "unsupported" },
  });
  const descriptor = providerDescriptorSchema.parse({
    schema: "bottega.provider-descriptor/v1", providerId: id, packageId, displayName: `Stand-in ${id}`, grammar: { min: 1, max: 1 },
    runtime: { discovery: { commands: [id], versionArgs: ["--version"], minimumVersion: "1.0.0" },
      launch: { kind: "acp-stdio-native", layer: "native", args: ["acp"] }, env: { allow: [], processStart: [] } },
    auth: { check: "none", login: { local: "terminal", remote: "unsupported" }, credentialSafeProbe: true },
    sensitiveRoots: { paths: [`~/.${id}`], envOverrides: [], keychainServices: [], retainAfterUninstall: false },
    configFields: [], capabilities: Object.fromEntries(PROVIDER_CAPABILITIES.map(name => [name, "unsupported"])),
    purposes: Object.fromEntries(PROVIDER_PURPOSES.map(name => [name, "unsupported"])), failureClasses: [],
  });
  return { manifest, descriptor, files: {
    [HOST_PACKAGE_MANIFEST]: `${JSON.stringify(manifest, null, 2)}\n`,
    [PROVIDER_DESCRIPTOR_FILE]: `${JSON.stringify(descriptor, null, 2)}\n`,
    "bridge.js": bridge,
  } };
}
