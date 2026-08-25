/**
 * [INPUT]: Depends on shared AgentBackendId, renderer AgentBackendIcon and algorithm AgentAvatar
 * [OUTPUT]: Provides SubagentAvatar; The spawn brand shows the target Agent logo when specified, and the native record maintains a stable algorithm headline
 * [POS]: The headline of chat/subagent is a single source of truth shared by a list, detail and transcript chip
 */

import type { AgentBackendId } from "../../../../shared/agent-ipc";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { cn } from "@ai-chat/ui/lib/utils";
import { AgentAvatar } from "./agent-avatar";

export function SubagentAvatar({
  agentThreadId,
  agent,
  size = 20,
  className,
}: {
  agentThreadId: string;
  agent?: AgentBackendId;
  size?: number;
  className?: string;
}) {
  if (!agent) {
    return (
      <AgentAvatar
        className={className}
        identity={agentThreadId}
        size={size}
      />
    );
  }
  return (
    <AgentBackendIcon
      aria-label={`${backendLabel(agent)} Subagent`}
      backend={agent}
      className={cn("shrink-0", className)}
      style={{ height: size, width: size }}
    />
  );
}
