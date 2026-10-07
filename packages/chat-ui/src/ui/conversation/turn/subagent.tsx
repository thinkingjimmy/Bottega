/**
 * [INPUT]: Subagent identity, display name, execution status and host-owned detail action.
 * [OUTPUT]: ConversationSubagent, the native subagent chip shared by all transcript hosts.
 * [POS]: A turn part; detail data and navigation remain in the host.
 */
import { CheckIcon, CircleXIcon } from "lucide-react";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import { SubagentAvatar } from "../subagents/avatar";

export function ConversationSubagent({ id, agent, name, status, disabled, title, onOpen }: {
  id: string; agent?: string; name: string; status: string; disabled?: boolean; title?: string; onOpen?(): void;
}) {
  const active = ["pendingInit", "running"].includes(status), completed = ["completed", "shutdown"].includes(status);
  return <button type="button" disabled={disabled || !onOpen} title={title} onClick={onOpen}
    className={cn("flex max-w-full items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-muted-foreground text-sm transition-colors disabled:opacity-60",
      onOpen ? "cursor-pointer hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed" : "cursor-default")}>
    <SubagentAvatar agentThreadId={id} agent={agent} size={18} /><span className="truncate">{name}</span>
    {active ? <Spinner className="size-3.5" /> : completed ? <CheckIcon className="size-3.5" /> : <CircleXIcon className="size-3.5 text-destructive" />}
  </button>;
}
