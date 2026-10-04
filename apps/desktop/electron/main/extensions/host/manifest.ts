/**
 * [INPUT]: Depends on the public host-package manifest (@bottega/contracts/host/manifest), the contract table and built-in plugin descriptors with the resolver's cycle finder, Node fs/path, manifest-adapter's canonical directory and containment checks, and the Registry source provenance type
 * [OUTPUT]: Re-exports the public manifest ids and hostPackageManifestSchema/HostPackageManifest; provides AdmittedHostEntry, admitHostPackage (private admission; a manifest that declares a Provider is also admitted as a Provider package) and assertPackageContracts (the install-time structural refusals of appendix C.2: `contract-reserved`, `contract-conflict`, `dependency-cycle`; a missing dependency never stops an install)
 * [POS]: The host-package family's only manifest reader (bottega.extension.json, schema bottega.host-package/v1); one manifest per package, never together with an App or Agent-plugin manifest, and no entry may name the signature file
 */
import { lstat, readFile } from "node:fs/promises";
import { AGENT_PROVIDER_CONTRACT, RESERVED_CONTRACTS, contractKindOf, type PluginNode } from "@bottega/contracts/plugins/contracts";
import { BUILTIN_PLUGINS } from "@bottega/contracts/plugins/descriptor";
import type { ExtensionRegistryStore } from "../registry/registry-store";
import { dependencyCycles } from "../../plugins/resolve";
import { join, posix } from "node:path";
import { EXTENSION_SIGNATURE_FILE } from "@bottega/contracts/trust/signing";
import { canonicalDirectory, containedExisting, type ExtensionAdmissionDiagnostic, type ExtensionPackageAdmission } from "../manifest-adapter";
import { PROVIDER_DESCRIPTOR_FILE } from "@bottega/contracts/host/provider-package";
import { admitProviderPackage } from "./provider-package";

/* The manifest an author writes is public (@bottega/contracts/host/manifest); admission below stays private. */
export { HOST_PACKAGE_ADAPTER_ID, HOST_PACKAGE_MANIFEST, HOST_PACKAGE_SCHEMA_ID, hostPackageManifestSchema, type HostPackageManifest } from "@bottega/contracts/host/manifest";
import { HOST_PACKAGE_ADAPTER_ID, HOST_PACKAGE_MANIFEST, hostPackageManifestSchema, type HostPackageManifest } from "@bottega/contracts/host/manifest";
/* Formats of the other families: a package that carries one of them is refused instead of being registered twice. */
const OTHER_FAMILY_MANIFESTS = ["app.json", "plugin.json", ".claude-plugin/plugin.json"] as const;

/** A runnable entry: service and bridge run in a utility host; the UI entry is delivered by a surface (TASK-22). */
export type AdmittedHostEntry = Readonly<{
  kind: "host-entry";
  componentId: `host:${"service" | "bridge" | "ui"}`;
  role: "service" | "bridge" | "ui";
  entry: string;
}>;

export async function admitHostPackage(root: string): Promise<ExtensionPackageAdmission> {
  const packageRoot = await canonicalDirectory(root);
  const diagnostics: ExtensionAdmissionDiagnostic[] = [];
  const fail = (path: string, message: string): ExtensionPackageAdmission => {
    diagnostics.push({ severity: "error", scope: "package", path, message });
    return { adapterId: HOST_PACKAGE_ADAPTER_ID, pluginRoot: packageRoot, manifest: {}, unknownManifestFields: [], components: [], diagnostics, valid: false, containsStdio: false };
  };
  for (const other of OTHER_FAMILY_MANIFESTS) {
    if (await lstat(join(packageRoot, other)).then(() => true, () => false)) return fail(other, `宿主包不能同时携带 ${other}：一个包只属于一个包族`);
  }
  let raw: unknown;
  try { raw = JSON.parse(await readFile(await containedExisting(packageRoot, HOST_PACKAGE_MANIFEST, "file"), "utf8")); }
  catch (cause) { return fail(HOST_PACKAGE_MANIFEST, `无法读取 ${HOST_PACKAGE_MANIFEST}：${(cause as Error).message}`); }
  const parsed = hostPackageManifestSchema.safeParse(raw);
  if (!parsed.success) return fail(HOST_PACKAGE_MANIFEST, parsed.error.issues.map(issue => `${issue.path.join(".") || "manifest"}: ${issue.message}`).join("; ").slice(0, 1_000));
  const manifest = parsed.data;
  /* A Provider package carries its descriptor; a descriptor without a declared Provider (or the reverse) is refused, never half-read. */
  if (manifest.provider) {
    const provider = await admitProviderPackage(packageRoot, manifest);
    if (!provider.ok) return fail(PROVIDER_DESCRIPTOR_FILE, `Provider package refused (${provider.refusal}): ${provider.detail}`);
  } else if (await lstat(join(packageRoot, PROVIDER_DESCRIPTOR_FILE)).then(() => true, () => false)) {
    return fail(PROVIDER_DESCRIPTOR_FILE, "Provider package refused (not-a-provider-package): a descriptor without a provider in the manifest");
  }
  const components: AdmittedHostEntry[] = [];
  for (const role of ["service", "bridge", "ui"] as const) {
    const entry = manifest.entries[role];
    if (!entry) continue;
    /* The signature is stripped at staging and is never runtime-visible; an entry that names it is refused, not left dangling. */
    if (posix.normalize(entry) === EXTENSION_SIGNATURE_FILE) return fail(entry, `入口 ${role} 不能指向签名文件 ${EXTENSION_SIGNATURE_FILE}`);
    try { await containedExisting(packageRoot, entry, "file"); }
    catch (cause) { return fail(entry, `入口 ${role} 不是包内的普通文件：${(cause as Error).message}`); }
    components.push({ kind: "host-entry", componentId: `host:${role}`, role, entry });
  }
  return { adapterId: HOST_PACKAGE_ADAPTER_ID, pluginRoot: packageRoot, manifest: manifest as unknown as ExtensionPackageAdmission["manifest"],
    unknownManifestFields: [], components, diagnostics, valid: true, containsStdio: false };
}

const nodeOf = (id: string, manifest: HostPackageManifest): PluginNode => ({ id, enabled: true, platformSupported: true, requires: manifest.requires,
  provides: [...manifest.provides.map(item => item.contract), ...(manifest.provider ? [AGENT_PROVIDER_CONTRACT] : [])] });

/** Refuses a package that would take a built-in's exclusive contract, share an exclusive contract with an installed package, or close a cycle. */
export async function assertPackageContracts(installIdentity: string, manifest: HostPackageManifest,
  ports: { registry: Pick<ExtensionRegistryStore, "hostPackages">; contentRoot(contentDigest: string): string }) {
  const candidate = nodeOf(installIdentity, manifest);
  const reserved = candidate.provides.filter(contract => (RESERVED_CONTRACTS as readonly string[]).includes(contract));
  if (reserved.length) throw new Error(`contract-reserved: ${reserved.join(", ")}`);
  const others: PluginNode[] = BUILTIN_PLUGINS.map(plugin => ({ id: plugin.id, provides: plugin.provides, requires: plugin.requires, enabled: true, platformSupported: true }));
  for (const owner of ports.registry.hostPackages()) {
    if (owner.installIdentity === installIdentity) continue; // an update replaces its own generation
    const generation = owner.generations.find(item => item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId);
    if (!generation) continue;
    const parsed = await readFile(join(ports.contentRoot(generation.contentDigest), HOST_PACKAGE_MANIFEST), "utf8")
      .then(text => hostPackageManifestSchema.safeParse(JSON.parse(text)), () => null);
    if (parsed?.success) others.push(nodeOf(owner.installIdentity, parsed.data));
  }
  const taken = candidate.provides.filter(contract => contractKindOf(contract) === "exclusive" && others.some(other => other.provides.includes(contract)));
  if (taken.length) throw new Error(`contract-conflict: ${taken.join(", ")}`);
  if (dependencyCycles([...others, candidate], contractKindOf).has(installIdentity)) throw new Error(`dependency-cycle: ${installIdentity}`);
}
