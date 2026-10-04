/**
 * [INPUT]: Depends on the public Principal contract, BuiltinMcpLease liveness, the App surface lease registry's per-request `describe`, and a trusted renderer context
 * [OUTPUT]: Provides VerifiedPrincipal (principal + stable key + assertCurrent), PrincipalRevokedError, and the host constructors agentTurnPrincipal, appSurfacePrincipal, hostPackagePrincipal, providerTurnPrincipal, userDevicePrincipal, workflowRunPrincipal (the run owner's step attempt) and WORKFLOW_PACKAGE_ID
 * [POS]: The only way a principal enters the host operation layer: built from a channel main already verified, and re-checked on every call so revocation takes effect immediately
 */
import { principalKey, principalSchema, type Principal } from "@ai-chat/cloud-protocol/contracts/principals";
import type { BuiltinMcpLease } from "../tools/lease";
import type { AppAttachmentSurfaceLeaseRegistry } from "../apps/attachments/surface-leases";
import type { TrustedRendererContext } from "../window/surfaces/trusted-renderer-context";

export type VerifiedPrincipal = Readonly<{
  principal: Principal;
  key: string;
  /** Throws PrincipalRevokedError once the channel that produced the principal is gone; called on every use. */
  assertCurrent(): void;
  /** Present when liveness needs an async owner check; the dispatcher awaits it before every call. */
  refresh?(): Promise<void>;
}>;

export class PrincipalRevokedError extends Error {
  readonly name = "PrincipalRevokedError";
  readonly code = "principal-revoked";
  constructor(readonly key: string) { super(`principal revoked: ${key}`); }
}

function verified(principal: Principal, live: () => boolean): VerifiedPrincipal {
  const value = principalSchema.parse(principal);
  const key = principalKey(value);
  return Object.freeze({ principal: value, key, assertCurrent: () => { if (!live()) throw new PrincipalRevokedError(key); } });
}

/** An Agent turn, derived from the live lease main issued for it (never from a chatId the caller names). */
export function agentTurnPrincipal(lease: BuiltinMcpLease): VerifiedPrincipal {
  const turn = verified({ kind: "agent-turn", chat: { chatId: lease.chatId, incarnationId: lease.incarnationId },
    turnId: lease.requestId, leaseId: lease.leaseId }, () =>
    lease.state !== "revoked" && !lease.signal.aborted);
  /* A connection lease is rebound per turn; a principal minted for one turn must not outlive the rebind. */
  const requestId = lease.requestId;
  return Object.freeze({ ...turn, assertCurrent: () => { turn.assertCurrent(); if (lease.requestId !== requestId) throw new PrincipalRevokedError(turn.key); } });
}

/**
 * A bridged Provider turn: its Chat and request, and a lease id main minted for this bridge attempt. `live` is the turn
 * itself (false from its terminal on), so the bridge loses every ref of a finished turn at once.
 */
export function providerTurnPrincipal(chat: { chatId: string; incarnationId: string }, requestId: string, turnKey: string, live: () => boolean): VerifiedPrincipal {
  return verified({ kind: "agent-turn", chat, turnId: requestId, leaseId: `bridge-${turnKey}` }, live);
}

/** An App surface, derived from the host surface lease; `describe` re-checks generation and grant drift. */
export async function appSurfacePrincipal(surfaces: Pick<AppAttachmentSurfaceLeaseRegistry, "describe">, surfaceLeaseId: string): Promise<VerifiedPrincipal> {
  const surface = await surfaces.describe(surfaceLeaseId);
  let live = true;
  const principal = verified({ kind: "app-surface", appId: surface.appId, generationId: surface.generationId, surfaceLeaseId }, () => live);
  return Object.freeze({ ...principal,
    refresh: async () => {
      try {
        const current = await surfaces.describe(surfaceLeaseId);
        live = current.appId === surface.appId && current.generationId === surface.generationId;
      } catch { live = false; }
      principal.assertCurrent();
    } });
}

/**
 * A host package's own service/bridge host, as an App surface: appId = install identity, generationId = the package
 * generation main started, surfaceLeaseId = the host channel. `live` re-checks that main still attributes that channel to
 * the same package generation, so a stopped, disabled or replaced package loses the principal at once.
 */
export function hostPackagePrincipal(caller: { hostId: string; installIdentity: string; generationId: string }, live: () => boolean): VerifiedPrincipal {
  return verified({ kind: "app-surface", appId: caller.installIdentity, generationId: caller.generationId, surfaceLeaseId: caller.hostId }, live);
}

/** This installation's trusted renderer; `live` must re-check the window and renderer incarnation. */
export function userDevicePrincipal(context: TrustedRendererContext, deviceId: string, live: () => boolean): VerifiedPrincipal {
  return verified({ kind: "user-device", deviceId, rendererIncarnation: context.rendererIncarnation },
    () => !context.window.isDestroyed() && live());
}

/** Q3: a first-party run is the Workflow plugin's own, under the id that plugin already carries in the plugin list. */
export const WORKFLOW_PACKAGE_ID = "workflow";

/**
 * One step attempt of a Workflow run, minted only by the run owner (the executor) from its own ledger state, never from a
 * runId a caller names; `live` must re-check that this attempt is still the step's open one, so the principal dies with it.
 */
export function workflowRunPrincipal(attempt: { runId: string; stepId: string; attempt: number }, live: () => boolean): VerifiedPrincipal {
  return verified({ kind: "workflow-run", runId: attempt.runId, stepId: attempt.stepId, attempt: attempt.attempt, packageId: WORKFLOW_PACKAGE_ID }, live);
}
