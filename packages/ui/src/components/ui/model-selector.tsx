/**
 * [INPUT]: Depends on button props, shared skeleton/class utilities and optional host status icons.
 * [OUTPUT]: Provides ModelSelectorTrigger with identical pending, readonly, open and busy geometry.
 * [POS]: Shared model-control face; selection rules and catalog loading belong to hosts.
 */
import type { ComponentProps, ReactNode } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { Skeleton } from "./skeleton";
import { cn } from "../../lib/utils";
export function ModelSelectorTrigger({ model, effort, pending, loading, open, readOnly, icon, className, ...props }:
  ComponentProps<"button"> & { model: string; effort: string; pending?: boolean; loading?: boolean; open?: boolean; readOnly?: boolean; icon?: ReactNode }) {
  const face = <span className="flex min-w-0 items-center gap-1.5">{icon}{pending ? <><Skeleton className="h-3.5 w-16 rounded-full" /><Skeleton className="h-3.5 w-8 shrink-0 rounded-full" /></> : <><span className="truncate" data-model-label>{model}</span>{effort && <span className="shrink-0 text-muted-foreground" data-effort-label>{effort}</span>}</>}</span>;
  if (readOnly) return <span aria-label={props["aria-label"]} title={props.title} data-model-selector className={cn("flex h-8 min-w-0 items-center gap-1.5 rounded-full px-1.5 text-sm text-muted-foreground", className)}>{face}</span>;
  return <button type="button" data-model-selector aria-busy={pending} {...props} className={cn("flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-1.5 font-normal text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50", open ? "bg-muted hover:bg-muted/80" : "hover:bg-muted", className)}>{face}{loading ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}</button>;
}
