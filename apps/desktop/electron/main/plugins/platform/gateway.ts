/**
 * [INPUT]: Immutable unified package descriptors, canonical/byte digests and the existing opaque Surface gateway.
 * [OUTPUT]: Verified exact-activation UI leases/revocation, explicit whole-plugin release, fenced async issuance and non-replayed process calls.
 * [POS]: Unified UI adapter over the shared isolated transport; local registry capacity does not set runtime budgets.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { unifiedPluginDistributionSchema, unifiedPluginRevisionId, type PluginReadiness, type UnifiedPluginRevision, type UnifiedPluginSurfaceDescriptor } from "@bottega/contracts/plugins/platform";
import type { PluginSurfaceDescriptor } from "@bottega/contracts/plugins/surface/native";
import type { PluginCandidateContext } from "./model";
import type { PluginSurfaceGateway } from "../surface-runtime/gateway";

type SurfacePorts = Readonly<{
  transport: PluginSurfaceGateway;
  activeRevision(pluginId: string): UnifiedPluginRevision | null;
  /** Returns an identity only while the exact revision and its dependencies are live. */
  activationId(pluginId: string, revisionId?: string): string | undefined;
  invoke?(input: { pluginId: string; revisionId: string; activationId: string; method: string; input: unknown; signal: AbortSignal }): Promise<unknown>;
  probe?(lease: PluginSurfaceDescriptor, signal: AbortSignal): Promise<void>;
}>;
type SurfaceLease = { view: UnifiedPluginSurfaceDescriptor; pluginId: string; revisionId: string; windowId: number; controller: AbortController; isValid: () => boolean };
const digest = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const mime = (path: string) => path.endsWith(".html") ? "text/html; charset=utf-8" : path.endsWith(".js") || path.endsWith(".mjs")
  ? "text/javascript; charset=utf-8" : path.endsWith(".css") ? "text/css; charset=utf-8" : path.endsWith(".svg") ? "image/svg+xml"
    : path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg"
      : path.endsWith(".webp") ? "image/webp" : path.endsWith(".woff2") ? "font/woff2" : path.endsWith(".woff") ? "font/woff"
        : path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".json") ? "application/json" : "application/octet-stream";
export class UnifiedPluginSurfaceGateway {
  private readonly leases = new Map<string, SurfaceLease>();
  constructor(private ports: SurfacePorts) {}
  async prepare(input: PluginCandidateContext): Promise<PluginReadiness[]> {
    const ui = input.revision.manifest.contributions.filter(value => (value.kind === "page" || value.kind === "widget" || value.kind === "composer") &&
      !("hostAppId" in value && value.hostAppId) && !("hostViewId" in value && value.hostViewId));
    const results: PluginReadiness[] = [];
    for (const contribution of ui) {
      input.signal.throwIfAborted();
      const lease = await this.issue(input.revision, contribution.id, -1, () => !input.signal.aborted);
      try {
        await (this.ports.probe ?? probePluginSurface)(lease, input.signal);
        input.signal.throwIfAborted();
        results.push({ contributionId: contribution.id, kind: contribution.kind, ready: true });
      } finally { this.ports.transport.release(lease.id, -1); }
    }
    return results;
  }
  async open(input: { pluginId: string; contributionId: string; instanceId?: string }, windowId: number): Promise<UnifiedPluginSurfaceDescriptor> {
    const revision = this.ports.activeRevision(input.pluginId);
    const activationId = revision && this.ports.activationId(input.pluginId, revision.revisionId);
    if (!revision || !activationId) throw new Error("Plugin is not active");
    const isValid = () => this.ports.activationId(input.pluginId, revision.revisionId) === activationId;
    const issued = await this.issue(revision, input.contributionId, windowId, isValid);
    if (!isValid()) { this.ports.transport.release(issued.id, windowId); throw new Error("Plugin activation changed while opening its Surface"); }
    const view: UnifiedPluginSurfaceDescriptor = { ...issued, activationId };
    this.leases.set(view.id, { view, pluginId: input.pluginId, revisionId: revision.revisionId,
      windowId, controller: new AbortController(), isValid });
    return view;
  }
  async call(input: { leaseId: string; method: string; input: unknown }, windowId: number): Promise<unknown> {
    const lease = this.leases.get(input.leaseId);
    if (!lease || lease.windowId !== windowId) throw new Error("Plugin Surface lease is unavailable");
    await this.ports.transport.validate(input.leaseId, windowId);
    if (this.leases.get(input.leaseId) !== lease || lease.controller.signal.aborted) throw new Error("Plugin Surface lease is unavailable");
    if (!lease.isValid()) throw new Error("Plugin activation is no longer active");
    if (!this.ports.invoke) throw new Error("Plugin service is unavailable");
    if (Buffer.byteLength(JSON.stringify(input.input) ?? "null") > 1_048_576) throw new Error("Plugin call exceeds its input budget");
    return this.ports.invoke({ pluginId: lease.pluginId, revisionId: lease.revisionId, activationId: lease.view.activationId, method: input.method, input: input.input, signal: lease.controller.signal });
  }
  release(leaseId: string, windowId: number) {
    const lease = this.leases.get(leaseId);
    if (lease && lease.windowId !== windowId) return;
    lease?.controller.abort(); this.leases.delete(leaseId); this.ports.transport.release(leaseId, windowId);
  }
  releaseWindow(windowId: number) {
    for (const [id, lease] of this.leases) if (lease.windowId === windowId) this.release(id, windowId);
  }
  revoke(pluginId: string, revisionId: string, activationId: string) {
    for (const [id, lease] of this.leases) if (lease.pluginId === pluginId && lease.revisionId === revisionId && lease.view.activationId === activationId) this.release(id, lease.windowId);
  }
  revokePlugin(pluginId: string) { for (const [id, lease] of this.leases) if (lease.pluginId === pluginId) this.release(id, lease.windowId); }
  close() { for (const [id, lease] of this.leases) this.release(id, lease.windowId); }
  private async issue(revision: UnifiedPluginRevision, contributionId: string, windowId: number, isValid: () => boolean): Promise<PluginSurfaceDescriptor> {
    const contribution = revision.manifest.contributions.find(value => value.id === contributionId);
    if (contribution && "hostViewId" in contribution && contribution.hostViewId) throw new Error("Native host views use their main-owned adapter");
    if (contribution && "hostAppId" in contribution && contribution.hostAppId) throw new Error("Hosted App pages use their original App gateway");
    if (!contribution || !("entry" in contribution) || !["page", "widget", "composer"].includes(contribution.kind)) throw new Error("Plugin UI contribution is not declared");
    const root = await realpath(revision.rootDirectory);
    if (await realpath(revision.rootDirectory) !== root || (await lstat(revision.rootDirectory)).isSymbolicLink()) throw new Error("Plugin revision directory is not sealed");
    const descriptorPath = join(root, "plugin-package.json");
    const descriptorInfo = await lstat(descriptorPath);
    if (!descriptorInfo.isFile() || descriptorInfo.isSymbolicLink() || descriptorInfo.size > 4 * 1024 * 1024) throw new Error("Plugin package descriptor is invalid");
    const descriptor = unifiedPluginDistributionSchema.parse(JSON.parse(await readFile(descriptorPath, "utf8")));
    if (descriptor.pluginId !== revision.pluginId || descriptor.revisionId !== revision.revisionId ||
      unifiedPluginRevisionId(descriptor) !== revision.revisionId || "sha256:" + hashCanonical(descriptor) !== revision.packageDigest ||
      "sha256:" + hashCanonical(descriptor.manifest) !== descriptor.manifestDigest ||
      hashCanonical(descriptor.manifest) !== hashCanonical(revision.manifest)) throw new Error("Plugin immutable package identity differs");
    const entryDirectory = dirname(contribution.entry);
    const files: { path: string; mime: string; bytes: Uint8Array; sha256: string }[] = [];
    for (const file of descriptor.files.filter(value => value.role === "runtime" &&
      (value.path === contribution.entry || value.path.startsWith(entryDirectory + "/")))) {
      const path = join(root, file.path), resolved = await realpath(path), rel = relative(root, resolved), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || rel.startsWith("..") || isAbsolute(rel) || resolved !== path ||
        info.size !== file.bytes) throw new Error("Plugin runtime file identity differs: " + file.path);
      const bytes = await readFile(path);
      if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) throw new Error("Plugin runtime file digest differs: " + file.path);
      files.push({ path: file.path, mime: mime(file.path), bytes, sha256: file.sha256 });
    }
    return this.ports.transport.issuePublished({ pluginId: revision.pluginId, generationId: revision.revisionId,
      artifactDigest: descriptor.contentDigest, entry: contribution.entry, files,
      sourceFormat: { id: "bottega-plugin", version: 1, readableVersions: [1] }, operations: [], features:descriptor.manifest.requirements.features,isValid }, windowId);
  }
}

/** Real load verification runs with no Node integration and no active business-RPC receiver. */
async function probePluginSurface(lease: PluginSurfaceDescriptor, signal: AbortSignal): Promise<void> {
  const { BrowserWindow } = await import("electron");
  const window = new BrowserWindow({ show: false, width: 960, height: 640, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "plugin-prepare-" + lease.id,
    backgroundThrottling: false, webSecurity: true,
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const errors: string[] = [];
  window.webContents.on("console-message", details => { if (details.level === "error") errors.push(details.message); });
  window.webContents.on("render-process-gone", (_event, details) => { errors.push("Plugin renderer exited: " + details.reason); });
  window.webContents.on("will-navigate", (event, url) => { if (url !== lease.url) event.preventDefault(); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((cause: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort?.(signal.reason instanceof Error ? signal.reason : new Error("Plugin interface preparation was cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Plugin interface did not become ready")), 10_000); });
    await Promise.race([window.loadURL(lease.url).then(async () => {
      await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", false);
      if (errors.length) throw new Error(errors.join("; ").slice(0, 2048));
    }), timeout, aborted]);
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort);
    if (!window.isDestroyed()) window.destroy();
  }
}
