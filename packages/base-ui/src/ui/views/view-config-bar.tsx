/**
 * [INPUT]: Depends on React, shadcn Select, SlimScroller, ui cn, tailwind classes, and the editors EMPTY_SELECT_VALUE sentinel
 * [OUTPUT]: Provides ViewConfigBar containers (one scrolling row below 40rem, wrapping above), the ViewConfigSelect control, and viewConfigHitAreaClass (28px visual / 44px hit area)
 * [POS]: Shared Base presentation in ui/views.
 */

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import { EMPTY_SELECT_VALUE } from "../editors/cells/base-cell-editor";

// Narrow containers keep the bar one row tall and scroll it sideways; wide ones wrap as before.
export function ViewConfigBar({ children }: { children: ReactNode }) {
  return (
    <div className="@container/view-config shrink-0 bg-background">
      <SlimScroller className="flex items-center gap-3 overflow-x-auto px-3 py-1.5 @[40rem]/view-config:flex-wrap @[40rem]/view-config:overflow-visible">
        {children}
      </SlimScroller>
    </div>
  );
}

export const viewConfigHitAreaClass = "relative touch-target-44";

export function ViewConfigSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; name: string }>;
  placeholder?: string;
  disabled?: boolean;
  onChange(id: string): void;
}) {
  const selected = value || EMPTY_SELECT_VALUE;
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
      <span>{label}</span>
      <Select
        disabled={disabled}
        onValueChange={(next) =>
          onChange(next === EMPTY_SELECT_VALUE ? "" : next)
        }
        value={selected}
      >
        <SelectTrigger
          aria-label={label}
          className={cn(
            viewConfigHitAreaClass,
            "h-7 min-w-24 bg-background px-2 text-foreground text-xs"
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {placeholder !== undefined && (
            <SelectItem value={EMPTY_SELECT_VALUE}>
              {placeholder}
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
