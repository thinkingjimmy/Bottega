/**
 * [INPUT]: React and Radix slots, the shared Button, ArrowLeft and theme utilities.
 * [OUTPUT]: WorkspaceBackLink, WorkspaceHeader, WorkspacePage, panelChromeClassName and crossHeaderPanelStyle.
 * [POS]: Router-independent page chrome with boxed no-drag controls shared by desktop and browser.
 */
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Slot } from "radix-ui";
import { ArrowLeft } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
export const panelChromeClassName = "[&>svg]:[stroke-width:1.5] active:translate-y-0!";
export const crossHeaderPanelStyle = { height: "calc(100% + var(--page-shell-header-height))", marginTop: "calc(0px - var(--page-shell-header-height))" } satisfies CSSProperties;
export function WorkspaceBackLink({ className, children, ...props }: ComponentProps<typeof Button>) {
  return <Button size="icon-lg" variant="ghost" className={cn(panelChromeClassName, className)} {...props}>
    <Slot.Slottable>{children}</Slot.Slottable><ArrowLeft aria-hidden />
  </Button>;
}
type WorkspaceHeaderProps = {
  title?: ReactNode; icon?: ReactNode; titleAdornment?: ReactNode; leading?: ReactNode;
  center?: ReactNode; actions?: ReactNode; rail?: ReactNode; chrome?: "browser" | "native";
  collapsedInset?: "compact" | "mac";
};
export function WorkspaceHeader({ title, icon, titleAdornment, leading, center, actions, rail, chrome = "browser", collapsedInset }: WorkspaceHeaderProps) {
  return <><header className={cn("relative flex h-[var(--page-shell-header-height,2.5rem)] min-h-10 shrink-0 items-center gap-2 px-4 max-md:min-h-12 max-md:px-2", chrome === "native" && "[-webkit-app-region:drag]", center && "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]", title && !rail && "border-b", collapsedInset === "mac" ? "pl-[8.5rem]" : collapsedInset === "compact" && "pl-12")}>
    {collapsedInset === "mac" && <><span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-28 [-webkit-app-region:no-drag]" /><span aria-hidden className="absolute top-1/2 left-[7.5rem] h-5 w-px -translate-y-1/2 bg-border" /></>}
    {/* Electron needs a real rectangle to exclude controls from the draggable header. */}
    <div className="flex min-w-0 items-center gap-2">{leading && <span className="flex shrink-0 items-center [-webkit-app-region:no-drag]">{leading}</span>}{title && <div className="flex min-w-0 items-center gap-2">{icon && <span aria-hidden className="flex shrink-0 items-center justify-center [&>svg]:size-4">{icon}</span>}<h1 className="truncate text-sm font-medium">{title}</h1>{titleAdornment && <span className="flex shrink-0 items-center [-webkit-app-region:no-drag]">{titleAdornment}</span>}</div>}</div>
    {center && <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">{center}</div>}
    <div className="ml-auto flex min-w-0 items-center justify-end gap-2 [-webkit-app-region:no-drag]">{actions}</div>
  </header>{rail && <div className="shrink-0 border-b">{rail}</div>}</>;
}
export function WorkspacePage({ children, ...header }: WorkspaceHeaderProps & { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col [--page-shell-header-height:2.5rem]"><WorkspaceHeader {...header} /><div className="min-h-0 flex-1">{children}</div></div>;
}
