/**
 * [INPUT]: Depends on the shared Popover/Command/Button primitives, the coarse-pointer hook and workbench-copy.
 * [OUTPUT]: Provides AvailableInSelect — "All Projects" or any set of Projects, with search — and availableInLabel.
 * [POS]: The Available in field of the Agent config dialog (Q42: a picker filter, multi-select, no replacement rule).
 */
import { useState } from "react";
import { ChevronDownIcon, FolderIcon, LayersIcon } from "lucide-react";
import type { AgentConfigPayload } from "@ai-chat/cloud-protocol/agent-config/payload";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "@ai-chat/ui/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { useCoarsePointer } from "@ai-chat/ui/hooks/use-mobile";
import type { WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";

type AvailableIn = AgentConfigPayload["availableIn"];
export type ProjectOption = { id: string; name: string };

/** Names only Projects that still exist; a config listed for removed Projects alone reads as none. */
export function availableInLabel(value: AvailableIn, projects: readonly ProjectOption[], workbench: WorkbenchCopy) {
  if (value === "all") return workbench.agentConfigs.allProjects;
  const names = value.projects.flatMap(id => projects.find(project => project.id === id)?.name ?? []);
  return names.length ? names.join(", ") : workbench.agentConfigs.noProjects;
}

const itemClass = "min-h-8 gap-2 rounded-lg px-2.5 py-1.5 text-sm max-md:min-h-11 pointer-coarse:min-h-11 data-[checked=true]:bg-transparent!";

export function AvailableInSelect({ id, value, projects, disabled, workbench, onChange }: {
  id: string;
  value: AvailableIn;
  projects: readonly ProjectOption[];
  disabled?: boolean;
  workbench: WorkbenchCopy;
  onChange(next: AvailableIn): void;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const touch = useCoarsePointer();
  const chosen = new Set(value === "all" ? [] : value.projects);
  const needle = query.trim().toLocaleLowerCase();
  const visible = projects.filter(project => project.name.toLocaleLowerCase().includes(needle));
  const toggle = (projectId: string) => {
    const next = new Set(chosen);
    if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
    // Unchecking the last Project returns to All Projects: the schema has no "nowhere", and an empty list would hide the config.
    onChange(next.size ? { projects: projects.map(project => project.id).filter(key => next.has(key)) } : "all");
  };
  return (
    <Popover open={open && !disabled} onOpenChange={next => { setOpen(next); setQuery(""); }}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button id={id} type="button" variant="outline" className="h-9 w-full justify-between gap-2 font-normal pointer-coarse:h-11">
          <span className="truncate">{availableInLabel(value, projects, workbench)}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} collisionPadding={16} aria-label={workbench.agentConfigs.availableIn}
        className="flex w-(--radix-popover-trigger-width) min-w-64 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl p-0"
        onOpenAutoFocus={event => { if (touch) event.preventDefault(); }}>
        <Command shouldFilter={false} loop className="min-h-0 rounded-xl p-0">
          <CommandInput value={query} onValueChange={setQuery} placeholder={workbench.agentConfigs.searchProjects}
            aria-label={workbench.agentConfigs.searchProjects} autoComplete="off" spellCheck={false}
            className="min-w-0 bg-transparent text-sm max-md:text-base pointer-coarse:text-base" />
          <CommandList className="max-h-60 px-1 pb-1">
            <CommandItem value="all" data-checked={value === "all"} className={itemClass} onSelect={() => onChange("all")}>
              <LayersIcon className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{workbench.agentConfigs.allProjects}</span>
            </CommandItem>
            {projects.length === 0 && <p className="py-4 text-center text-muted-foreground text-sm">{workbench.agentConfigs.noProjects}</p>}
            {visible.map(project => (
              <CommandItem key={project.id} value={project.id} data-checked={chosen.has(project.id)} className={itemClass}
                onSelect={() => toggle(project.id)}>
                <FolderIcon className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{project.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
