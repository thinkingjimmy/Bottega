/**
 * [INPUT]: Depends on ui/select, lib/agent-backends with AgentBackendIcon/backendLabel and shared BackendInfo
 * [OUTPUT]: Provides AgentSelect with AgentSelectValue, brand logo + name drop down the Agent form, select Auto strategy items
 * [POS]: The only control selected by the App Agent form is shared by a single run Agent with the addition of a dual role setting; Chat by installed First round trial and error, and the next candidate is filtered by the caller
 */

import { Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import type { AgentBackendId, BackendInfo } from "../../../shared/agent-ipc";

export type AgentSelectValue = AgentBackendId | "auto";

/* Auto 不是一个 Agent 而是一条挑选策略，因此它是这里唯一合理的图标例外 */
function AgentRow({ value, label }: { value: AgentSelectValue; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {value === "auto" ? (
        <Sparkles className="size-3.5 text-muted-foreground" />
      ) : (
        <AgentBackendIcon backend={value} className="size-3.5" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function AgentSelect({
  value,
  options,
  allowAuto = false,
  disabled,
  labelledBy,
  onChange,
}: {
  value: AgentSelectValue;
  options: BackendInfo[];
  allowAuto?: boolean;
  disabled?: boolean;
  labelledBy: string;
  onChange: (value: AgentSelectValue) => void;
}) {
  const labelOf = (id: AgentSelectValue) =>
    id === "auto"
      ? "Auto"
      : (options.find((backend) => backend.id === id)?.displayName ??
        backendLabel(id));

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as AgentSelectValue)}
    >
      <SelectTrigger
        aria-labelledby={labelledBy}
        className="w-full min-w-0"
      >
        <SelectValue>
          <AgentRow value={value} label={labelOf(value)} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-44">
        {allowAuto && (
          <SelectItem value="auto">
            <AgentRow value="auto" label="Auto" />
          </SelectItem>
        )}
        {options.map((backend) => (
          <SelectItem
            key={backend.id}
            value={backend.id}

            disabled={backend.runtimeStatus !== "installed"}
          >
            <AgentRow value={backend.id} label={backend.displayName} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
