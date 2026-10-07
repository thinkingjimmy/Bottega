/**
 * [INPUT]: Depends on Node crypto/fs/path, the Extension Registry's installed generation and administrative state, the host manifest,
 *          trust gate, shared plugin resolver, SerialQueue, package settings ports and the utility runtime's drain/disposal operations.
 * [OUTPUT]: Re-exports HOST_OFFERED_CONTRACTS; provides PackageAdmission, HostPackageRuntime, hostIdOf, HostPackageContractError and
 *           HostPackageRevokedError. Runtime exposes installed manifest metadata, active resolve/negotiate/ensure with admission before metadata reads, trust verdicts and
 *           revocation events, settings attachment and deferred replacement, callerOf/outstanding, stopPackage/stopAdmission/close.
 * [POS]: The bridge from Registry admission to service/bridge processes. A per-package queue serializes starts and settings replacement;
 *        process-start settings are frozen per host and pending revisions are acknowledged only after all required roles reach hello.
 *        Trust checks run before joining that queue so revocation can close a held start; explicit disposal aborts waiting work outside that queue so revocation and shutdown cannot wait on their own queued operation.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimePort } from "../../runtime";
import { providerHostId } from "../../providers/host/protocol";
import type { ProviderDescriptor } from "@bottega/contracts/model/provider";
import type { AgentProcessLaunch } from "../../backends/types";
import { fencePackageLaunch } from "../../host/package/launch";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { assertProviderAdmitted } from "../../providers/host/admission";
import type { ExtensionRegistryStore } from "../registry/registry-store";
import type { HostRuntime } from "../../host/composition";
import type { UtilityHost } from "../../host/utility-host";
import { hostChildEnvironment } from "../../host/processes/process-port";
import { HOST_PACKAGE_MANIFEST, hostPackageManifestSchema, type HostPackageManifest } from "./manifest";
import type { PackageSignature } from "@bottega/contracts/trust/signing";
import type { ExtensionTrustGate } from "../trust/gate";
import type { PackagePorts } from "./ports";
import type { JsonValue } from "@ai-chat/cloud-protocol/contracts/canonical";
import type { RefusalReason, TrustVerdict } from "../trust/verifier";
import { AGENT_PROVIDER_CONTRACT, contractKindOf, type PluginNode } from "@bottega/contracts/plugins/contracts";
import { resolvePlugins } from "../../plugins/resolve";
import { SerialQueue } from "../../persistence/serial-queue";

/* Contracts the host itself offers to every package (CTR-07) now live in the public table (@bottega/contracts/plugins/contracts). */
export { HOST_OFFERED_CONTRACTS } from "@bottega/contracts/plugins/contracts";
/** The plugin catalog's answer for one package: what it waits for (runtime admission) and exclusive contracts it shares with another owner. */
export type PackageAdmission = (installIdentity: string) => Promise<{ missing: string[]; conflicts: string[] }>;

export class HostPackageContractError extends Error {
  readonly name = "HostPackageContractError";
  constructor(readonly code: "contract-missing" | "contract-conflict" | "package-inactive" | "entry-missing",
    readonly detail: readonly string[]) { super(`${code}: ${detail.join(", ")}`); }
}

/** A package whose signature the latest snapshot refuses (revoked key or artifact): coded, so a caller never sees a raw host error. */
export class HostPackageRevokedError extends Error {
  readonly name = "HostPackageRevokedError";
  readonly code = "extension-revoked";
  constructor(readonly installIdentity: string, readonly reason: RefusalReason) { super(`extension-revoked: ${installIdentity} (${reason})`); }
}

type Resolved = Readonly<{ installIdentity: string; manifest: HostPackageManifest; packageRoot: string; generationId: string;
  contentDigest: string; signature: PackageSignature | null }>;
type Hosts = Pick<HostRuntime, "create" | "get" | "remove" | "descendants" | "drain" | "isIdle">;
type Role = "service" | "bridge";
const ROLES: readonly Role[] = ["service", "bridge"];
type Restart = { applied(): void; roles: Set<Role> };
type Lifecycle = { queue: SerialQueue; controller: AbortController };

export class HostPackageRuntime {
  /** Packages being disposed: no new host may start for them (step 1 of the disposal order). */
  private readonly closing = new Set<string>();
  private readonly providerIds = new Map<string, string>();
  private hostId(installIdentity: string, role: Role) {
    const providerId = this.providerIds.get(installIdentity);
    return role === "bridge" && providerId ? providerHostId(providerId) : hostIdOf(installIdentity, role);
  }
  private readonly owners = new Map<string, { installIdentity: string; generationId: string; provides: string[]; requires: string[];
    processSettings: Record<string, JsonValue>; settingsRevision: Restart | undefined }>();
  private readonly lifecycles = new Map<string, Lifecycle>();
  private readonly pendingRestarts = new Map<string, Restart>();
  private readonly restartJobs = new Map<string, Promise<void>>();
  private readonly stops = new Map<string, Promise<void>>();
  private settingsReader: ((installIdentity: string) => Promise<JsonValue>) | null = null;
  private stopped = false;
  /* Revoked generations: kept apart from `closing`, which stopPackage clears in its finally, so a start racing the close-out still refuses. */
  private readonly revoked = new Map<string, { generationId: string; error: HostPackageRevokedError }>();
  private readonly revokedListeners = new Set<(installIdentity: string) => void>();

  constructor(private readonly ports: { registry: Pick<ExtensionRegistryStore, "hostPackages">; hosts: Hosts; packageRoot(contentDigest: string): string;
    trust: ExtensionTrustGate; settings?: Pick<PackagePorts, "attachSettings" | "settingsChanged"> }) {}

  private admission: PackageAdmission | null = null;
  /** A probe enters the same package host before receiving a main-owned CLI fence. */
  async prepareProviderLaunch(installIdentity: string, descriptor: ProviderDescriptor, launch: AgentProcessLaunch,
    access: { workspace?: string; readOnly?: boolean; readRoots?: readonly string[]; writeRoots?: readonly string[];
      deniedReadRoots?: readonly string[]; controlRoot?: string; network?: boolean } = {}) {
    await this.ensure(installIdentity, "bridge");
    const current = await this.resolve(installIdentity);
    if (!current || current.manifest.provider?.id !== descriptor.providerId) throw new HostPackageContractError("package-inactive", [installIdentity]);
    const home = launch.env.HOME ?? homedir();
    const state = descriptor.sensitiveRoots.paths.map(path => resolve(home, path.replace(/^~(?:\/|$)/, "")));
    return fencePackageLaunch(launch, { identity: installIdentity, providerId: descriptor.providerId, workspace: access.workspace,
      readOnly: access.readOnly, network: access.network ?? true, deniedReadRoots: access.deniedReadRoots, controlRoot: access.controlRoot, readRoots: [current.packageRoot, ...(access.readRoots ?? [])],
      writeRoots: [...state, ...(access.writeRoots ?? [])], protectedRoots: [current.packageRoot, ...(access.readRoots ?? [])] });
  }
  /** The plugin catalog's resolver (appendix C.2): once attached, negotiation asks it, so the page and the runtime never disagree. */
  attachAdmission(admission: PackageAdmission) { this.admission = admission; }
  /** The plugin catalog answers each package's settings.get. */
  attachSettings(reader: (installIdentity: string) => Promise<JsonValue>) {
    this.settingsReader = reader;
    this.ports.settings?.attachSettings(async (installIdentity, hostId) => {
      const owner = this.owners.get(hostId);
      const current = await reader(installIdentity);
      return { ...asRecord(current), ...owner?.processSettings };
    });
  }

  /** Saving never waits for busy work. The latest acknowledgement belongs to successful replacement, not disposal. */
  async settingsChanged(installIdentity: string, ids: readonly string[], restart: boolean, applied: () => void = () => {}) {
    if (restart) {
      const roles = new Set(this.pendingRestarts.get(installIdentity)?.roles);
      for (const role of ROLES) {
        const host = this.ports.hosts.get(this.hostId(installIdentity, role));
        if (host) { roles.add(role); host.drain(); }
      }
      this.pendingRestarts.set(installIdentity, { applied, roles });
      this.scheduleRestart(installIdentity);
      return;
    }
    this.ports.settings?.settingsChanged(ROLES.map(role => this.hostId(installIdentity, role)).filter(hostId => this.ports.hosts.get(hostId)), ids);
  }

  private lifecycle(installIdentity: string) {
    let life = this.lifecycles.get(installIdentity);
    if (!life) this.lifecycles.set(installIdentity, life = { queue: new SerialQueue(), controller: new AbortController() });
    return life;
  }

  private assertOpen(installIdentity: string, signal: AbortSignal) {
    if (this.isRevoked(installIdentity)) throw this.revoked.get(installIdentity)!.error;
    if (this.stopped || this.closing.has(installIdentity) || signal.aborted) throw new HostPackageContractError("package-inactive", [installIdentity]);
  }

  private scheduleRestart(installIdentity: string) {
    if (this.stopped || this.closing.has(installIdentity) || this.restartJobs.has(installIdentity)
      || !ROLES.some(role => this.ports.hosts.get(this.hostId(installIdentity, role)))) return;
    const life = this.lifecycle(installIdentity), signal = life.controller.signal;
    let failed = false;
    const job = life.queue.enqueue(() => this.replacePending(installIdentity, signal)).catch(cause => {
      failed = true;
      if (!signal.aborted) console.warn("[plugins] settings restart failed", cause);
    }).finally(() => {
      if (this.restartJobs.get(installIdentity) === job) this.restartJobs.delete(installIdentity);
      if (!failed && this.pendingRestarts.has(installIdentity)) this.scheduleRestart(installIdentity);
    });
    this.restartJobs.set(installIdentity, job);
  }

  private acknowledge(installIdentity: string, revision: Restart) {
    if (this.pendingRestarts.get(installIdentity) !== revision || revision.roles.size === 0) return;
    if (![...revision.roles].every(role => {
      const hostId = this.hostId(installIdentity, role);
      return this.ports.hosts.get(hostId)?.state === "running" && this.owners.get(hostId)?.settingsRevision === revision;
    })) return;
    for (const role of revision.roles) this.ports.hosts.get(this.hostId(installIdentity, role))!.resume();
    this.pendingRestarts.delete(installIdentity);
    revision.applied();
  }

  private async replacePending(installIdentity: string, signal: AbortSignal) {
    while (this.pendingRestarts.has(installIdentity)) {
      this.assertOpen(installIdentity, signal);
      if (!this.pendingRestarts.get(installIdentity)!.roles.size) return;
      const hostIds = ROLES.map(role => this.hostId(installIdentity, role));
      await this.ports.hosts.drain(hostIds, signal);
      this.assertOpen(installIdentity, signal);
      // One synchronous all-role check precedes all stop intents; completion events may have arrived while awaiting idle.
      if (!this.ports.hosts.isIdle(hostIds)) continue;
      const revision = this.pendingRestarts.get(installIdentity)!;
      await Promise.all(hostIds.map(hostId => this.ports.hosts.remove(hostId)));
      for (const hostId of hostIds) this.owners.delete(hostId);
      for (const role of revision.roles) await this.ensureOnce(installIdentity, role, signal, revision);
      this.assertOpen(installIdentity, signal);
      this.acknowledge(installIdentity, revision);
      if (this.pendingRestarts.get(installIdentity) === revision) throw new Error(`package ${installIdentity} exited during settings restart`);
    }
  }

  /** Installed generation metadata remains readable while disabled; it grants no runtime admission. */
  async manifest(installIdentity: string): Promise<HostPackageManifest | null> {
    const owner = this.ports.registry.hostPackages().find(item => item.installIdentity === installIdentity);
    if (!owner || owner.admission !== "valid") return null;
    const generation = owner.generations.find(item => item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId);
    if (!generation) return null;
    return hostPackageManifestSchema.parse(JSON.parse(await readFile(join(this.ports.packageRoot(generation.contentDigest), HOST_PACKAGE_MANIFEST), "utf8")));
  }

  /** The active, admitted generation of an installed host package; disabled or denied packages resolve to null. */
  async resolve(installIdentity: string): Promise<Resolved | null> {
    const owner = this.ports.registry.hostPackages().find(item => item.installIdentity === installIdentity);
    if (!owner || owner.administrativeState !== "active" || owner.admission !== "valid") return null;
    const generation = owner.generations.find(item => item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId);
    if (!generation) return null;
    const packageRoot = this.ports.packageRoot(generation.contentDigest);
    const manifest = hostPackageManifestSchema.parse(JSON.parse(await readFile(join(packageRoot, HOST_PACKAGE_MANIFEST), "utf8")));
    return { installIdentity, manifest, packageRoot, generationId: generation.packageGenerationId, contentDigest: generation.contentDigest,
      signature: generation.signature ?? null };
  }

  /** Every required contract must be met (by the host, a built-in plugin or another active package); an exclusive contract has one owner. */
  async negotiate(installIdentity: string) {
    const self = await this.resolve(installIdentity);
    if (!self) throw new HostPackageContractError("package-inactive", [installIdentity]);
    if (this.admission) {
      const verdict = await this.admission(installIdentity);
      if (verdict.missing.length) throw new HostPackageContractError("contract-missing", verdict.missing);
      if (verdict.conflicts.length) throw new HostPackageContractError("contract-conflict", verdict.conflicts);
      return { resolved: self };
    }
    /* No catalog attached (tests, early startup): the same resolver over the active packages alone. */
    const nodes: PluginNode[] = [];
    for (const owner of this.ports.registry.hostPackages()) {
      const other = await this.resolve(owner.installIdentity).catch(() => null);
      if (other) nodes.push({ id: other.installIdentity, provides: [...other.manifest.provides.map(item => item.contract), ...(other.manifest.provider ? [AGENT_PROVIDER_CONTRACT] : [])],
        requires: other.manifest.requires, enabled: true, platformSupported: true });
    }
    const resolution = resolvePlugins(nodes, contractKindOf);
    const missing = resolution.plugins[installIdentity]?.blockedBy.map(item => item.contract) ?? [];
    const conflicts = resolution.conflicts.filter(item => item.pluginIds.includes(installIdentity)).map(item => item.contract);
    if (missing.length) throw new HostPackageContractError("contract-missing", missing);
    if (conflicts.length) throw new HostPackageContractError("contract-conflict", conflicts);
    return { resolved: self };
  }

  /**
   * Starts (or returns) the package's service or bridge host. Installing never starts anything; the first caller does. Every call,
   * a new start or a running host alike, first re-checks the signature against the latest snapshot (cached per generation and
   * snapshot version); a refusal marks the generation revoked and closes it out through stopPackage.
   */
  async ensure(installIdentity: string, role: Role): Promise<UtilityHost> {
    const life = this.lifecycle(installIdentity), signal = life.controller.signal;
    this.assertOpen(installIdentity, signal);
    const current = await this.resolve(installIdentity);
    if (!current) throw new HostPackageContractError("package-inactive", [installIdentity]);
    await this.assertTrusted(current);
    return life.queue.enqueue(async () => {
      this.assertOpen(installIdentity, signal);
      const resolved = await this.resolve(installIdentity);
      if (!resolved) throw new HostPackageContractError("package-inactive", [installIdentity]);
      const manifest = resolved.manifest;
      if (manifest.provider) this.providerIds.set(installIdentity, manifest.provider.id);
      await this.replacePending(installIdentity, signal);
      const revision = this.pendingRestarts.get(installIdentity);
      if (revision) revision.roles.add(role);
      const host = await this.ensureOnce(installIdentity, role, signal, revision);
      this.assertOpen(installIdentity, signal);
      this.pendingRestarts.get(installIdentity)?.roles.add(role);
      if (revision) this.acknowledge(installIdentity, revision);
      // An edit during activation wins before a waiting caller can invoke with the old snapshot.
      await this.replacePending(installIdentity, signal);
      this.assertOpen(installIdentity, signal);
      return this.ports.hosts.get(host.plan.hostId)!;
    });
  }

  private async ensureOnce(installIdentity: string, role: Role, signal: AbortSignal, revision: Restart | undefined): Promise<UtilityHost> {
    this.assertOpen(installIdentity, signal);
    const current = await this.resolve(installIdentity);
    if (!current) throw new HostPackageContractError("package-inactive", [installIdentity]);
    await this.assertTrusted(current); // before negotiate: a revoked package answers revoked, never a contract error
    const { resolved } = await this.negotiate(installIdentity);
    const providerId = role === "bridge" ? resolved.manifest.provider?.id : undefined;
    if (providerId) { await assertProviderAdmitted(providerId); this.providerIds.set(installIdentity, providerId); }
    const entry = resolved.manifest.entries[role];
    if (!entry) throw new HostPackageContractError("entry-missing", [role]);
    const hostId = this.hostId(installIdentity, role);
    const path = providerId ? runtimePort().entryPath("package-provider") : join(resolved.packageRoot, entry);
    let host = this.ports.hosts.get(hostId);
    if (host && (host.state === "idle" || host.plan.entrySha256 !== await sha256(path) || this.owners.get(hostId)?.generationId !== resolved.generationId)) {
      await this.ports.hosts.remove(hostId); host = null; // a new generation replaces the process, never mixes code
    }
    if (!host) {
      const entrySha256 = await sha256(path);
      const values = asRecord(await this.settingsReader?.(installIdentity) ?? {});
      const processSettings = Object.fromEntries((resolved.manifest.settings ?? []).filter(field => field.appliesAt === "process-start")
        .map(field => [field.id, values[field.id] ?? null]));
      const moduleEnvironment: Record<string, string> = providerId ? { BOTTEGA_PROVIDER_ID: providerId,
        BOTTEGA_PROVIDER_MODULE: join(resolved.packageRoot, entry), BOTTEGA_PROVIDER_MODULE_SHA256: await sha256(join(resolved.packageRoot, entry)) } : {};
      this.assertOpen(installIdentity, signal);
      this.assertNotRevoked(resolved); // synchronous with create: a revocation that landed during the awaits above wins
      host = this.ports.hosts.create({ hostId, kind: role === "bridge" ? "provider-bridge" : "extension-host", entry: path,
        entrySha256, env: hostChildEnvironment(moduleEnvironment) },
        { packageFence: { identity: installIdentity, providerId, readRoots: [resolved.packageRoot, path], network: false } });
      this.owners.set(hostId, { installIdentity, generationId: resolved.generationId, provides: resolved.manifest.provides.map(item => item.contract), requires: [...resolved.manifest.requires], processSettings, settingsRevision: revision });
    }
    this.assertNotRevoked(resolved);
    this.assertOpen(installIdentity, signal);
    if (this.pendingRestarts.has(installIdentity)) host.drain();
    if (host.state !== "running") await host.start();
    this.assertOpen(installIdentity, signal);
    return host;
  }

  private assertNotRevoked(resolved: Resolved) {
    const mark = this.revoked.get(resolved.installIdentity);
    if (mark?.generationId === resolved.generationId) throw mark.error;
  }

  /* Local confirmation passes: the person confirmed this package at install. A host-custody RecoveryPendingError from a start is a
     different refusal and never reaches here, so it can never mark a package revoked. */
  private async assertTrusted(resolved: Resolved) {
    const verdict = await this.verdictOf(resolved);
    if (verdict.status === "refused") throw this.revoked.get(resolved.installIdentity)!.error;
  }

  /** One verdict and one revoked mark for the package's hosts and its Provider (d4c): a refusal marks the generation and closes it out. */
  private async verdictOf(resolved: Resolved): Promise<TrustVerdict> {
    this.assertNotRevoked(resolved);
    const verdict = await this.ports.trust.verify({ key: `generation:${resolved.generationId}`, signature: resolved.signature,
      contentDigest: resolved.contentDigest, packageRoot: resolved.packageRoot });
    if (verdict.status !== "refused") return verdict;
    const error = new HostPackageRevokedError(resolved.installIdentity, verdict.reason);
    this.revoked.set(resolved.installIdentity, { generationId: resolved.generationId, error });
    const stop = this.stopPackage(resolved.installIdentity, error);
    for (const listener of this.revokedListeners) { try { listener(resolved.installIdentity); } catch (cause) { console.warn("[host-packages] revocation listener failed", cause); } }
    await stop;
    return verdict;
  }

  /** The trust verdict of an active package's generation for its Provider's admission; null when the package is not active. */
  async trustVerdict(installIdentity: string): Promise<TrustVerdict | null> {
    const resolved = await this.resolve(installIdentity);
    if (!resolved) return null;
    const mark = this.revoked.get(installIdentity);
    if (mark?.generationId === resolved.generationId) return { status: "refused", reason: mark.error.reason };
    return this.verdictOf(resolved);
  }

  /** Whether the package's active generation is marked revoked, read synchronously (the Provider catalog and the bridge's last check). */
  isRevoked(installIdentity: string): boolean {
    const mark = this.revoked.get(installIdentity);
    if (!mark) return false;
    const owner = this.ports.registry.hostPackages().find(item => item.installIdentity === installIdentity);
    return owner?.activeGenerationRef?.packageGenerationId === mark.generationId;
  }

  /** Told of each new revocation (the Provider catalog rebuilds, so the Provider becomes unavailable and its bridge closes). */
  onRevoked(listener: (installIdentity: string) => void) { this.revokedListeners.add(listener); return () => { this.revokedListeners.delete(listener); }; }

  /**
   * CTR-08 disposal order, idempotent: (1) refuse new starts, (2) stop each host — which aborts its in-flight
   * requests — and wait for its exit, (3) clean its process groups (inside hosts.remove), (4) forget ownership.
   * Registry state and package data are left to the caller (disable/uninstall); nothing here deletes data.
   */
  stopPackage(installIdentity: string, cause?: Error): Promise<void> {
    const pending = this.stops.get(installIdentity);
    if (pending) return pending;
    this.closing.add(installIdentity);
    const life = this.lifecycle(installIdentity);
    life.controller.abort();
    life.controller = new AbortController();
    // Trust revocation may reach this from inside ensure's queue: disposal must never await its own queue.
    const stop = (async () => {
      try {
        await Promise.all(ROLES.map(role => this.ports.hosts.remove(this.hostId(installIdentity, role), cause)));
        for (const role of ROLES) this.owners.delete(this.hostId(installIdentity, role));
      } finally {
        this.closing.delete(installIdentity);
        this.stops.delete(installIdentity);
      }
    })();
    this.stops.set(installIdentity, stop);
    return stop;
  }

  stopAdmission() {
    this.stopped = true;
    for (const life of this.lifecycles.values()) life.controller.abort();
  }

  async close() {
    this.stopAdmission();
    await Promise.all([...this.lifecycles.keys()].map(id => this.stopPackage(id)));
    await Promise.all([...this.lifecycles.values()].map(life => life.queue.flush()));
  }

  /** Anything still running for the package: live hosts or journaled process groups (for the uninstall custody gate). */
  outstanding(installIdentity: string): string[] {
    return (["service", "bridge"] as const).flatMap(role => {
      const hostId = this.hostId(installIdentity, role), host = this.ports.hosts.get(hostId);
      return [...(host && host.state !== "idle" ? [`host:${hostId}`] : []),
        ...this.ports.hosts.descendants.list(hostId).map(item => `process:${item.processId}`)];
    });
  }

  /** Package identity of a host channel, known to main from ensure(); used by the package ports. */
  callerOf(hostId: string) {
    const owner = this.owners.get(hostId);
    if (!owner) return null;
    const { installIdentity, generationId, provides, requires } = owner;
    return { hostId, installIdentity, generationId, provides, requires };
  }
}

let installed: HostPackageRuntime | null = null;
export const installHostPackageRuntime = (runtime: HostPackageRuntime | null) => { installed = runtime; };
export function requireHostPackageRuntime() {
  if (!installed) throw new Error("package-runtime-unavailable");
  return installed;
}

export const hostIdOf = (installIdentity: string, role: "service" | "bridge") =>
  `h${createHash("sha256").update(installIdentity).digest("hex").slice(0, 16)}-${role}`;
const sha256 = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const asRecord = (value: JsonValue): Record<string, JsonValue> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
