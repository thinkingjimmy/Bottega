/**
 * [INPUT]: Depends on UI Select, Apps i18n, Agent backend labels/icons, and shared BackendInfo
 * [OUTPUT]: Provides AgentSelect with AgentSelectValue, brand logo + name drop down the Agent form, select Auto strategy items, and either labelledBy or label as its accessible name
 * [POS]: Shared Apps Agent picker; callers filter candidates while this control owns Auto strategy presentation
 */

import { Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import { cn } from "@ai-chat/ui/lib/utils";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import type { AgentBackendId, BackendInfo } from "../../../shared/agent-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";

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
  label,
  size,
  className,
  onChange,
}: {
  value: AgentSelectValue;
  options: BackendInfo[];
  allowAuto?: boolean;
  disabled?: boolean;
  /* 名字二选一：竖排表单里旁边就站着一个 <span id>，用 labelledBy 指过去；
     设置行里标签没有 id（它是 SettingsRow 的私事），用 label 直接报名。
     两者都缺则这颗控件对读屏用户没有名字，故至少要给一个。 */
  labelledBy?: string;
  label?: string;
  size?: "sm" | "default" | "lg";
  className?: string;
  onChange: (value: AgentSelectValue) => void;
}) {
  const { t } = useAppTranslation();
  const labelOf = (id: AgentSelectValue) =>
    id === "auto"
      ? t("common.auto")
      : (options.find((backend) => backend.id === id)?.displayName ??
        backendLabel(id));

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as AgentSelectValue)}
    >
      <SelectTrigger
        aria-label={label}
        aria-labelledby={labelledBy}
        className={cn("w-full min-w-0", className)}
        size={size}
      >
        <SelectValue>
          <AgentRow value={value} label={labelOf(value)} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-44">
        {allowAuto && (
          <SelectItem value="auto">
            <AgentRow value="auto" label={t("common.auto")} />
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
