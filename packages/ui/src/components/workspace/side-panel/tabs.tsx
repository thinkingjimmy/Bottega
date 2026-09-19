/**
 * [INPUT]: Host-projected tabs, selection/close commands and localized labels.
 * [OUTPUT]: SidePanelTabs with roving keyboard navigation and shared tab chrome.
 * [POS]: Shared tablist; hosts retain ownership of tab identities and close succession.
 */
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { XIcon } from "lucide-react";
import { cn } from "../../../lib/utils";
export type SidePanelTab = {
  key: string; label: string; icon: ReactNode; selected: boolean; panelId: string;
  widthClass?: string; closeLabel: string; hint?: string; dim?: boolean; actions?: ReactNode;
  select(): void; close(): void;
};
export const tabActionClass = "relative touch-target-44 cursor-pointer rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/tab-chrome:opacity-100 data-[state=open]:opacity-100 no-hover:opacity-100 pointer-coarse:p-1.5 disabled:pointer-events-none";
export const tabShellClass = (active: boolean) => cn("group/tab-chrome flex max-w-40 cursor-pointer items-center rounded-md pr-1 pl-2 text-xs transition-colors", active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50");
export function SidePanelTabs({ items, label, closeLabel, onClose, refs }: { items: SidePanelTab[]; label: string; closeLabel: string; onClose?(index: number): void; refs?: RefObject<Map<string, HTMLDivElement>> }) {
  const localRefs = useRef(new Map<string, HTMLDivElement>()), tabRefs = refs ?? localRefs;
  const rovingKey = (items.find(item => item.selected) ?? items[0])?.key;
  const closeAt = (index: number) => {
    if (onClose) return onClose(index);
    const item = items[index]!;
    item.close();
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
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
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
                {item.icon}
                <span className="truncate">{item.label}</span>
                {item.actions}
                <button
                  aria-label={item.closeLabel}
                  className={tabActionClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeAt(index);
                  }}
                  title={closeLabel}
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
  );
}
