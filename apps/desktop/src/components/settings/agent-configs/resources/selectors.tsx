/**
 * [INPUT]: Depends on local resource inventories, shared form primitives and workbench copy.
 * [OUTPUT]: Provides ConfigResourceSelectors for explicit Skill and MCP ids, Base scope and linked Chats.
 * [POS]: Agent configuration resource fields; unavailable selections remain visible and removable across devices.
 */
import { useId } from "react";
import { AGENT_CONFIG_PAYLOAD_LIMITS } from "@ai-chat/cloud-protocol/agent-config/payload";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import type { ProjectOption } from "../available-in";
import { useConfigResources, type ResourceOption } from "./inventory";

type Selection = { skillIds: string[]; mcpIds: string[]; base: "read" | "read-write" };
function ResourceList({ label, options, selected, status, limit, readOnly, copy, onChange }: {
  label: string; options: ResourceOption[]; selected: string[]; status: "loading" | "ready" | "error"; limit: number;
  readOnly?: boolean; copy: WorkbenchCopy["agentConfigs"]; onChange(ids: string[]): void;
}) {
  const id = useId();
  const all: ResourceOption[] = [...options, ...selected.filter(value => !options.some(item => item.id === value)).map(value => ({ id: value, name: value, available: false }))];
  return <fieldset className="min-w-0 space-y-2">
    <legend className="flex w-full items-baseline justify-between gap-3 text-sm font-medium">{label}
      <span className="text-xs font-normal text-muted-foreground">{formatWorkbench(copy.selectedCount, { count: selected.length, limit })}</span></legend>
    {status !== "ready" && <p role="status" className="text-xs text-muted-foreground">{status === "loading" ? copy.resourcesLoading : copy.resourcesFailed}</p>}
    <div className="max-h-44 overflow-y-auto rounded-lg border p-2">
      {all.length === 0 && status === "ready" && <p className="p-2 text-xs text-muted-foreground">{copy.resourcesEmpty}</p>}
      {all.map((option, index) => {
        const checked = selected.includes(option.id);
        return <label key={option.id} htmlFor={`${id}-${index}`} className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm pointer-coarse:min-h-11" data-resource-id={option.id}>
          <input type="checkbox" className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2" id={`${id}-${index}`} checked={checked} disabled={!checked && (readOnly || !option.available || selected.length >= limit)}
            onChange={event => onChange(event.target.checked ? [...selected, option.id] : selected.filter(item => item !== option.id))} />
          <span className="min-w-0 flex-1 break-words">{option.name}{option.scope && <span className="ml-2 text-xs text-muted-foreground">{option.scope}</span>}</span>
          {!option.available && <span className="text-xs text-amber-700 dark:text-amber-400">{copy.resourceUnavailable}</span>}
        </label>;
      })}
    </div>
  </fieldset>;
}

export function ConfigResourceSelectors({ value, readOnly, projects, provider, copy, onChange }: {
  value: Selection; readOnly: boolean; projects: readonly ProjectOption[]; provider: string;
  copy: WorkbenchCopy["agentConfigs"]; onChange(patch: Partial<Selection>): void;
}) {
  const inventory = useConfigResources(projects, provider);
  const id = useId();
  return <div className="space-y-4" data-config-scope="">
    <ResourceList label={copy.skills} options={inventory.skills} selected={value.skillIds} status={inventory.skillStatus}
      limit={AGENT_CONFIG_PAYLOAD_LIMITS.skills} copy={copy} onChange={skillIds => onChange({ skillIds })} />
    <fieldset className="min-w-0 space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{copy.toolsAndData}</legend>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm">{copy.baseResource}</label>
        <Select value={readOnly ? "read" : value.base} disabled={readOnly} onValueChange={base => onChange({ base: base as Selection["base"] })}>
          <SelectTrigger id={id} className="w-40 pointer-coarse:h-11"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="read">{copy.baseRead}</SelectItem><SelectItem value="read-write">{copy.baseReadWrite}</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="flex justify-between gap-3 text-sm"><span>{copy.chatResource}</span><span className="text-muted-foreground">{copy.linkedChats}</span></div>
      <ResourceList label={copy.mcpResource} options={inventory.servers} selected={value.mcpIds} status={inventory.mcpStatus}
        limit={AGENT_CONFIG_PAYLOAD_LIMITS.tools} readOnly={readOnly} copy={copy} onChange={mcpIds => onChange({ mcpIds })} />
      <p className="text-xs text-muted-foreground">{readOnly ? copy.resourcesReadOnly : copy.resourcesHint}</p>
      {readOnly && value.base === "read-write" && <p className="text-xs text-amber-700 dark:text-amber-400" data-resource-base-capped="">{copy.baseCapped}</p>}
      {readOnly && value.mcpIds.length > 0 && <p role="alert" className="text-xs text-destructive">{copy.removeReadOnlyMcp}</p>}
    </fieldset>
    {(inventory.skillStatus === "error" || inventory.mcpStatus === "error") && <Button type="button" size="sm" variant="outline" onClick={inventory.retry}>{copy.retryResources}</Button>}
  </div>;
}
