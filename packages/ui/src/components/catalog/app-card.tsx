/**
 * [INPUT]: Shared Card primitives, Radix Slot, theme utilities and host identity/action slots.
 * [OUTPUT]: AppCard and AppCardStatus with native catalog content, geometry and interaction states.
 * [POS]: Complete platform-independent App card; hosts supply facts and capabilities without rebuilding its layout.
 */
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Slot } from "radix-ui";
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/utils";

export function AppCard({
  name,
  icon = "📦",
  status,
  description,
  primaryAction,
  actions,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Card>, "title"> & {
  name: string;
  icon?: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  primaryAction: ReactElement;
  actions?: ReactNode;
}) {
  return (
    <Card
      data-app-card=""
      className={cn(
        "relative h-full cursor-pointer transition-colors hover:bg-accent/40 hover:ring-primary/40 active:bg-accent/60",
        className,
      )}
      {...props}
    >
      <Slot.Root
        data-slot="app-card-action"
        className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {primaryAction}
      </Slot.Root>
      <CardHeader className="pointer-events-none relative z-10 flex gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="mb-1 flex items-center gap-2">
            <span aria-hidden className="text-3xl">
              {icon}
            </span>
            {status}
          </div>
          <CardTitle
            title={name}
            className="truncate text-base transition-colors group-hover/card:text-primary"
          >
            {name}
          </CardTitle>
          {description && (
            <CardDescription className="line-clamp-2">
              {description}
            </CardDescription>
          )}
          {children}
        </div>
        {actions && (
          <div className="pointer-events-auto flex shrink-0 items-center gap-0.5">
            {actions}
          </div>
        )}
      </CardHeader>
    </Card>
  );
}

export function AppCardStatus({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warning" | "success" | "error";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px]",
        {
          neutral: "bg-muted text-muted-foreground",
          warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
          success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          error: "bg-destructive/10 text-destructive",
        }[tone],
      )}
    >
      {children}
    </span>
  );
}
