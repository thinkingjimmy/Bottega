/**
 * [INPUT]: Depends on shared AppDomainIdentity, Chat slot role and create-skill request
 * [OUTPUT]: In-app TurnCompletionAction is provided, which will consistently split the initial Base skill turn and subsequent Base/Static/Server edit into skill/rebuild/none
 * [POS]: The decision to terminate apps/services without status; AppsService redirects to keep the API open
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
