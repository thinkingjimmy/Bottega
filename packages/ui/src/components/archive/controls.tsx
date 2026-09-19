/**
 * [INPUT]: React callbacks, shared Button/Tooltip primitives and host action icons/copy.
 * [OUTPUT]: ArchiveSelectBox and ArchiveRowAction with touch sizing and accessible unavailable reasons.
 * [POS]: Archive interaction presentation without native purge or restore authority.
 */
import type { LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
// Keep the checkbox compact inside a touch-sized label; mixed state is a DOM property.
export function ArchiveSelectBox({
  label,
  showLabel = false,
  checked,
  indeterminate = false,
  disabled,
  onChange,
}: {
  label: string;
  showLabel?: boolean;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center",
        showLabel && "pr-2",
        disabled && "cursor-not-allowed",
      )}
    >
      <span className="flex size-11 shrink-0 touch-manipulation items-center justify-center">
        <input
          ref={(node) => {
            if (node) node.indeterminate = indeterminate;
          }}
          aria-label={label}
          type="checkbox"
          className="size-4 accent-foreground"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </span>
      {showLabel && (
        <span aria-hidden="true" className="text-muted-foreground text-xs">
          {label}
        </span>
      )}
    </label>
  );
}

// Unavailable actions stay focusable so keyboard users can discover the reason.
export function ArchiveRowAction({
  label,
  icon: Icon,
  destructive = false,
  disabled,
  unavailableReason,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  disabled: boolean;
  unavailableReason?: string;
  onClick?: () => void;
}) {
  const unavailable = Boolean(unavailableReason);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-disabled={unavailable || undefined}
          aria-description={unavailableReason}
          disabled={disabled}
          className={cn(
            "size-11 touch-manipulation text-muted-foreground",
            destructive && !unavailable && "hover:text-destructive",
            unavailable &&
              "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
          )}
          onClick={unavailable ? undefined : onClick}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{unavailableReason ?? label}</TooltipContent>
    </Tooltip>
  );
}
