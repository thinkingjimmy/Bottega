/**
 * [INPUT]: Depends on SubagentSpawnService and the incarnation-bound BuiltinToolContext
 * [OUTPUT]: Provides createSubagentToolset, binding the static spawn_subagent spec to the parent turn narrow channel
 * [POS]: The only layer of adaptation to the general built-in tool platform in the agent domain; Do not accept any arbitrary domain parameters such as chatId/requestId
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";
import type { BuiltinToolset } from "../tools/registry";
import {
  SubagentSpawnService,
  type SpawnSubagentInput,
} from "./subagent-spawn";

export function createSubagentToolset(
  service = new SubagentSpawnService()
): BuiltinToolset {
  return {
    spawn_subagent: (args, context) =>
      service.spawn(
        {
          agent: args.agent as AgentBackendId,
          prompt: args.prompt as string,
          ...(args.name ? { name: args.name as string } : {}),
          timeout_seconds: args.timeout_seconds as number,
        } satisfies SpawnSubagentInput,
        context
      ),
  };
}
