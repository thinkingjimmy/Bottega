/**
 * [INPUT]: The shared canonical hash function only.
 * [OUTPUT]: Deterministic teamExecutionId and teamExecutionOwner for one Lead incarnation.
 * [POS]: Main-owned authoring group identity leaf; carries no feature validator or runtime imports.
 */
import { hashCanonical } from "../../core/canonical-json";
export const teamExecutionId = (pluginId: string, leadChatId: string, leadIncarnation: string) =>
  "team_" + hashCanonical([pluginId, leadChatId, leadIncarnation]).slice(0, 64);
export const teamExecutionOwner = (pluginId: string, leadChatId: string, leadIncarnation: string) =>
  ({ kind: "team" as const, id: teamExecutionId(pluginId, leadChatId, leadIncarnation) });
