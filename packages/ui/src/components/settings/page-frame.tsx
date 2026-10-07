/**
 * [INPUT]: React context, shared scrolling/feedback primitives and class-name utilities.
 * [OUTPUT]: SettingsPage and SettingsCanvas with inherited width, wrapping canvas or persistent page headings, trailing page actions, section headers and alerts.
 * [POS]: Platform-independent settings presentation.
 */

import { createContext, useContext, type ReactNode } from "react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { toastClearanceRef } from "@ai-chat/ui/components/ui/sonner";
import { cn } from "@ai-chat/ui/lib/utils";

type SettingsPageLayout = {
  title?: ReactNode;
  titleAdornment?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  rail?: ReactNode;
  width?: "content" | "full";
  headingPlacement?: "canvas" | "page";
};
const SettingsPageContext = createContext<SettingsPageLayout | null>(null);

export function SettingsPage({ title, titleAdornment, leading, actions, rail, width = "content", headingPlacement = "canvas", children, chrome = "browser", collapsedInset }: SettingsPageLayout & {
  children: ReactNode;
  chrome?: "browser" | "native";
  collapsedInset?: "compact" | "mac";
}) {
  return <SettingsPageContext value={{ title, titleAdornment, leading, actions, rail, width, headingPlacement }}>
    <div data-settings-page="" className="relative flex h-full min-h-0 flex-col [--page-shell-header-height:0px]">
      {chrome === "native" && <div aria-hidden className={cn("absolute inset-x-0 top-0 h-6 [-webkit-app-region:drag]", collapsedInset && "h-10")}>
        {collapsedInset && <span className={cn("absolute inset-y-0 left-0 [-webkit-app-region:no-drag]", collapsedInset === "mac" ? "w-32" : "w-12")} />}
      </div>}
      {collapsedInset && <div aria-hidden className="h-10 shrink-0" />}
      {headingPlacement === "page" && <SettingsHeading className={cn("mx-auto mb-0 w-full px-6 pt-6 pb-8 max-sm:px-4", width === "content" && "max-w-4xl")} />}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  </SettingsPageContext>;
}

function SettingsHeading({ className }: { className?: string }) {
  const page = useContext(SettingsPageContext);
  if (!page?.title) return null;
  return <header ref={toastClearanceRef} data-toast-clearance="" data-settings-heading="" className={cn("mb-8 shrink-0 [-webkit-app-region:no-drag]", className)}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
        {page.leading}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 wrap-anywhere text-balance font-heading text-2xl font-semibold leading-8 tracking-tight">{page.title}</h1>
          {page.titleAdornment}
        </div>
      </div>
      <div data-settings-actions="" className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2.5">{page.actions}</div>
    </div>
    {page.rail && <div className="-mx-3 mt-4">{page.rail}</div>}
  </header>;
}

export function SettingsCanvas({
  fill,
  children,
}: {

  fill?: boolean;
  children: ReactNode;
}) {
  const page = useContext(SettingsPageContext);
  const canvasClassName = cn("@container mx-auto w-full min-w-0", page?.width !== "full" && "max-w-4xl");
  const pageHeading = page?.headingPlacement === "page";

  if (fill) {
    return (
      <div className={cn(canvasClassName, "flex h-full flex-col p-6 max-sm:px-4", pageHeading && "pt-0")}>
        {!pageHeading && <SettingsHeading />}
        <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">{children}</div>
      </div>
    );
  }
  return (
    <SlimScroller className="h-full overflow-y-auto">
      <div className={cn(canvasClassName, "px-6 pt-6 pb-12 max-sm:px-4", pageHeading && "pt-0")}>
        {!pageHeading && <SettingsHeading />}
        {children}
      </div>
    </SlimScroller>
  );
}

export function SettingsSection({
  title,
  description,
  action,
  alert,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  alert?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `settings-${title.replace(/\s+/g, "-")}`;
  return (

    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="space-y-1">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id={titleId} className="min-w-0 font-heading font-semibold text-sm">
            {title}
          </h2>
          {action}
        </div>
        {description && (
          <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {alert && <SettingsAlert>{alert}</SettingsAlert>}
      {children}
    </section>
  );
}

export function SettingsAlert({
  children,
  tone = "danger",
}: {
  children: ReactNode;

  tone?: "danger" | "warn";
}) {
  return (
    <p
      role="alert"
      className={cn(
        "rounded-md px-3 py-2 text-xs ring-1",
        tone === "warn"
          ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
          : "bg-destructive/10 text-destructive ring-destructive/20"
      )}
    >
      {children}
    </p>
  );
}
