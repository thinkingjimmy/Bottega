/**
 * [INPUT]: Exact Gateway/Platform public operations and an optional passive event writer.
 * [OUTPUT]: Opt-in lease/activation/window correlation that preserves original promises, marks missing metadata/write failures and omits business payloads.
 * [POS]: Operation-loaded diagnostics only; observations never grant runtime authority or retry work.
 */
import type { UnifiedPluginSurfaceGateway } from "../gateway";
import type { UnifiedPluginPlatform } from "../service";

type Identity = { leaseId?: string; pluginId?: string; contributionId?: string; revisionId?: string; activationId?: string; windowId?: number };
type Fields = Identity & { liveActivationId?: string; leaseWindowId?: number; method?: string; reason?: string; code?: string; identityKnown?: boolean; parentToken?: number; lostSequence?: number };
export type PluginSurfaceTraceEvent = Fields & { sequence: number; at: number; event: string; token: number; writeFailures: number; metadataEvictions: number };
const knownErrors = new Set(["Plugin Surface lease is unavailable", "Plugin surface lease is unavailable", "Plugin activation is no longer active",
  "Plugin activation changed while opening its Surface", "Plugin is not active", "Plugin service activation is unavailable", "Plugin service is unavailable", "host crashed"]);
const resultCode = (cause: unknown) => cause instanceof Error ? knownErrors.has(cause.message) ? cause.message : cause.name : "unknown-error";

export function instrumentPluginSurfaces(gateway: UnifiedPluginSurfaceGateway, platform: UnifiedPluginPlatform,
  write: (event: PluginSurfaceTraceEvent) => void = event => console.warn("[plugin-surface-trace]", JSON.stringify(event))) {
  const metadata = new Map<string, Identity>();
  let sequence = 0, operations = 0, writeFailures = 0, metadataEvictions = 0;
  let scope: { token: number; reason: string } | undefined;
  const emit = (event: string, token: number, fields: Fields = {}) => {
    const row = { sequence: ++sequence, at: Date.now(), event, token, writeFailures, metadataEvictions, ...fields };
    try { write(row); }
    catch {
      const failure = { sequence: ++sequence, at: Date.now(), event: "trace-write-failed", token, writeFailures: ++writeFailures,
        metadataEvictions, lostSequence: row.sequence };
      try { write(failure); } catch { try { process.stderr.write("[plugin-surface-trace] " + JSON.stringify(failure) + "\n"); } catch { /* Capture must treat a missing summary as incomplete. */ } }
    }
  };
  const live = (identity: Identity) => {
    try { return identity.pluginId ? platform.activationId(identity.pluginId, identity.revisionId) : undefined; }
    catch { return undefined; }
  };
  const fields = (leaseId: string, windowId: number): Fields => {
    const identity = metadata.get(leaseId);
    return { ...identity, leaseId, leaseWindowId: identity?.windowId, windowId, identityKnown: Boolean(identity), liveActivationId: identity && live(identity) };
  };
  const within = (reason: string, identity: Fields, run: () => void) => {
    const previous = scope, token = ++operations;
    emit(reason, token, { ...identity, liveActivationId: live(identity) }); scope = { token, reason };
    try { return run(); } finally { scope = previous; }
  };
  const originals = { open: gateway.open, call: gateway.call, release: gateway.release, releaseWindow: gateway.releaseWindow,
    revoke: gateway.revoke, revokePlugin: gateway.revokePlugin, close: gateway.close, runtimeFailed: platform.runtimeFailed };
  gateway.open = (input, windowId) => {
    const token = ++operations, identity = { pluginId: input.pluginId, contributionId: input.contributionId, windowId };
    emit("open-start", token, { ...identity, liveActivationId: live(identity) });
    const pending = originals.open.call(gateway, input, windowId);
    void pending.then(view => {
      const issued = { ...identity, leaseId: view.id, revisionId: view.generationId, activationId: view.activationId };
      metadata.set(view.id, issued);
      if (metadata.size > 512) {
        const oldest = metadata.keys().next().value!; metadata.delete(oldest); metadataEvictions++;
        emit("trace-metadata-evicted", token, { leaseId: oldest, reason: "bounded-observation-history" });
      }
      emit("open-issued", token, { ...issued, liveActivationId: live(issued) });
    }, cause => emit("open-failed", token, { ...identity, code: resultCode(cause), liveActivationId: live(identity) }));
    return pending;
  };
  gateway.call = (input, windowId) => {
    const token = ++operations, identity = fields(input.leaseId, windowId);
    emit("call-start", token, { ...identity, method: input.method });
    const pending = originals.call.call(gateway, input, windowId);
    void pending.then(() => emit("call-complete", token, { ...identity, liveActivationId: live(identity) }),
      cause => emit("call-failed", token, { ...identity, code: resultCode(cause), liveActivationId: live(identity) }));
    return pending;
  };
  gateway.release = (leaseId, windowId) => {
    emit("release", ++operations, { ...fields(leaseId, windowId), parentToken: scope?.token, reason: scope?.reason ?? "renderer-release" });
    return originals.release.call(gateway, leaseId, windowId);
  };
  gateway.revoke = (pluginId, revisionId, activationId) => within("revoke-activation", { pluginId, revisionId, activationId },
    () => originals.revoke.call(gateway, pluginId, revisionId, activationId));
  gateway.revokePlugin = pluginId => within("revoke-plugin", { pluginId }, () => originals.revokePlugin.call(gateway, pluginId));
  gateway.releaseWindow = windowId => within("release-window", { windowId }, () => originals.releaseWindow.call(gateway, windowId));
  gateway.close = () => within("gateway-close", {}, () => {
    originals.close.call(gateway); emit("trace-summary", ++operations, { reason: "gateway-closed" }); metadata.clear();
  });
  platform.runtimeFailed = (pluginId, revisionId, activationId, reason) => {
    const token = ++operations, identity = { pluginId, revisionId, activationId };
    const code = typeof reason === "string" && ["stopped", "crashed", "launch-failed", "handshake-timeout"].includes(reason) ? reason : resultCode(reason);
    emit("runtime-failure-start", token, { ...identity, reason: code, liveActivationId: live(identity) });
    const pending = originals.runtimeFailed.call(platform, pluginId, revisionId, activationId, reason);
    void pending.then(() => emit("runtime-failure-complete", token, { ...identity, liveActivationId: live(identity) }),
      cause => emit("runtime-failure-error", token, { ...identity, code: resultCode(cause), liveActivationId: live(identity) }));
    return pending;
  };
  emit("trace-enabled", ++operations);
  return () => { Object.assign(gateway, { open: originals.open, call: originals.call, release: originals.release, releaseWindow: originals.releaseWindow,
    revoke: originals.revoke, revokePlugin: originals.revokePlugin, close: originals.close }); platform.runtimeFailed = originals.runtimeFailed; metadata.clear(); };
}
