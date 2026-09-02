/**
 * [INPUT]: Depends on React, shared Project, Chat composer i18n, UI Popover/Command/Button and lucide Folder/Plus/X
 * [OUTPUT]: Provides a localized reusable ChatProjectMenu, compact ChatProjectSelector, and composerContextButtonClass
 * [POS]: Canonical Project menu shared by composer and empty-chat entry points; branch interaction remains in ChatBranchSelector
 */

import { useState, type ReactNode } from "react";
import { Folder, Plus, X } from "lucide-react";
import type { Project } from "../../../../shared/projects-ipc";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ai-chat/ui/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export const composerContextButtonClass =
  "h-8 rounded-full px-2 text-sm font-normal transition-colors hover:bg-muted-foreground/10";

type ProjectMenuProps = {
  projects: Project[];
  selectedProjectId: string | null;
  disabled: boolean;
  onChange: (projectId: string | null) => void;
  onNewProject: () => Promise<void>;
  /* 展开方向跟着触发器所处的位置走：贴着输入框的 chip 只能向上，
     句子中间的项目名向上会盖住自己的上文，故各自明说。 */
  side?: "top" | "bottom";
};

/* 菜单只拥有「选哪个 Project」这件事，长什么样交给调用方：触发器作为
   children 经 asChild 就地接管，开合与禁用（含新建过程中的忙）由这里统一
   下发——两个入口因此不可能对同一份状态给出两种说法。 */
export function ChatProjectMenu({
  projects,
  selectedProjectId,
  disabled,
  onChange,
  onNewProject,
  side = "top",
  children,
}: ProjectMenuProps & { children: ReactNode }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = projects.filter(
    (project) =>
      !project.missing &&
      project.name.toLocaleLowerCase().includes(normalizedQuery)
  );

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const select = (projectId: string | null) => {
    onChange(projectId);
    close();
  };

  const createProject = async () => {
    if (creating) return;
    close();
    setCreating(true);
    try {
      await onNewProject();
    } catch {
      // ProjectsProvider 已记录可见 warning；此处只阻止事件 Promise 泄漏。
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && (disabled || creating)) return;
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild disabled={disabled || creating}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={10}
        avoidCollisions={false}
        className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0"
        aria-label={t("chat.composer.project.selector")}
      >
        <Command
          shouldFilter={false}
          loop
          className="rounded-xl p-0 [&_[data-slot=command-input-wrapper]]:p-1.5 [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none dark:[&_[data-slot=input-group]]:bg-transparent"
        >
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            className="text-sm"
            placeholder={t("chat.composer.project.search")}
          />
          <CommandList className="max-h-52 px-1 pb-2">
            {visibleProjects.length === 0 ? (
              <p className="py-5 text-center text-muted-foreground text-sm">
                {t("chat.composer.project.empty")}
              </p>
            ) : (
              visibleProjects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={project.id}
                  data-checked={selectedProjectId === project.id}
                  className="min-h-8 rounded-lg px-2.5 py-1.5 text-sm data-[checked=true]:bg-transparent!"
                  onSelect={() => select(project.id)}
                >
                  <Folder className="size-4 text-muted-foreground" />
                  <span className="truncate">{project.name}</span>
                </CommandItem>
              ))
            )}
          </CommandList>
          <div className="relative p-1 before:absolute before:top-0 before:right-3 before:left-3 before:border-border before:border-t">
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start gap-3 rounded-lg px-2.5 text-sm font-normal"
              disabled={creating}
              onClick={() => void createProject()}
            >
              <Plus className="size-4" />
              {t("chat.composer.project.create")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start gap-3 rounded-lg px-2.5 text-sm font-normal"
              aria-pressed={selectedProjectId === null}
              onClick={() => select(null)}
            >
              <X className="size-4" />
              {t("chat.composer.project.workInChat")}
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ChatProjectSelector(props: ProjectMenuProps) {
  const { t } = useAppTranslation();
  const selected = props.projects.find(
    (project) => project.id === props.selectedProjectId
  );
  const selectedName = selected?.name ?? t("chat.composer.project.chat");
  return (
    <ChatProjectMenu {...props}>
      <Button
        type="button"
        size="lg"
        variant="ghost"
        className={`${composerContextButtonClass} max-w-56 gap-2 data-[state=open]:bg-muted-foreground/10`}
        aria-label={t("chat.composer.project.current", {
          project: selectedName,
        })}
      >
        <Folder className="size-4" />
        <span className="truncate">{selectedName}</span>
      </Button>
    </ChatProjectMenu>
  );
}
