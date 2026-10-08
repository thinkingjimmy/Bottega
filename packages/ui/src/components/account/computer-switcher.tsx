/**
 * [INPUT]: Depends on the shared side-panel tablist, the device list's relative moment and host-projected computer facts.
 * [OUTPUT]: Provides ComputerSwitcher with confirmed presence/coarse health, refresh status, local retry/diagnostic actions, computerPresenceLabel and COMPUTER_PANEL_ID.
 * [POS]: The account's computer strip above the sidebar groups, shared by Cloud Web and the desktop; the host owns presence, selection and storage.
 */
import { SidePanelTabs, type SidePanelTab } from "../workspace/side-panel/tabs";
import { relativeMoment } from "./moment";
import { cn } from "../../lib/utils";
import { COMPUTER_PANEL_ID } from "../workspace/navigation/computer-panel";
export { COMPUTER_PANEL_ID };
export interface SwitchableComputer {
  machineIdHash: string; name: string; online: boolean; lastSeenAt: number | null;
  /** Confirmed coarse health, only meaningful while this computer is online. */
  statusLabel?: string;
}
export interface ComputerSwitcherCopy {
  /** The tablist's accessible name. */ label: string;
  online: string; offline: string;
  /** "Offline · {{when}}". */ offlineSince: string;
}
export function computerPresenceLabel(computer: SwitchableComputer, copy: ComputerSwitcherCopy, locale: string) {
  if (computer.online) return computer.statusLabel ?? copy.online;
  return computer.lastSeenAt === null ? copy.offline : copy.offlineSince.replace("{{when}}", relativeMoment(computer.lastSeenAt, locale));
}
/**
 * Multiple computers use selection tabs. A single computer still exposes recovery status and local diagnostics.
 * A long name truncates inside its tab; the title keeps it whole.
 */
/* A phone row has width to scroll and fingers to serve: 44px pills, the selected one filled dark, one line that scrolls sideways. */
const pills = "px-3 pb-2 [&_[role=tab]]:h-11 [&_[role=tab]]:rounded-full [&_[role=tab]]:px-4 [&_[role=tab]]:text-sm [&_[role=tab][aria-selected=true]]:bg-foreground [&_[role=tab][aria-selected=true]]:text-background";
export function ComputerSwitcher({ computers, selected, onSelect, copy, locale, className, pendingLabel, recovery, diagnostics, variant = "strip" }: {
  computers: readonly SwitchableComputer[];
  selected: string | null;
  onSelect(machineIdHash: string): void;
  copy: ComputerSwitcherCopy;
  locale: string;
  className?: string;
  /** A stale list has no confirmed online/offline answer while the host reconnects. */
  pendingLabel?: string;
  recovery?: { label: string; retry(): void };
  diagnostics?: { label: string; detail: string; export(): void };
  /** The sidebar's wrapping strip, or the phone home's scrolling pill row. */
  variant?: "strip" | "pills";
}) {
  const diagnosticAction = (recovery || diagnostics) && <div className="px-1 pt-1 text-xs text-muted-foreground">
    {diagnostics && <span className="block">{diagnostics.detail}</span>}
    {recovery && <button type="button" className="mr-3 min-h-11 py-1 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={recovery.retry}>{recovery.label}</button>}
    {diagnostics && <button type="button" className="min-h-11 py-1 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={diagnostics.export}>{diagnostics.label}</button>}
  </div>;
  if (computers.length < 2) {
    const computer = computers[0];
    const status = pendingLabel ?? (computer && (!computer.online || computer.statusLabel) ? computerPresenceLabel(computer, copy, locale) : undefined);
    return status || diagnostics || recovery ? <div className="px-3 py-1.5">
      {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}{diagnosticAction}
    </div> : null;
  }
  const items: SidePanelTab[] = computers.map(computer => {
    const presence = pendingLabel ?? computerPresenceLabel(computer, copy, locale);
    const online = !pendingLabel && computer.online;
    return {
      key: computer.machineIdHash, label: computer.name, panelId: COMPUTER_PANEL_ID,
      selected: computer.machineIdHash === selected, hint: `${computer.name} · ${presence}`,
      /* An offline tab carries its moment as well as its name, so it may take the whole row rather than lose the name. */
      widthClass: variant === "pills" ? "max-w-56" : online ? undefined : "max-w-full",
      icon: online ? <span aria-label={presence} className="size-2 shrink-0 rounded-full bg-emerald-500" /> : null,
      actions: online && !computer.statusLabel ? undefined : <span className="shrink-0 text-[10px] leading-none opacity-70">{presence}</span>,
      select: () => onSelect(computer.machineIdHash),
    };
  });
  /* A sidebar has rows to spare and no width to spare: the strip wraps rather than hiding a computer off its edge. */
  return <div className={cn(variant === "pills" ? pills : "px-2 pb-0.5", className)} data-computer-switcher={variant} aria-busy={Boolean(pendingLabel)}>
    <SidePanelTabs items={items} label={copy.label} className={variant === "pills" ? "gap-2 [scrollbar-width:none]" : "flex-wrap gap-y-1 overflow-visible"} />
    {diagnosticAction}
  </div>;
}
