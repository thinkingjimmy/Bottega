/**
 * [INPUT]: Depends on sealed App records, Base GUI grant projection, manifest-derived capability requests, and an injected AppStore commit boundary
 * [OUTPUT]: Provides exact generation/content/compatibility-bound Studio grant derivation with no renderer-selected authority fields
 * [POS]: AppStore command leaf; AppStore owns serialization while this module owns Studio grant policy
 */

import type { AppRecord } from "../../../../shared/apps-ipc";
import {
  requestedBaseGuiCapabilities,
  requestedBaseGuiCapabilityScopes,
  requestedBaseGuiHostActions,
  studioDataGrantForManifest,
} from "../../../../shared/apps-surface-ipc";
import { conflict } from "../generation/app-generation-plan";
import type { BaseGuiGrantStore } from "../base-gui/grant-store";

type Ports = Readonly<{
  get(appId: string): AppRecord | undefined;
  grants: BaseGuiGrantStore | null;
  commit(next: AppRecord, appId: string, previous: AppRecord): Promise<AppRecord>;
}>;

export async function grantStudioAccess(
  ports: Ports,
  appId: string,
  generationId: string
) {
  const current = ports.get(appId);
  const generation = current?.generations.find(
    (item) => item.generationId === generationId
  );
  const data = studioDataGrantForManifest(generation?.manifest);
  if (!current || !generation || !data) {
    throw new Error("App generation 没有可授权的 Studio GUI");
  }
  const projection = ports.grants?.projection(appId, generationId);
  const requestedCapabilities = requestedBaseGuiCapabilities(generation.manifest);
  const requestedHostActions = requestedBaseGuiHostActions(generation.manifest);
  const requestedScopes = requestedBaseGuiCapabilityScopes(generation.manifest);
  const hasDecisionRequest =
    requestedCapabilities.length > 0 || requestedHostActions.length > 0;
  if (
    hasDecisionRequest &&
    (!projection ||
      projection.revokedAt ||
      projection.decision?.state !== "approved" ||
      requestedCapabilities.some(
        (capability) => !projection.capabilities.includes(capability)
      ) ||
      requestedHostActions.some(
        (action) => !projection.hostActions.includes(action)
      ) ||
      projection.capabilityScopes.workspaceRead !== requestedScopes.workspaceRead)
  ) {
    /* 码归日志、人话归人：renderer 靠前半段的稳定码分流到本地化解释，
       后半段才是给用户看的一句话。两段合写成一句中文，等于把分类信息
       藏进措辞里——措辞一改，分支就断。 */
    throw conflict("APP_STUDIO_GRANT_CONFLICT: Base GUI 尚未批准全部声明权限");
  }
  const grant = {
    appId,
    generationId,
    contentDigest: generation.contentDigest,
    data,
    agentDelegation: { fileRead: false as const, useData: false as const },
    baseGuiDecisionId: projection?.decision?.decisionId ?? null,
    baseGuiDecisionRevision: projection?.revision ?? 0,
    ...(generation.compatibilityRefDigest
      ? { compatibilityRefDigest: generation.compatibilityRefDigest }
      : {}),
    grantedAt: Date.now(),
  };
  const previous = current.studioGrant;
  if (
    previous?.generationId === grant.generationId &&
    previous.contentDigest === grant.contentDigest &&
    previous.baseGuiDecisionId === grant.baseGuiDecisionId &&
    previous.baseGuiDecisionRevision === grant.baseGuiDecisionRevision &&
    previous.compatibilityRefDigest === grant.compatibilityRefDigest &&
    previous.data.level === grant.data.level
  ) {
    return current;
  }
  return ports.commit({
    ...current,
    studioGrant: grant,
    studioGrantRevision: (current.studioGrantRevision ?? 0) + 1,
  }, appId, current);
}
