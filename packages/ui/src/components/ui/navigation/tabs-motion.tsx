/**
 * [INPUT]: React layout/lifecycle hooks, ResizeObserver, shared Tabs primitives and class-name utilities.
 * [OUTPUT]: AnimatedTabsList with a sliding horizontal indicator and RetainedTabsContent with lazy first mounting and preserved state.
 * [POS]: Opt-in tab presentation; callers own selection and key the panel lifetime to its resource identity.
 */
import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@ai-chat/ui/lib/utils";
import { TabsContent, TabsList } from "./tabs";

export function AnimatedTabsList({ value, children, className, ...props }: Omit<ComponentProps<typeof TabsList>, "variant" | "ref"> & { value: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current, indicator = indicatorRef.current;
    if (!list || !indicator) return;
    const update = () => {
      const active = list.querySelector<HTMLElement>(':scope > [role="tab"][aria-selected="true"]');
      indicator.hidden = !active;
      if (!active) return;
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    for (const tab of list.querySelectorAll('[role="tab"]')) observer.observe(tab);
    return () => observer.disconnect();
  }, [value, children]);
  return <TabsList {...props} ref={listRef} variant="line" className={cn("relative [&>[role=tab]]:after:hidden motion-reduce:[&>[role=tab]]:transition-none", className)}>
    {children}
    <span ref={indicatorRef} aria-hidden data-tabs-indicator="" className="pointer-events-none absolute -bottom-px left-0 h-0.5 bg-foreground transition-[transform,width] duration-200 ease-out motion-reduce:transition-none" />
  </TabsList>;
}

export function RetainedTabsContent({ active, children, className, ...props }: Omit<ComponentProps<typeof TabsContent>, "forceMount" | "hidden" | "inert"> & { active: boolean }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return <TabsContent {...props} forceMount hidden={!active} inert={!active}
    className={cn("motion-safe:data-[state=active]:animate-in motion-safe:data-[state=active]:slide-in-from-bottom-1 duration-150 ease-out motion-reduce:animate-none", !active && "hidden", className)}>
    {(active || visited) && children}
  </TabsContent>;
}
