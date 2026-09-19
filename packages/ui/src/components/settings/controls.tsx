/**
 * [INPUT]: React and shared UI primitives.
 * [OUTPUT]: Shared settings controls components.
 * [POS]: Platform-independent settings presentation.
 */

import {
  useId,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";

export function SettingsDisclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group -mx-2 flex min-h-11 touch-manipulation cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SettingsButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size">) {
  return (
    <Button
      type="button"
      {...props}
      className={cn("h-8 px-3", className)}
      size="lg"
    />
  );
}

function namedIcon(label: string, button: ReactNode) {
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function SettingsIconButton({
  label,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "aria-label" | "title"> & {

  label: string;
}) {
  return namedIcon(
    label,
    <Button
      type="button"
      variant="outline"
      {...props}
      aria-label={label}
      size="lg"
      className={cn(
        "relative size-8 touch-manipulation px-0 touch-target-44 [--touch-target-inset:-4px]",
        className
      )}
    />
  );
}

export function SettingsLabelAction({
  label,
  className,
  ...props
}: Omit<
  ComponentProps<typeof Button>,
  "size" | "variant" | "aria-label" | "title"
> & {

  label: string;
}) {
  return namedIcon(
    label,
    <Button
      type="button"
      variant="ghost"
      {...props}
      aria-label={label}
      size="lg"
      className={cn(

        "-ml-1 relative size-8 touch-manipulation px-0 text-muted-foreground",
        "touch-target-44 [--touch-target-inset:-6px]",
        "hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent",
        "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground [@media(hover:hover)_and_(pointer:fine)]:dark:hover:bg-muted/50",
        className
      )}
    />
  );
}

export function SettingsSwitch({
  id,
  label,
  checked,
  disabled,
  describedBy,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className="flex size-11 touch-manipulation cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => onToggle(!checked)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors motion-reduce:transition-none",
          checked ? "bg-foreground" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </span>
    </button>
  );
}

export function SettingsChoiceRow({
  label,
  labelMeta,
  labelAction,
  description,
  checked,
  disabled,
  onSelect,
  trailing,
  nested,
  children,
  disclosure,
}: {
  label: string;

  labelMeta?: ReactNode;

  labelAction?: ReactNode;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onSelect(): void;

  trailing?: ReactNode;

  nested?: boolean;

  children?: ReactNode;

  disclosure?: {
    open: boolean;

    label: string;

    disabled?: boolean;
    onToggle(): void;
  };
}) {
  const labelId = useId();
  const descriptionId = useId();
  const moveWithArrow = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !backward) return;
    event.preventDefault();
    const group = event.currentTarget.closest('[role="radiogroup"]');
    const options = Array.from(
      group?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]:not(:disabled)'
      ) ?? []
    );
    const index = options.indexOf(event.currentTarget);
    if (index < 0 || options.length === 0) return;
    const next =
      options[(index + (forward ? 1 : options.length - 1)) % options.length];
    next?.focus();
    next?.click();
  };
  const indicator = (
    <span
      aria-hidden="true"
      className={cn(

        "mt-px grid size-[18px] shrink-0 place-items-center rounded-full ring-inset transition-shadow motion-reduce:transition-none",
        checked
          ? "ring-[1.5px] ring-foreground"
          : "ring-[1.5px] ring-muted-foreground/40"
      )}
    >
      <span
        className={cn(
          "size-[9px] rounded-full bg-foreground transition-transform motion-reduce:transition-none",
          checked ? "scale-100" : "scale-0"
        )}
      />
    </span>
  );
  const content = (
    <span className="min-w-0 flex-1">
      <span
        data-settings-choice-heading=""
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      >
        <span id={labelId} className="font-medium text-sm">
          {label}
        </span>
        {labelMeta}
        {labelAction && (

          <span className="pointer-events-auto relative z-20 inline-flex h-5 items-center">
            {labelAction}
          </span>
        )}
      </span>
      {description && (
        <span
          id={descriptionId}
          className="mt-1 block text-muted-foreground text-xs leading-relaxed"
        >
          {description}
        </span>
      )}
    </span>
  );
  const radioProps = {
    type: "button" as const,
    role: "radio" as const,
    "aria-checked": checked,
    "aria-labelledby": labelId,
    "aria-describedby": description ? descriptionId : undefined,
    disabled,
    tabIndex: checked ? 0 : -1,
    onClick: onSelect,
    onKeyDown: moveWithArrow,
  };
  const rowClasses = cn(
    "flex min-h-11 w-full cursor-pointer touch-manipulation items-start gap-3 py-3 text-left outline-none",
    disclosure ? "pr-3" : "pr-4",
    nested ? "pl-8" : "pl-4"
  );

  const fillProps = disclosure
    ? {
        type: "button" as const,
        "aria-expanded": disclosure.open,
        "aria-label": disclosure.label,
        disabled: disclosure.disabled,
        onClick: disclosure.onToggle,
      }
    : radioProps;
  const row = (
    <div
      className={cn(
        "relative",
        rowClasses,

        !disclosure && disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <button
        {...fillProps}
        className="absolute inset-0 z-0 cursor-pointer touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset disabled:cursor-not-allowed"
      />
      <span className="pointer-events-none relative z-10 contents">
        {disclosure ? (
          <button
            {...radioProps}
            className={cn(
              "pointer-events-auto relative flex shrink-0 cursor-pointer touch-manipulation items-start rounded-full outline-none",

              "after:-translate-x-1/2 after:-translate-y-1/2 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:content-['']",
              "focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            {indicator}
          </button>
        ) : (
          indicator
        )}
        {content}
          {trailing && (
          <span className="flex h-5 shrink-0 items-center">{trailing}</span>
        )}
        {disclosure && (
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              disclosure.open && "rotate-90",
              disclosure.disabled && "opacity-40"
            )}
          />
        )}
      </span>
    </div>
  );
  if (!children) return row;

  return (
    <div>
      {row}
      <div className={cn("pr-4 pb-3", nested ? "pl-[3.875rem]" : "pl-[2.875rem]")}>
        {children}
      </div>
    </div>
  );
}
