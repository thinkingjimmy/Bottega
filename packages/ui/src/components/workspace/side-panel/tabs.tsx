/**
 * [INPUT]: Host-projected tabs with optional title content, selection/close commands and localized labels.
 * [OUTPUT]: SidePanelTabs with roving keyboard navigation, visible inline actions and a close control that replaces the leading icon on hover, keyboard focus or touch.
 * [POS]: Shared tablist; hosts retain ownership of tab identities and close succession.
 */
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { XIcon } from "lucide-react";
import { cn } from "../../../lib/utils";
export type SidePanelTab = {
  key: string; label: string; icon: ReactNode; selected: boolean; panelId: string;
  labelContent?: ReactNode; widthClass?: string; closeLabel?: string; hint?: string; dim?: boolean; actions?: ReactNode;
  select(): void;
  /** Omitted by a tablist whose tabs are a fixed set — a computer is not something the viewer closes. */
  close?(): void;
};
export const tabActionClass = "relative touch-target-44 cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:p-1.5 disabled:pointer-events-none";
export const tabShellClass = (active: boolean) => cn("group/tab-chrome flex max-w-40 cursor-pointer items-center rounded-md pr-1 pl-2 text-xs transition-colors", active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50");
export function SidePanelTabs({ items, label, closeLabel, onClose, refs, className }: { items: SidePanelTab[]; label: string; closeLabel?: string; onClose?(index: number): void; refs?: RefObject<Map<string, HTMLDivElement>>; className?: string }) {
  const localRefs = useRef(new Map<string, HTMLDivElement>()), tabRefs = refs ?? localRefs;
  const rovingKey = (items.find(item => item.selected) ?? items[0])?.key;
  const closeAt = (index: number) => {
    if (onClose) return onClose(index);
    const item = items[index]!;
    item.close?.();
    if (item.selected) {
      const next = items[index + 1] ?? items[index - 1];
      next?.select();
      if (next) tabRefs.current.get(next.key)?.focus();
    }
  };
  const onTabKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    index: number
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      items[index]!.select();
      return;
    }
    const targetIndex =
      event.key === "ArrowRight"
        ? (index + 1) % items.length
        : event.key === "ArrowLeft"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    const target = items[targetIndex]!;
    target.select();
    tabRefs.current.get(target.key)?.focus();
  };

  return (
          <div
            aria-label={label}
            className={cn("flex min-w-0 items-center gap-1 overflow-x-auto", className)}
            role="tablist"
          >
            {items.map((item, index) => (
              <div
                aria-controls={item.panelId}
                aria-selected={item.selected}
                className={cn(
                  tabShellClass(item.selected),
                  "h-7 shrink-0 gap-1.5",
                  item.dim && "opacity-60",
                  item.widthClass
                )}
                id={`panel-tab-${item.key}-trigger`}
                key={item.key}
                onClick={item.select}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                ref={(node) => {
                  if (node) tabRefs.current.set(item.key, node);
                  return () => {
                    tabRefs.current.delete(item.key);
                  };
                }}
                role="tab"
                tabIndex={item.key === rovingKey ? 0 : -1}
                title={item.hint}
              >
                {(item.close ?? onClose) ? (
                  <span className="relative grid size-4 shrink-0 place-items-center pointer-coarse:w-11">
                    <button
                      aria-label={item.closeLabel}
                      className={cn(
                        tabActionClass,
                        "peer pointer-events-none absolute inset-0 z-10 grid place-items-center p-0 opacity-0 transition-opacity pointer-coarse:p-0",
                        "group-hover/tab-chrome:pointer-events-auto group-hover/tab-chrome:opacity-100",
                        "focus-visible:pointer-events-auto focus-visible:opacity-100 no-hover:pointer-events-auto no-hover:opacity-100"
                      )}
                      data-slot="side-panel-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeAt(index);
                      }}
                      title={closeLabel}
                      type="button"
                    >
                      <XIcon className="size-3" />
                    </button>
                    <span aria-hidden className="transition-opacity group-hover/tab-chrome:opacity-0 peer-focus-visible:opacity-0 no-hover:opacity-0">{item.icon}</span>
                  </span>
                ) : item.icon}
                <span className="truncate">{item.labelContent ?? item.label}</span>
                {item.actions}
              </div>
            ))}
          </div>
  );
}
