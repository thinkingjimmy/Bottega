/**
 * [INPUT]: React ambient JSX types only; the file declares no imports.
 * [OUTPUT]: Shared sidebar row presentation.
 * [POS]: Common workspace navigation vocabulary.
 */
export const sidebarRootMenuActionClass =
  "cursor-pointer text-sidebar-foreground/35 hover:bg-transparent hover:text-sidebar-foreground focus-visible:text-sidebar-foreground aria-expanded:text-sidebar-foreground peer-hover/menu-button:text-sidebar-foreground/35 peer-data-active/menu-button:text-sidebar-foreground/35";
export const SIDEBAR_SUB_ROW_INDENT = "pl-6";
export const SIDEBAR_SUB_ROW_INSET = "left-6";
export const SIDEBAR_ROOT_ROW_INSET = "left-2";
export const sidebarSubRowClass =
  `h-8 w-full translate-x-0 pr-2 ${SIDEBAR_SUB_ROW_INDENT} text-left font-normal! group-hover/menu-sub-item:bg-sidebar-accent group-hover/menu-sub-item:text-sidebar-accent-foreground group-has-[:focus-visible]/menu-sub-item:bg-sidebar-accent group-has-[:focus-visible]/menu-sub-item:text-sidebar-accent-foreground`;
export function SidebarRowMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center *:size-3.5!">
      {children}
    </span>
  );
}
export function SidebarRowTitle({
  actionStrip,
  children,
}: {
  actionStrip?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="sidebar-row-title min-w-0 flex-1"
      style={{ "--sidebar-row-action-strip": actionStrip } as React.CSSProperties}
    >
      <span className="sidebar-row-title-marquee">{children}</span>
    </span>
  );
}
/**
 * A tag never squeezes the title: it keeps `shrink-0` so the title cannot push it out of the row, and caps its own
 * width so a long value — a computer name — ends in an ellipsis instead. 10ch at 10px is about a quarter of a
 * 16rem sidebar row, which leaves the title the clear majority of the remaining space.
 */
export function SidebarRowTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="max-w-[10ch] shrink-0 truncate rounded border border-sidebar-border bg-sidebar-foreground/6 px-1 py-0.5 text-[10px] text-sidebar-foreground/55 leading-none"
    >
      {children}
    </span>
  );
}
