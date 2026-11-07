/**
 * [INPUT]: Canonical active plugin modes, current Chat metadata, the installed Team service and execution-group identity.
 * [OUTPUT]: Resolves an exact existing Team participant or selected Team mode to its source writer owner.
 * [POS]: Operation-only Team source admission; ordinary modes retain the integration owner's exclusive turn fallback.
 */
import { teamExecutionOwner } from "@bottega/contracts/plugins/team/identity";
import type { ChatStore } from "../../../chats/chat-store";
import type { PluginSourceTurnInput } from "../../integration/turns";
import type { UnifiedPluginPlatform } from "../../platform/service";
import { installedPluginTeams } from "./installed";

export function teamSourceAuthoringOwner(input: PluginSourceTurnInput, projectId: string | undefined,
  platform: Pick<UnifiedPluginPlatform, "get" | "isActive">, chats: Pick<ChatStore, "getMetadata">) {
  const chat = chats.getMetadata(input.chatId);
  if (!input.incarnationId || chat?.incarnationId !== input.incarnationId || !projectId || chat.projectId !== projectId || chat.readOnlyReason) return null;
  const service = installedPluginTeams(), team = service?.teamForChat(input.chatId);
  if (team?.status === "active" && team.projectId === projectId &&
    (team.leadChatId === input.chatId && team.leadIncarnation === input.incarnationId ||
      team.members.some(member => member.chatId === input.chatId && member.incarnation === input.incarnationId)))
    return service!.authoringOwnerForChat(input.chatId);
  const pluginId = input.mode?.pluginId;
  if (!pluginId || !platform.isActive(pluginId)) return null;
  const mode = platform.get(pluginId)?.manifest.contributions.find(value => value.kind === "mode" && value.id === input.mode?.id);
  return mode?.kind === "mode" && mode.strategy?.team === true && !mode.nativeRequirements?.readOnly
    ? teamExecutionOwner(pluginId, input.chatId, input.incarnationId) : null;
}
