/**
 * [INPUT]: Depends on AppStore's verified generation and existing consent/Studio grant commands.
 * [OUTPUT]: Validates explicit installation consent and promotes the exact locally built generation.
 * [POS]: Shared authorization kernel for ordinary import and fixed-identity cloud installation.
 */
import type { AppInstallAuthorization } from "../../../../../shared/apps-ipc";
import type { AppStore } from "../../store/app-store";
export function assertStudioAuthorization(value: unknown): AppInstallAuthorization {
  const input = value as Partial<AppInstallAuthorization> | null;
  if (input?.scope !== "studio-only" || input.decision !== "approve-requested") throw new Error("APP_INSTALLATION_AUTHORIZATION_REQUIRED");
  return { scope: "studio-only", decision: "approve-requested" };
}
export async function authorizeAndPromote(apps: AppStore, appId: string, authorization: AppInstallAuthorization, canApproveExtensions: boolean,
  current: () => Promise<void> = async () => undefined) {
  assertStudioAuthorization(authorization);
  let record = apps.get(appId), pending = record?.generationBinding.pending;
  if (!record || !pending) return record!;
  const generation = record.generations.find(item => item.generationId === pending?.generationId);
  if (!generation) throw new Error("APP_INSTALLATION_GENERATION_MISSING");
  await current();
  if (generation.extensionRequirementResolution.kind === "frozen") {
    if (!canApproveExtensions) throw new Error("APP_EXTENSIONS_NOT_READY");
    record = await apps.resolvePendingConsent(appId, true); pending = record.generationBinding.pending;
  }
  await current();
  if (pending?.baseGuiDecision?.state === "consent-required") {
    record = await apps.resolvePendingBaseGuiConsent(appId, pending.baseGuiDecision.requestedCapabilities,
      pending.baseGuiDecision.requestedHostActions, pending.baseGuiDecision.requestedCapabilityScopes);
    pending = record.generationBinding.pending;
  }
  await current();
  if (generation.manifest.kind === "base" && generation.manifest.gui) {
    record = await apps.grantStudioAccess(appId, generation.generationId); pending = record.generationBinding.pending;
  }
  await current();
  return pending ? apps.promotePendingGeneration(appId, pending.expectedConsentRevision) : record;
}
