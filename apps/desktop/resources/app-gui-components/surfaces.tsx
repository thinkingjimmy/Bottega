/**
 * [INPUT]: Depends on React and audited Base UI Separator/ScrollArea primitives
 * [OUTPUT]: Provides Card, Badge, Separator, Skeleton, Table, and ScrollArea source components
 * [POS]: shadcn Base UI snapshot surface and data-presentation layer
 */

import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

const cn = (...values: Array<string | undefined>) => values.filter(Boolean).join(" ");
const classes = <State,>(base: string, value: string | ((state: State) => string | undefined) | undefined) =>
  typeof value === "function" ? (state: State) => cn(base, value(state)) : cn(base, value);

export function Card(props: React.ComponentProps<"section">) {
  return <section {...props} className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950", props.className)} />;
}

export function Badge(props: React.ComponentProps<"span">) {
  return <span {...props} className={cn("inline-flex min-h-6 items-center rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200", props.className)} />;
}

export function Separator(props: React.ComponentProps<typeof SeparatorPrimitive>) {
  return <SeparatorPrimitive {...props} className={classes("h-px w-full bg-slate-200 dark:bg-slate-800", props.className)} />;
}

export function Skeleton(props: React.ComponentProps<"div">) {
  return <div {...props} aria-hidden="true" className={cn("animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none dark:bg-slate-800", props.className)} />;
}

export function Table(props: React.ComponentProps<"table">) {
  return <div className="max-w-full overflow-auto"><table {...props} className={cn("w-full border-collapse text-left text-sm", props.className)} /></div>;
}

export const ScrollArea = {
  ...ScrollAreaPrimitive,
  Root: (props: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) => <ScrollAreaPrimitive.Root {...props} className={classes("relative overflow-hidden", props.className)} />,
  Viewport: (props: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>) => <ScrollAreaPrimitive.Viewport {...props} className={classes("size-full overscroll-contain", props.className)} />,
  Scrollbar: (props: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) => <ScrollAreaPrimitive.Scrollbar {...props} className={classes("flex w-3 touch-none select-none p-0.5", props.className)} />,
  Thumb: (props: React.ComponentProps<typeof ScrollAreaPrimitive.Thumb>) => <ScrollAreaPrimitive.Thumb {...props} className={classes("flex-1 rounded-full bg-slate-400 dark:bg-slate-600", props.className)} />,
};
