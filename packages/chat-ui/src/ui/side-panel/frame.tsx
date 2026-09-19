/**
 * [INPUT]: Platform-projected tabs, preview identity, retained leaf panels and header actions.
 * [OUTPUT]: Shared third-column header, narrow takeover navigation and accessible retained panel regions.
 * [POS]: Single panel composition view; platform hooks own authority, tab facts and effects.
 */
import { Fragment, type ReactNode, type Ref } from "react";
import { SidePanelTabs } from "@ai-chat/ui/components/workspace/side-panel/tabs";
import { ArrowLeft, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { panelChromeClassName } from "@ai-chat/ui/components/workspace/page";
import { cn } from "@ai-chat/ui/lib/utils";
export function PanelFrame({ title, tabs, add, actions, takeover = false, native = false, backRef, close, copy, children }: {
  title?: ReactNode; tabs?: ReactNode; add?: ReactNode; actions?: ReactNode; takeover?: boolean; native?: boolean;
  backRef?: Ref<HTMLButtonElement>; close(): void; copy: { close: string; back?: string }; children: ReactNode;
}) {
  return <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
    <header className={cn("web-panel-header flex h-[var(--page-shell-header-height,40px)] shrink-0 items-center gap-1 border-b px-2", native && "[-webkit-app-region:drag]")}>
      {takeover && <Button ref={backRef} variant="ghost" className="min-h-11 shrink-0" onClick={close}><ArrowLeft />{copy.back}</Button>}
      {title ? <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium">{title}</span> : <div className="flex min-w-0 flex-1 items-center gap-1 [-webkit-app-region:no-drag]">{tabs}{add}</div>}
      {title && takeover && add}
      <div className="[-webkit-app-region:no-drag]">{actions ?? <Button variant="ghost" size="icon-lg" className={cn("shrink-0 cursor-pointer", native ? panelChromeClassName : "max-lg:min-h-11 max-lg:min-w-11")}
        aria-label={copy.close} title={copy.close} onClick={close}><X /></Button>}</div>
    </header>
    {takeover && tabs && <div className="flex shrink-0 border-b p-2">{tabs}</div>}
    {children}
  </div>;
}
export function PanelRegion({ id, active, labelledBy, children }: { id: string; active: boolean; labelledBy?: string; children: ReactNode }) {
  return <div aria-labelledby={labelledBy ?? `panel-tab-${id}-trigger`} className="flex min-h-0 flex-1 flex-col overflow-hidden"
    hidden={!active} id={`panel-tab-${id}`} role="tabpanel">{children}</div>;
}

export type PanelLeaf = { id: string; view: ReactNode; labelledBy?: string; managesVisibility?: boolean };
export function PanelHost({ items, refs, onCloseTab, tabsLabel, closeTabLabel, active, leaves, empty, footer, hideTabs = false, ...frame }: Omit<Parameters<typeof PanelFrame>[0], "tabs" | "children"> & {
  items: import("@ai-chat/ui/components/workspace/side-panel/tabs").SidePanelTab[];
  refs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onCloseTab?(index: number): void; tabsLabel: string; closeTabLabel: string;
  active: string | null; leaves: readonly PanelLeaf[]; empty?: ReactNode; footer?: ReactNode; hideTabs?: boolean;
}) {
  return <PanelFrame {...frame} tabs={!hideTabs && items.length > 0 ? <SidePanelTabs items={items} label={tabsLabel} closeLabel={closeTabLabel} onClose={onCloseTab} refs={refs} /> : undefined}>
    {leaves.map(leaf => leaf.managesVisibility ? <Fragment key={leaf.id}>{leaf.view}</Fragment> :
      <PanelRegion key={leaf.id} id={leaf.id} labelledBy={leaf.labelledBy} active={active === leaf.id}>{leaf.view}</PanelRegion>)}
    {!items.length && !active && empty}{footer}
  </PanelFrame>;
}
