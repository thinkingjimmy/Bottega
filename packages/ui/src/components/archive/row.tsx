/**
 * [INPUT]: React host slots, Radix Slot and shared theme utilities.
 * [OUTPUT]: ArchiveRow, archiveRowId and formatArchivedAt.
 * [POS]: Common native/mirror/Web archive identity, date and responsive row geometry.
 */
import {
  cloneElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { Slot } from "radix-ui";
import { cn } from "../../lib/utils";

export const archiveRowId = (key: string) =>
  `archive-target-${key.replaceAll(":", "-")}`;
export const formatArchivedAt = (value: number, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

export function ArchiveRow({
  title,
  titleDetail,
  icon,
  iconLabel,
  date,
  leading,
  actions,
  primaryAction,
  targeted = false,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title" | "children"> & {
  title: string;
  titleDetail?: ReactNode;
  icon: ReactNode;
  iconLabel: string;
  date: string;
  leading?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactElement;
  targeted?: boolean;
}) {
  const name = (
    <>
      {title}
      {titleDetail && (
        <span aria-hidden className="font-normal text-muted-foreground">
          {" · "}
          {titleDetail}
        </span>
      )}
    </>
  );
  const titleClass = "min-w-0 flex-1 truncate font-medium text-sm";
  return (
    <div
      tabIndex={-1}
      data-testid="archive-row"
      data-search-targeted={targeted}
      className={cn(
        "flex min-h-11 items-center gap-2 pr-2 pl-3 transition-colors hover:bg-muted/50 focus-visible:outline-none motion-reduce:transition-none",
        leading && "pl-1",
        targeted && "bg-accent ring-2 ring-inset ring-ring",
        className,
      )}
      {...props}
    >
      {leading}
      <span
        role="img"
        aria-label={iconLabel}
        className="flex shrink-0 items-center text-muted-foreground [&>svg]:size-4"
      >
        {icon}
      </span>
      <div className="contents @max-sm:flex @max-sm:min-w-0 @max-sm:flex-1 @max-sm:flex-col @max-sm:py-2">
        {primaryAction ? (
          <Slot.Root
            data-slot="archive-item-link"
            title={title}
            className={cn(
              titleClass,
              "min-h-11 rounded-sm py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
          >
            {cloneElement(primaryAction, undefined, name)}
          </Slot.Root>
        ) : (
          <span title={title} className={titleClass}>
            {name}
          </span>
        )}
        <span className="w-40 shrink-0 truncate text-right text-muted-foreground text-xs tabular-nums @max-sm:w-full @max-sm:text-left">
          {date}
        </span>
      </div>
      {actions && <span className="flex shrink-0 items-center">{actions}</span>}
    </div>
  );
}
