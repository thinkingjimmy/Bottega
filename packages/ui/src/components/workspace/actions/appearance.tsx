/**
 * [INPUT]: Canonical Project appearance IDs, controlled commit callbacks and localized copy.
 * [OUTPUT]: ProjectAppearancePicker and ProjectAppearancePanel with draft-until-Done editing.
 * [POS]: Shared sidebar/settings identity editor for native and browser hosts.
 */



import { useState } from "react";
import type { projectActionCopy } from "./project-copy";
type AppearanceCopy = ReturnType<typeof projectActionCopy>["appearance"];
type ProjectAppearance = { color: string; icon: string };
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  normalizeProjectAppearance,
  resolveProjectColor,
  resolveProjectGlyph,
} from "../navigation/appearance";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import { usePointerOpenedMenu } from "@ai-chat/ui/hooks/use-pointer-opened-menu";
import { cn } from "@ai-chat/ui/lib/utils";


const triggerClass =
  "flex size-6 cursor-pointer items-center justify-center rounded-[calc(var(--radius-sm)-2px)] text-sidebar-foreground ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-foreground/10 focus-visible:ring-2 aria-expanded:bg-sidebar-foreground/10 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:[stroke-width:1.5]";


const gridClass = "grid grid-cols-6 gap-1";
const cellClass =
  "flex size-8 max-md:size-11 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30";

export function ProjectAppearancePicker({
  appearance,
  className,
  dimmed,
  expanded,
  onCommit,
  projectName,
  readOnly = false,
  copy,
}: {
  appearance: ProjectAppearance | undefined;
  className?: string;
  dimmed?: boolean;
  expanded: boolean;
  onCommit: (appearance: ProjectAppearance) => void;
  projectName: string;
  readOnly?: boolean;
  copy: AppearanceCopy;
}) {
  const [open, setOpen] = useState(false);
  const menu = usePointerOpenedMenu();
  const glyph = resolveProjectGlyph(appearance?.icon, expanded);

  if (readOnly) return <span aria-hidden className={cn("flex size-6 items-center justify-center [&>svg]:size-4", className)}><glyph.Icon className={resolveProjectColor(appearance?.color).text} /></span>;

  return (
    <Popover
      onOpenChange={setOpen}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={copy.trigger.replaceAll("{{name}}", projectName)}
          className={cn(triggerClass, dimmed && "opacity-65", className)}
          type="button"
          {...menu.triggerProps}
        >
          <glyph.Icon className={resolveProjectColor(appearance?.color).text} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-max"
        onCloseAutoFocus={menu.onCloseAutoFocus}
        side="bottom"
      >
        <ProjectAppearancePanel
          appearance={appearance}
          copy={copy}
          onCommit={onCommit}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ProjectAppearancePanel({
  appearance,
  onCommit,
  onDone,
  copy,
}: {
  appearance: ProjectAppearance | undefined;
  onCommit: (appearance: ProjectAppearance) => void;
  onDone: () => void;
  copy: AppearanceCopy;
}) {
  const [draft, setDraft] = useState(() => normalizeProjectAppearance(appearance));
  const draftTint = resolveProjectColor(draft.color).text;
  const done = () => {
    const current = normalizeProjectAppearance(appearance);
    if (draft.color !== current.color || draft.icon !== current.icon) {
      onCommit(draft);
    }
    onDone();
  };
  return (
    <>
      <div
        aria-label={copy.colorGroup}
        className={gridClass}
        role="group"
      >
        {PROJECT_COLORS.map((color) => (
          <button
            aria-label={copy.color[color.id as keyof AppearanceCopy["color"]]}
            aria-pressed={draft.color === color.id}
            className={cellClass}
            key={color.id}
            onClick={() => setDraft((current) => ({ ...current, color: color.id }))}
            title={copy.color[color.id as keyof AppearanceCopy["color"]]}
            type="button"
          >
            <span
              className={cn(
                "size-6 rounded-full",
                color.swatch,
                draft.color === color.id &&
                  "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
              )}
            />
          </button>
        ))}
      </div>

      <div className="my-3 border-t" />

      <div
        aria-label={copy.iconGroup}
        className={cn(gridClass, draftTint)}
        role="group"
      >
        {PROJECT_ICONS.map((icon) => (
          <button
            aria-label={copy.icon[icon.id as keyof AppearanceCopy["icon"]]}
            aria-pressed={draft.icon === icon.id}
            className={cn(
              cellClass,
              draft.icon === icon.id ? "bg-muted" : "hover:bg-muted/60"
            )}
            key={icon.id}
            onClick={() => setDraft((current) => ({ ...current, icon: icon.id }))}
            title={copy.icon[icon.id as keyof AppearanceCopy["icon"]]}
            type="button"
          >
            <icon.Icon className="size-[1.125rem] [stroke-width:1.5]" />
          </button>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <Button onClick={done} size="lg" type="button" variant="secondary">
          {copy.done}
        </Button>
      </div>
    </>
  );
}
