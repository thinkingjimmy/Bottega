/**
 * [INPUT]: Depends on shared AppDomainIdentity, Chat slot role and create-skill request
 * [OUTPUT]: Provides appTurnCompletionAction, classifying a completed edit turn as skill/rebuild/none, separating the Base initial skill-creation turn from later Base/Static/Server edits
 * [POS]: Stateless decision helper for apps/service; kept free of AppsService state so the classification stays a pure function
 */

import type { AppDomainIdentity } from "../../../../shared/apps-ipc";

export function appTurnCompletionAction(
  identity: AppDomainIdentity | null,
  role: "edit" | "use" | null | undefined,
  isCreateSkillTurn = false
) {
  if (role !== "edit" || !identity) return "none" as const;
  return identity.kind === "base" && isCreateSkillTurn
    ? ("skill" as const)
    : ("rebuild" as const);
}
