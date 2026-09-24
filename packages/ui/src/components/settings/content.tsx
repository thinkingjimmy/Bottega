/**
 * [INPUT]: React and shared UI primitives.
 * [OUTPUT]: Shared settings content components with wrapping rows and touch-sized selectors.
 * [POS]: Platform-independent settings presentation.
 */

import type { ComponentProps, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";

export function SettingsSurface({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SettingsList({ className, ...props }: ComponentProps<"div">) {
  return (
    <SettingsSurface
      {...props}
      className={cn("divide-inset", className)}
    />
  );
}

export function SettingsRow({
  leading,
  label,
  htmlFor,
  badge,
  description,
  control,
  tone = "default",
}: {
  leading?: ReactNode;
  label: string;

  htmlFor?: string;
  badge?: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  tone?: "default" | "destructive";
}) {
  const labelClassName = cn(
    "font-medium text-[13px] leading-5",
    tone === "destructive" && "text-destructive"
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
      {leading}
      <div className="min-w-0 flex-1 basis-32">
        <div className="flex items-center gap-2">
          {htmlFor ? (
            <label htmlFor={htmlFor} className={labelClassName}>
              {label}
            </label>
          ) : (
            <span className={labelClassName}>{label}</span>
          )}
          {badge}
        </div>
        {description && (
          <p
            id={htmlFor ? `${htmlFor}-description` : undefined}
            className={cn(
              "mt-0.5 wrap-anywhere text-xs leading-normal",
              tone === "destructive" ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0 max-md:[&_[data-slot=select-trigger]]:min-h-11 pointer-coarse:[&_[data-slot=select-trigger]]:min-h-11">{control}</div>
    </div>
  );
}

export function SettingsBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warn" | "danger" | "muted";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-medium text-xs",
        tone === "warn"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : tone === "danger"
            ? "bg-destructive/10 text-destructive"
            : tone === "muted"
              ? "bg-muted text-muted-foreground"
              : "bg-muted text-foreground"
      )}
    >
      {children}
    </span>
  );
}

export function SettingsLinkRow({
  label,
  description,
  onSelect,
}: {
  label: string;
  description?: ReactNode;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}

      className="flex w-full cursor-pointer touch-manipulation items-center justify-between gap-6 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset motion-reduce:transition-none"
    >
      <span className="min-w-0">
        <span className="block font-medium text-[13px] leading-5">{label}</span>
        {description && (
          <span className="mt-0.5 block text-muted-foreground text-xs leading-normal">
            {description}
          </span>
        )}
      </span>
      <ArrowUpRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

export function SettingsNoteList({
  items,
}: {
  items: ReadonlyArray<{ term: string; detail: ReactNode; icon?: ReactNode }>;
}) {
  if (items.some((item) => item.icon)) {
    return (
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.term} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-px flex shrink-0 text-muted-foreground [&_svg]:size-[15px]"
            >
              {item.icon}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-xs">{item.term}</p>
              <p className="mt-0.5 text-muted-foreground text-xs leading-normal">
                {item.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="list-disc space-y-3 pl-4 marker:text-muted-foreground/50">
      {items.map((item) => (
        <li key={item.term}>
          <p className="font-medium text-xs">{item.term}</p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            {item.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function SettingsEmpty({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-8 text-center">
      <span
        aria-hidden="true"
        className="[&>svg]:mx-auto [&>svg]:size-6 [&>svg]:text-muted-foreground/60"
      >
        {icon}
      </span>
      <p className="mt-2.5 font-medium text-sm">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-xs leading-relaxed">
        {hint}
      </p>
    </div>
  );
}
