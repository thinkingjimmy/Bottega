/**
 * [INPUT]: React content slots, shared Card/Skeleton/Scroller primitives and the catalog icon.
 * [OUTPUT]: AppCatalogBody, AppCatalogGrid, AppCatalogSkeleton and AppCatalogEmpty (a left-aligned title, lead and optional hint line above its examples; the warning state stays a centred notice).
 * [POS]: Native and browser Apps page content; loading, empty and settled states share one layout.
 */
import type { ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { Card, CardHeader } from "../ui/layout/card";
import { Skeleton } from "../ui/feedback/skeleton";
import { SlimScroller } from "../ui/layout/slim-scroller";

export function AppCatalogBody({ children }: { children: ReactNode }) {
  return (
    <SlimScroller
      data-app-catalog=""
      className="h-full overflow-y-auto overscroll-contain p-4"
    >
      {children}
    </SlimScroller>
  );
}

export function AppCatalogGrid({ children }: { children: ReactNode }) {
  return (
    <div
      data-apps-grid=""
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {children}
    </div>
  );
}

export function AppCatalogSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" data-apps-grid-skeleton="" role="status">
      <span className="sr-only">{label}</span>
      <AppCatalogGrid>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Card className="h-full" key={index} aria-hidden>
            <CardHeader className="flex gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="mb-1 flex items-center gap-2">
                  <Skeleton className="size-8 motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-16 rounded-full motion-reduce:animate-none" />
                </div>
                <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-full motion-reduce:animate-none" />
                <Skeleton className="h-3 w-3/5 motion-reduce:animate-none" />
              </div>
            </CardHeader>
          </Card>
        ))}
      </AppCatalogGrid>
    </div>
  );
}

export function AppCatalogEmpty({
  title,
  description,
  warning,
  hint,
  children,
}: {
  title: string;
  description?: string;
  warning?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-col">
      {warning ? (
        <div
          role="alert"
          className="my-auto rounded-2xl border border-amber-500/40 border-dashed bg-amber-500/5 px-6 py-10 text-center"
        >
          <LayoutGrid
            aria-hidden
            className="mx-auto size-8 text-muted-foreground"
          />
          <h2 className="mt-2 font-medium text-sm">{title}</h2>
          {description && (
            <p className="mt-1 text-muted-foreground text-xs">{description}</p>
          )}
          <div className="mt-3 text-muted-foreground text-xs">{warning}</div>
        </div>
      ) : (
        /* A quiet, left-aligned start that lines up with the example grid below it, instead of a centred
           hero floating above a left-aligned grid. The page header already carries the add action. */
        <section className="w-full max-w-5xl pt-2 pb-10">
          <h2 className="font-heading font-semibold text-[15px]">{title}</h2>
          {description && (
            <p className="mt-1 max-w-prose text-pretty text-muted-foreground text-sm">
              {description}
            </p>
          )}
          {hint && <p className="mt-6 mb-3 text-muted-foreground text-xs">{hint}</p>}
          {children && <div className={hint ? undefined : "mt-6"}>{children}</div>}
        </section>
      )}
    </div>
  );
}
