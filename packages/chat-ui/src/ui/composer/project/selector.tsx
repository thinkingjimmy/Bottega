/**
 * [INPUT]: Host Project metadata, localized copy and callbacks; shared Command/Popover/Button and delayed/pointer hooks.
 * [OUTPUT]: ProjectMenu, ProjectSelector and composerContextButtonClass shared by native and Web composers.
 * [POS]: The composer Project surface over copy.ts; hosts own catalogs, creation, errors and optional pagination.
 */
import { useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Folder, Loader2, Plus, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "@ai-chat/ui/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { useDelayed } from "@ai-chat/ui/hooks/use-delayed";
import { useCoarsePointer } from "@ai-chat/ui/hooks/use-mobile";
import type { ProjectSelectorCopy } from "./copy";

export const composerContextButtonClass =
  "h-8 rounded-full px-2 text-sm font-normal transition-colors hover:bg-muted-foreground/10";

type ProjectOption = { id: string; name: string; missing?: boolean };
export type ProjectMenuProps = {
  projects: readonly ProjectOption[];
  selectedProjectId: string | null;
  disabled?: boolean;
  copy: ProjectSelectorCopy;
  onChange(projectId: string | null): void;
  onNewProject?(): Promise<void>;
  side?: "top" | "bottom";
  status?: ReactNode;
  pagination?: ReactNode;
};

const actionClass = "h-8 w-full justify-start gap-3 rounded-lg px-2.5 text-sm font-normal max-md:h-11 pointer-coarse:h-11";
const actionKeys: ComponentProps<"div">["onKeyDown"] = event => {
  // Footer and paging buttons use their own activation, not cmdk's selected result.
  if (event.key === "Enter") event.stopPropagation();
};

export function ProjectMenu({
  projects, selectedProjectId, disabled = false, copy, onChange, onNewProject,
  side = "top", status, pagination, children,
}: ProjectMenuProps & { children: ReactNode | ((state: { creating: boolean }) => ReactNode) }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const touch = useCoarsePointer();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = projects.filter(project => !project.missing && project.name.toLocaleLowerCase().includes(normalizedQuery));
  const first = visibleProjects[0]?.id ?? "";
  const [anchor, setAnchor] = useState(first), [selected, setSelected] = useState(first);
  // Newly arrived or filtered results own Enter; appending results preserves arrow selection.
  if (first !== anchor) { setAnchor(first); setSelected(first); }

  if (disabled && open) { setOpen(false); setQuery(""); }

  const close = () => { setOpen(false); setQuery(""); };
  const select = (id: string | null) => {
    if (disabled || creating) return;
    onChange(id);
    close();
  };
  const createProject = async () => {
    if (!onNewProject || creating || disabled) return;
    close();
    setCreating(true);
    try { await onNewProject(); }
    catch { /* The host owns visible creation errors. */ }
    finally { setCreating(false); }
  };

  return <Popover open={open && !disabled && !creating} onOpenChange={next => {
    if (next && (disabled || creating)) return;
    setOpen(next);
    setQuery("");
    setSelected(first);
  }}>
    <PopoverTrigger ref={trigger} asChild disabled={disabled || creating}>
      {typeof children === "function" ? children({ creating }) : children}
    </PopoverTrigger>
    <PopoverContent side={side} align="start" sideOffset={10} collisionPadding={16}
      className="flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl p-0"
      aria-label={copy.selector}
      onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus({ preventScroll: true }); }}
      onOpenAutoFocus={event => { if (touch) { event.preventDefault(); (event.target as HTMLElement).focus(); } }}>
      <Command shouldFilter={false} loop value={selected} onValueChange={setSelected}
        className="min-h-0 rounded-xl p-0 [&_[data-slot=command-input-wrapper]]:shrink-0 [&_[data-slot=command-input-wrapper]]:p-1.5 [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:max-md:h-11! [&_[data-slot=input-group]]:pointer-coarse:h-11! dark:[&_[data-slot=input-group]]:bg-transparent">
        <CommandInput value={query} onValueChange={setQuery} aria-label={copy.search}
          data-slot="input-group-control" autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true"
          className="min-w-0 bg-transparent text-sm max-md:text-base pointer-coarse:text-base" placeholder={copy.search} />
        <CommandList className="min-h-0 max-h-52 px-1 pb-2">
          {visibleProjects.length === 0 && !status && <p className="py-5 text-center text-sm text-muted-foreground">{copy.empty}</p>}
          {visibleProjects.map(project => <CommandItem key={project.id} value={project.id}
            data-checked={selectedProjectId === project.id}
            className="min-h-8 rounded-lg px-2.5 py-1.5 text-sm max-md:min-h-11 pointer-coarse:min-h-11 data-[checked=true]:bg-transparent!"
            onSelect={() => select(project.id)}>
            <Folder className="size-4 text-muted-foreground" /><span className="truncate">{project.name}</span>
          </CommandItem>)}
          <div onKeyDown={actionKeys}>{status}{pagination}</div>
        </CommandList>
        <div onKeyDown={actionKeys} className="relative shrink-0 p-1 before:absolute before:top-0 before:right-3 before:left-3 before:border-t before:border-border">
          {onNewProject && <Button type="button" variant="ghost" className={actionClass}
            disabled={creating || disabled} onClick={() => void createProject()}>
            <Plus className="size-4" />{copy.create}
          </Button>}
          <Button type="button" variant="ghost" className={actionClass} aria-pressed={selectedProjectId === null}
            disabled={disabled || creating} onClick={() => select(null)}><X className="size-4" />{copy.workInChat}</Button>
        </div>
      </Command>
    </PopoverContent>
  </Popover>;
}

export function ProjectSelector({ selectedName, ...props }: ProjectMenuProps & { selectedName?: ReactNode }) {
  const name = selectedName ?? props.projects.find(project => project.id === props.selectedProjectId)?.name ?? props.copy.chat;
  return <ProjectMenu {...props}>{({ creating }) => <ProjectChip creating={creating} name={name} copy={props.copy} />}</ProjectMenu>;
}

function ProjectChip({ creating, name, copy, ...props }: {
  creating: boolean; name: ReactNode; copy: ProjectSelectorCopy;
} & Omit<ComponentProps<typeof Button>, "name">) {
  const pending = useDelayed(300, creating), id = useId();
  const label = pending ? copy.creating : name;
  return <Button type="button" size="lg" variant="ghost"
    className={`${composerContextButtonClass} max-w-56 gap-2 data-[state=open]:bg-muted-foreground/10 max-md:h-11 pointer-coarse:h-11`}
    aria-label={typeof label === "string" ? copy.current.replace("{{project}}", () => label) : undefined}
    aria-labelledby={typeof label === "string" ? undefined : id} aria-busy={pending || undefined} {...props}>
    {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Folder className="size-4" />}
    <span id={id} className="truncate">{label}</span>
  </Button>;
}
